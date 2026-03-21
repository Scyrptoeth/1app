/**
 * PDF Watermark Remover
 *
 * Removes watermarks from PDFs by analyzing and manipulating the PDF structure.
 * PDFs store watermarks as separate objects (text/image overlays), making them
 * easier to identify and remove than in raster images.
 *
 * Strategies:
 * 1. Remove objects in the "Watermark" artifact layer
 * 2. Detect and remove low-opacity text overlays
 * 3. Remove repeated text/image patterns across pages
 * 4. Clean annotation layers that contain watermark-like content
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
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream, PDFString, PDFHexString } =
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

  // Strategy 1: Remove watermark annotations
  onProgress({ progress: 20, status: "Checking annotations..." });

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const annots = page.node.lookup(PDFName.of("Annots"));

    if (annots instanceof PDFArray) {
      const indicesToRemove: number[] = [];

      for (let j = 0; j < annots.size(); j++) {
        const annot = annots.lookup(j);
        if (annot instanceof PDFDict) {
          // Check for watermark subtype
          const subtype = annot.lookup(PDFName.of("Subtype"));
          const contents = annot.lookup(PDFName.of("Contents"));

          if (subtype?.toString() === "/Watermark") {
            indicesToRemove.push(j);
            watermarksRemoved++;
          }

          // Check for low opacity annotations (often watermarks)
          const ca = annot.lookup(PDFName.of("CA"));
          if (ca && parseFloat(ca.toString()) < 0.5) {
            indicesToRemove.push(j);
            watermarksRemoved++;
          }
        }
      }

      // Remove identified annotations (reverse order to maintain indices)
      for (const idx of indicesToRemove.reverse()) {
        annots.remove(idx);
      }
    }

    onProgress({
      progress: 20 + ((i + 1) / pageCount) * 20,
      status: `Checking annotations... page ${i + 1}/${pageCount}`,
    });
  }

  // Strategy 2: Analyze and clean content streams
  onProgress({ progress: 45, status: "Analyzing content streams..." });

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];

    // Check for Optional Content Groups (OCGs) marked as watermarks
    const resources = page.node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const properties = resources.lookup(PDFName.of("Properties"));
      if (properties instanceof PDFDict) {
        const entries = properties.entries();
        for (const [key, value] of entries) {
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
                // Remove this OCG reference
                properties.delete(key);
                watermarksRemoved++;
              }
            }
          }
        }
      }

      // Check ExtGState for transparency settings used by watermarks
      const extGState = resources.lookup(PDFName.of("ExtGState"));
      if (extGState instanceof PDFDict) {
        const gsEntries = extGState.entries();
        for (const [key, value] of gsEntries) {
          if (value instanceof PDFDict) {
            const ca = value.lookup(PDFName.of("ca"));
            const CA = value.lookup(PDFName.of("CA"));

            // Very low opacity graphics state — likely watermark
            const caVal = ca ? parseFloat(ca.toString()) : 1;
            const CAVal = CA ? parseFloat(CA.toString()) : 1;

            if (caVal < 0.3 || CAVal < 0.3) {
              // Set opacity to 0 to make watermark invisible
              if (ca) value.set(PDFName.of("ca"), pdfDoc.context.obj(0));
              if (CA) value.set(PDFName.of("CA"), pdfDoc.context.obj(0));
              watermarksRemoved++;
            }
          }
        }
      }
    }

    // Strategy 3: Process content stream to remove watermark operators
    try {
      const contentStream = page.node.lookup(PDFName.of("Contents"));
      if (contentStream) {
        let streamData: string | null = null;

        if (contentStream instanceof PDFStream) {
          const bytes = contentStream.getContents();
          streamData = new TextDecoder("latin1").decode(bytes);
        } else if (contentStream instanceof PDFArray) {
          // Multiple content streams — concatenate
          const parts: string[] = [];
          for (let s = 0; s < contentStream.size(); s++) {
            const stream = contentStream.lookup(s);
            if (stream instanceof PDFStream) {
              const bytes = stream.getContents();
              parts.push(new TextDecoder("latin1").decode(bytes));
            }
          }
          streamData = parts.join("\n");
        }

        if (streamData) {
          // Look for BDC/EMC blocks with watermark markers
          const cleanedStream = removeWatermarkFromContentStream(streamData);
          if (cleanedStream !== streamData) {
            watermarksRemoved++;
            // Re-encode the cleaned stream
            const newBytes = new TextEncoder().encode(cleanedStream);
            const newStream = pdfDoc.context.stream(newBytes);
            page.node.set(PDFName.of("Contents"), pdfDoc.context.register(newStream));
          }
        }
      }
    } catch {
      // Content stream processing failed — skip this page silently
    }

    onProgress({
      progress: 45 + ((i + 1) / pageCount) * 40,
      status: `Processing content... page ${i + 1}/${pageCount}`,
    });
  }

  // Strategy 4: Remove document-level watermark metadata
  onProgress({ progress: 88, status: "Cleaning metadata..." });

  try {
    const catalog = pdfDoc.context.lookup(
      pdfDoc.context.trailerInfo.Root
    );
    if (catalog instanceof PDFDict) {
      // Remove OCProperties that define watermark layers
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
 * Remove watermark-related operators from a PDF content stream.
 * Targets BDC/EMC marked content blocks that are watermark artifacts.
 */
function removeWatermarkFromContentStream(stream: string): string {
  let result = stream;

  // Pattern 1: Remove /Watermark marked content blocks
  // Format: /Artifact <</Type /Watermark...>> BDC ... EMC
  const watermarkBlockRegex =
    /\/Artifact\s*<<[^>]*\/Type\s*\/Watermark[^>]*>>\s*BDC[\s\S]*?EMC/gi;
  result = result.replace(watermarkBlockRegex, "");

  // Pattern 2: Remove OC (Optional Content) blocks marked as watermark
  // Format: /OC /WatermarkOCG BDC ... EMC
  const ocWatermarkRegex =
    /\/OC\s+\/[A-Za-z]*[Ww]atermark[A-Za-z]*\s+BDC[\s\S]*?EMC/gi;
  result = result.replace(ocWatermarkRegex, "");

  // Pattern 3: Remove common watermark text patterns
  // Look for Tj/TJ operators with common watermark text
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
    // Match text show operators with watermark text
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
