/**
 * PDF Rotator
 *
 * Rotates PDF pages using pdf-lib's setRotation() — a lossless operation
 * that only modifies rotation metadata without re-encoding page content.
 */

import { renderPageThumbnail, getPdfPageCount } from "./pdf-splitter";

export { renderPageThumbnail, getPdfPageCount };

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface RotatePdfResult {
  blob: Blob;
  pageCount: number;
  originalSize: number;
  processedSize: number;
}

/**
 * Apply rotation to PDF pages.
 * Uses pdf-lib page.setRotation(degrees()) — lossless, only changes rotation metadata.
 * Quality is fully preserved: no re-rendering or re-encoding occurs.
 *
 * @param file - Source PDF file
 * @param rotations - Map of pageIndex (0-based) to rotation degrees (90, 180, 270)
 * @param onProgress - Progress callback for UI
 */
export async function rotatePdf(
  file: File,
  rotations: Map<number, number>,
  onProgress: (update: ProcessingUpdate) => void
): Promise<RotatePdfResult> {
  onProgress({ progress: 10, status: "Loading PDF..." });

  const { PDFDocument, degrees } = await import("pdf-lib");

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const pageCount = pages.length;

  onProgress({
    progress: 30,
    status: `Rotating ${pageCount} page${pageCount > 1 ? "s" : ""}...`,
  });

  for (let i = 0; i < pageCount; i++) {
    const userRotation = rotations.get(i) || 0;
    if (userRotation !== 0) {
      const page = pages[i];
      const currentAngle = page.getRotation().angle;
      const newAngle = ((currentAngle + userRotation) % 360 + 360) % 360;
      page.setRotation(degrees(newAngle));
    }

    onProgress({
      progress: 30 + ((i + 1) / pageCount) * 50,
      status: `Rotating... page ${i + 1}/${pageCount}`,
    });
  }

  onProgress({ progress: 85, status: "Saving PDF..." });
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
