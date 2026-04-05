// ============================================================================
// OCR PDF — Invisible Text Layer
// Renders PDF pages to canvas, runs Tesseract.js OCR, overlays invisible text
// on original pages for select/copy/search. Visual quality is 100% preserved
// because original pages are copied losslessly via pdf-lib copyPages().
// ============================================================================

// Dynamic import for Tesseract.js — static import causes page freeze
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _createWorker: any = null;
async function getCreateWorker() {
  if (_createWorker) return _createWorker;
  const Tesseract = await import("tesseract.js");
  _createWorker = Tesseract.createWorker;
  return _createWorker;
}

// Re-export helpers for page thumbnails and metadata
export { renderPageThumbnail, getPdfPageCount } from "./pdf-splitter";
export { getPageDimensions, type PageDimensions } from "./pdf-reorder";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface OcrPdfResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  qualityScore: number;
  pageCount: number;
}

export interface TextCheckResult {
  hasText: boolean;
  textPageCount: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert canvas pixel coordinates to PDF user-space coordinates
 * using the inverse of the pdfjs viewport transform matrix.
 * Works correctly for all page rotations.
 */
function canvasToUserSpace(
  cx: number,
  cy: number,
  transform: number[]
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  return {
    x: (d * (cx - e) - c * (cy - f)) / det,
    y: (-b * (cx - e) + a * (cy - f)) / det,
  };
}

/**
 * Strip characters outside WinAnsi encoding range (Helvetica font support).
 * Keeps printable ASCII + Latin-1 Supplement. Indonesian uses Latin alphabet
 * so this preserves virtually all OCR output.
 */
function sanitizeText(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

// ---------------------------------------------------------------------------
// Text Detection
// ---------------------------------------------------------------------------

/**
 * Check whether a PDF already has extractable text content.
 * Returns per-page analysis so we can inform the user.
 */
export async function checkPdfHasText(file: File): Promise<TextCheckResult> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdfDoc.numPages;
  let textPageCount = 0;

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = textContent.items.map((item: any) => item.str).join("").trim();
    if (text.length > 20) textPageCount++;
    page.cleanup();
  }

  pdfDoc.destroy();
  return {
    hasText: textPageCount === totalPages,
    textPageCount,
    totalPages,
  };
}

// ---------------------------------------------------------------------------
// Main OCR Function
// ---------------------------------------------------------------------------

const RENDER_SCALE = 3; // 216 DPI — good balance of OCR quality and speed

export async function ocrPdf(
  file: File,
  pageOrder: number[],
  rotations: Map<number, number>,
  onProgress: (update: ProcessingUpdate) => void
): Promise<OcrPdfResult> {
  onProgress({ progress: 0, status: "Loading PDF..." });

  // ── Step 1: Create pre-processed PDF (reorder + rotate) ──────────
  const pdfLib = await import("pdf-lib");
  const { PDFDocument, degrees, StandardFonts } = pdfLib;
  const srcBytes = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });

  const preDoc = await PDFDocument.create();
  for (let i = 0; i < pageOrder.length; i++) {
    const srcIdx = pageOrder[i];
    const [page] = await preDoc.copyPages(srcDoc, [srcIdx]);
    const rot = rotations.get(srcIdx) || 0;
    if (rot !== 0) {
      const current = page.getRotation().angle;
      page.setRotation(degrees(((current + rot) % 360 + 360) % 360));
    }
    preDoc.addPage(page);
  }

  const preBytes = await preDoc.save();

  onProgress({ progress: 5, status: "Setting up OCR engine..." });

  // ── Step 2: Load with pdfjs-dist for rendering ───────────────────
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const pdfJsDoc = await pdfjsLib.getDocument({ data: preBytes.slice(0) }).promise;
  const totalPages = pdfJsDoc.numPages;

  // ── Step 3: Load with pdf-lib for text overlay ───────────────────
  const outDoc = await PDFDocument.load(preBytes, { ignoreEncryption: true });
  const font = await outDoc.embedFont(StandardFonts.Helvetica);

  // ── Step 4: Setup Tesseract.js worker ────────────────────────────
  const createWorker = await getCreateWorker();
  const worker = await createWorker("eng+ind", 1, {
    workerPath:
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath:
      "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd-lstm.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
  });

  onProgress({ progress: 10, status: "OCR engine ready" });

  let totalConfidence = 0;
  let totalWords = 0;

  // ── Step 5: Process each page ────────────────────────────────────
  for (let i = 0; i < totalPages; i++) {
    const pageBase = 10 + (i / totalPages) * 85;
    onProgress({
      progress: Math.round(pageBase),
      status: `Rendering page ${i + 1}/${totalPages}...`,
    });

    // Render to canvas (pdfjs applies /Rotate automatically)
    const pdfPage = await pdfJsDoc.getPage(i + 1);
    const viewport = pdfPage.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;

    onProgress({
      progress: Math.round(pageBase + (85 / totalPages) * 0.3),
      status: `OCR page ${i + 1}/${totalPages}...`,
    });

    // Run OCR
    const imageBlob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png")
    );
    const { data } = await worker.recognize(imageBlob);

    // Get pdf-lib page + rotation info
    const outPage = outDoc.getPage(i);
    const pageRotation = outPage.getRotation().angle;
    const transform = viewport.transform;

    // Draw invisible text for each recognized word
    for (const word of data.words) {
      const cleanText = sanitizeText(word.text);
      if (!cleanText.trim() || word.confidence < 30) continue;

      const { bbox } = word;
      const bl = canvasToUserSpace(bbox.x0, bbox.y1, transform);
      const tl = canvasToUserSpace(bbox.x0, bbox.y0, transform);
      const br = canvasToUserSpace(bbox.x1, bbox.y1, transform);

      // Font size from bbox height
      const height = Math.sqrt(
        (tl.x - bl.x) ** 2 + (tl.y - bl.y) ** 2
      );
      let fontSize = Math.max(2, height * 0.85);

      // Width-match: scale font size so rendered width matches bbox width
      const targetWidth = Math.sqrt(
        (br.x - bl.x) ** 2 + (br.y - bl.y) ** 2
      );
      try {
        const textWidth = font.widthOfTextAtSize(cleanText, fontSize);
        if (textWidth > 0 && targetWidth > 0) {
          fontSize = fontSize * (targetWidth / textWidth);
        }
      } catch {
        // Keep height-based fontSize
      }

      // Baseline offset (Helvetica descender ~15% of em)
      const baselineY = bl.y + fontSize * 0.15;

      try {
        outPage.drawText(cleanText, {
          x: bl.x,
          y: baselineY,
          size: fontSize,
          font,
          opacity: 0,
          ...(pageRotation !== 0
            ? { rotate: degrees(-pageRotation) }
            : {}),
        });
      } catch {
        // Skip characters that fail encoding
      }

      totalConfidence += word.confidence;
      totalWords++;
    }

    // Cleanup canvas memory
    pdfPage.cleanup();
    canvas.width = 0;
    canvas.height = 0;

    onProgress({
      progress: Math.round(pageBase + 85 / totalPages),
      status: `Page ${i + 1}/${totalPages} complete`,
    });
  }

  // ── Cleanup ──────────────────────────────────────────────────────
  await worker.terminate();
  pdfJsDoc.destroy();

  onProgress({ progress: 96, status: "Saving PDF..." });

  // ── Save final PDF ───────────────────────────────────────────────
  const finalBytes = await outDoc.save();
  const blob = new Blob([finalBytes], { type: "application/pdf" });
  const previewUrl = URL.createObjectURL(blob);

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    previewUrl,
    originalSize: file.size,
    processedSize: blob.size,
    qualityScore:
      totalWords > 0 ? Math.round(totalConfidence / totalWords) : 0,
    pageCount: totalPages,
  };
}
