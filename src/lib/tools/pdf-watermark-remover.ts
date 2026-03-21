/**
 * PDF Watermark Remover
 *
 * Removes watermarks from PDFs by analyzing and manipulating the PDF structure.
 * PDFs store watermarks as separate objects (text/image overlays), making them
 * easier to identify and remove than in raster images.
 *
 * Strategies:
 * 1. Remove objects in the "Watermark" artifact layer
 * 2. Detect and remove low-opacity text overlays via ExtGState
 * 3. Detect and remove watermark text in content streams using multiple methods:
 *    a. BDC/EMC marked content blocks
 *    b. q/Q graphics state blocks containing low-opacity text
 *    c. Known watermark keyword matching
 * 4. Clean annotation layers and document-level metadata
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface PdfProcessingResult {
  blob: Blob;
  pageCount: number;
  originalSize: number;
  processedSize: number;
}

/**
 * Remove watermarks from a PDF file.
 * Uses pdf-lib for PDF manipulation.
 */
export async function removePdfWatermark(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<PdfProcessingResult> {
  onProgress({ progress: 5, status: "Loading PDF..." });

  // Dynamically import pdf-lib (lazy loaded)
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream } =
    await import("pdf-lib");

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
  });

  const pages = pdfDoc.getPages();
  const pageCount = pages.length;

  onProgress({
    progress: 15,
    status: `Analyzing ${pageCount} page${pageCount > 1 ? "s" : ""}...`,
  });

  let watermarksRemoved = 0;

  // =============================================
  // Phase 1: Identify low-opacity ExtGState names
  // =============================================
  // Collect the names of graphics states with low opacity (< 0.5)
  // These are typically used by watermark text overlays.
  const lowOpacityGsNames: Set<string> = new Set();

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const resources = page.node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const extGState = resources.lookup(PDFName.of("ExtGState"));
      if (extGState instanceof PDFDict) {
        for (const [key, value] of extGState.entries()) {
          if (value instanceof PDFDict) {
            const ca = value.lookup(PDFName.of("ca"));
            const CA = value.lookup(PDFName.of("CA"));
            const caVal = ca ? parseFloat(ca.toString()) : 1;
            const CAVal = CA ? parseFloat(CA.toString()) : 1;

            // Opacity below 0.5 is suspicious — likely watermark
            if (caVal < 0.5 || CAVal < 0.5) {
              lowOpacityGsNames.add(key.toString());
            }
          }
        }
      }
    }
  }

  // =============================================
  // Phase 2: Remove watermark annotations
  // =============================================
  onProgress({ progress: 20, status: "Checking annotations..." });

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const annots = page.node.lookup(PDFName.of("Annots"));

    if (annots instanceof PDFArray) {
      const indicesToRemove: number[] = [];

      for (let j = 0; j < annots.size(); j++) {
        const annot = annots.lookup(j);
        if (annot instanceof PDFDict) {
          const subtype = annot.lookup(PDFName.of("Subtype"));
          const ca = annot.lookup(PDFName.of("CA"));

          if (subtype?.toString() === "/Watermark") {
            indicesToRemove.push(j);
            watermarksRemoved++;
          }

          if (ca && parseFloat(ca.toString()) < 0.5) {
            indicesToRemove.push(j);
            watermarksRemoved++;
          }
        }
      }

      for (const idx of indicesToRemove.reverse()) {
        annots.remove(idx);
      }
    }

    onProgress({
      progress: 20 + ((i + 1) / pageCount) * 15,
      status: `Checking annotations... page ${i + 1}/${pageCount}`,
    });
  }

  // =============================================
  // Phase 3: Process content streams
  // =============================================
  onProgress({ progress: 40, status: "Analyzing content streams..." });

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];

    // Clean OCG properties
    const resources = page.node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const properties = resources.lookup(PDFName.of("Properties"));
      if (properties instanceof PDFDict) {
        for (const [key, value] of properties.entries()) {
          if (value instanceof PDFDict) {
            const name = value.lookup(PDFName.of("Name"));
            if (name) {
              const nameStr = name.toString().toLowerCase();
              if (
                nameStr.includes("watermark") ||
                nameStr.includes("draft") ||
                nameStr.includes("confidential") ||
                nameStr.includes("sample") ||
                nameStr.includes("copy")
              ) {
                properties.delete(key);
                watermarksRemoved++;
              }
            }
          }
        }
      }
    }

    // Process content streams
    try {
      const contentStream = page.node.lookup(PDFName.of("Contents"));
      if (!contentStream) continue;

      if (contentStream instanceof PDFArray) {
        // Multiple content streams — process each individually
        // This is common: stream 0 = setup, stream 1 = main content, stream 2 = watermark overlay
        for (let s = 0; s < contentStream.size(); s++) {
          const stream = contentStream.lookup(s);
          if (stream instanceof PDFStream) {
            const bytes = stream.getContents();
            const text = new TextDecoder("latin1").decode(bytes);

            // Check if this entire stream is a watermark overlay
            const isWatermarkStream = isStreamWatermarkOverlay(
              text,
              lowOpacityGsNames
            );

            if (isWatermarkStream) {
              // Replace with minimal graphics state restore
              const cleanBytes = new TextEncoder().encode(" Q\n");
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (stream as any).setContents
                ? (stream as any).setContents(cleanBytes)
                : null;

              // Alternative: create new stream and replace
              const newStream = pdfDoc.context.stream(cleanBytes);
              contentStream.set(s, pdfDoc.context.register(newStream));
              watermarksRemoved++;
            } else {
              // Try partial cleanup within the stream
              const cleaned = removeWatermarkFromContentStream(
                text,
                lowOpacityGsNames
              );
              if (cleaned !== text) {
                const newBytes = new TextEncoder().encode(cleaned);
                const newStream = pdfDoc.context.stream(newBytes);
                contentStream.set(s, pdfDoc.context.register(newStream));
                watermarksRemoved++;
              }
            }
          }
        }
      } else if (contentStream instanceof PDFStream) {
        // Single content stream
        const bytes = contentStream.getContents();
        const text = new TextDecoder("latin1").decode(bytes);
        const cleaned = removeWatermarkFromContentStream(
          text,
          lowOpacityGsNames
        );
        if (cleaned !== text) {
          watermarksRemoved++;
          const newBytes = new TextEncoder().encode(cleaned);
          const newStream = pdfDoc.context.stream(newBytes);
          page.node.set(
            PDFName.of("Contents"),
            pdfDoc.context.register(newStream)
          );
        }
      }
    } catch {
      // Content stream processing failed — skip silently
    }

    onProgress({
      progress: 40 + ((i + 1) / pageCount) * 40,
      status: `Processing content... page ${i + 1}/${pageCount}`,
    });
  }

  // =============================================
  // Phase 4: Set low-opacity ExtGState to fully transparent
  // =============================================
  onProgress({ progress: 82, status: "Neutralizing transparency layers..." });

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const resources = page.node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const extGState = resources.lookup(PDFName.of("ExtGState"));
      if (extGState instanceof PDFDict) {
        for (const [, value] of extGState.entries()) {
          if (value instanceof PDFDict) {
            const ca = value.lookup(PDFName.of("ca"));
            const CA = value.lookup(PDFName.of("CA"));
            const caVal = ca ? parseFloat(ca.toString()) : 1;
            const CAVal = CA ? parseFloat(CA.toString()) : 1;

            if (caVal < 0.5 || CAVal < 0.5) {
              // Set opacity to 0 — makes any remaining watermark invisible
              if (ca) value.set(PDFName.of("ca"), pdfDoc.context.obj(0));
              if (CA) value.set(PDFName.of("CA"), pdfDoc.context.obj(0));
              watermarksRemoved++;
            }
          }
        }
      }
    }
  }

  // =============================================
  // Phase 5: Clean document-level metadata
  // =============================================
  onProgress({ progress: 88, status: "Cleaning metadata..." });

  try {
    const catalog = pdfDoc.context.lookup(
      pdfDoc.context.trailerInfo.Root
    );
    if (catalog instanceof PDFDict) {
      const ocProperties = catalog.lookup(PDFName.of("OCProperties"));
      if (ocProperties instanceof PDFDict) {
        const ocgs = ocProperties.lookup(PDFName.of("OCGs"));
        if (ocgs instanceof PDFArray) {
          const toRemove: number[] = [];
          for (let i = 0; i < ocgs.size(); i++) {
            const ocg = ocgs.lookup(i);
            if (ocg instanceof PDFDict) {
              const name = ocg.lookup(PDFName.of("Name"));
              if (name) {
                const nameStr = name.toString().toLowerCase();
                if (
                  nameStr.includes("watermark") ||
                  nameStr.includes("draft") ||
                  nameStr.includes("sample")
                ) {
                  toRemove.push(i);
                  watermarksRemoved++;
                }
              }
            }
          }
          for (const idx of toRemove.reverse()) {
            ocgs.remove(idx);
          }
        }
      }
    }
  } catch {
    // Metadata cleanup failed — not critical
  }

  // Save the modified PDF
  onProgress({ progress: 95, status: "Saving PDF..." });

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    pageCount,
    originalSize: file.size,
    processedSize: blob.size,
  };
}

/**
 * Detect whether an entire content stream is a watermark overlay.
 *
 * Watermark overlay streams typically:
 * - Use a low-opacity graphics state (e.g. /Xi0 gs where Xi0 has ca < 0.5)
 * - Contain only text drawing commands (BT/ET, Tj/TJ)
 * - Contain rotated text (45-degree rotation matrix: 0.70711 values)
 * - Do NOT contain image rendering (Do operator for XObjects)
 */
function isStreamWatermarkOverlay(
  stream: string,
  lowOpacityGsNames: Set<string>
): boolean {
  const trimmed = stream.trim();

  // Must not contain image rendering — we don't want to remove actual content
  if (/\/Im\d+\s+Do/.test(trimmed)) return false;

  // Must contain text operators
  if (!trimmed.includes("Tj") && !trimmed.includes("TJ")) return false;

  // Check if it uses a low-opacity graphics state
  for (const gsName of lowOpacityGsNames) {
    // gsName is like "/Xi0" — check for "/Xi0 gs" in stream
    if (trimmed.includes(`${gsName} gs`)) {
      return true;
    }
  }

  // Check for 45-degree rotation (common diagonal watermark pattern)
  // cos(45°) ≈ 0.70711
  if (trimmed.includes("0.70711") && trimmed.includes("cm")) {
    // Stream has rotated text — likely a diagonal watermark
    // Additional check: no image references
    if (!trimmed.includes(" Do")) {
      return true;
    }
  }

  return false;
}

/**
 * Remove watermark-related operators from a PDF content stream.
 * Uses multiple detection strategies:
 * 1. BDC/EMC marked content blocks with watermark artifacts
 * 2. q/Q blocks that use low-opacity graphics state for text
 * 3. Known watermark keyword text matching
 */
function removeWatermarkFromContentStream(
  stream: string,
  lowOpacityGsNames: Set<string>
): string {
  let result = stream;

  // Pattern 1: Remove /Watermark marked content blocks (BDC/EMC)
  const watermarkBlockRegex =
    /\/Artifact\s*<<[^>]*\/Type\s*\/Watermark[^>]*>>\s*BDC[\s\S]*?EMC/gi;
  result = result.replace(watermarkBlockRegex, "");

  // Pattern 2: Remove OC (Optional Content) watermark blocks
  const ocWatermarkRegex =
    /\/OC\s+\/[A-Za-z]*[Ww]atermark[A-Za-z]*\s+BDC[\s\S]*?EMC/gi;
  result = result.replace(ocWatermarkRegex, "");

  // Pattern 3: Remove q...Q blocks that use low-opacity GS for text
  // These are standalone watermark overlay blocks within a larger stream
  for (const gsName of lowOpacityGsNames) {
    // Match: q ... <gsName> gs ... Tj ... Q
    // Use non-greedy matching to find smallest enclosing q/Q block
    const gsEscaped = gsName.replace(/\//g, "\\/");
    const blockRegex = new RegExp(
      `q\\s[\\s\\S]*?${gsEscaped}\\s+gs[\\s\\S]*?(?:Tj|TJ)[\\s\\S]*?Q`,
      "g"
    );
    result = result.replace(blockRegex, "");
  }

  // Pattern 4: Remove known watermark text keywords
  const watermarkTexts = [
    "DRAFT",
    "SAMPLE",
    "COPY",
    "CONFIDENTIAL",
    "WATERMARK",
    "DO NOT COPY",
    "PREVIEW",
    "EVALUATION",
    "TRIAL",
    "DEMO",
    "SPECIMEN",
    "NOT FOR DISTRIBUTION",
  ];

  for (const text of watermarkTexts) {
    const tjRegex = new RegExp(
      `\\(${escapeRegex(text)}\\)\\s*Tj`,
      "gi"
    );
    result = result.replace(tjRegex, "() Tj");
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
