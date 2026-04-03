/**
 * PDF Rotator
 *
 * Rotates and reorders PDF pages using pdf-lib — a lossless operation.
 * Rotation uses setRotation() (only modifies rotation metadata).
 * Reordering uses copyPages() (copies page structure as-is).
 * No re-rendering or re-encoding occurs — quality is fully preserved.
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
 * Apply rotation and reordering to PDF pages.
 * Uses copyPages() to build a new PDF in the desired page order,
 * then applies rotation via setRotation() on each copied page.
 *
 * @param file - Source PDF file
 * @param pageOrder - Ordered list of page indices (0-based) to include in output
 * @param rotations - Map of original pageIndex to rotation degrees (90, 180, 270)
 * @param onProgress - Progress callback for UI
 */
export async function rotatePdf(
  file: File,
  pageOrder: number[],
  rotations: Map<number, number>,
  onProgress: (update: ProcessingUpdate) => void
): Promise<RotatePdfResult> {
  onProgress({ progress: 10, status: "Loading PDF..." });

  const { PDFDocument, degrees } = await import("pdf-lib");

  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });

  onProgress({
    progress: 25,
    status: `Processing ${pageOrder.length} page${pageOrder.length > 1 ? "s" : ""}...`,
  });

  const newDoc = await PDFDocument.create();

  for (let i = 0; i < pageOrder.length; i++) {
    const srcIndex = pageOrder[i];
    const [copiedPage] = await newDoc.copyPages(srcDoc, [srcIndex]);

    const userRotation = rotations.get(srcIndex) || 0;
    if (userRotation !== 0) {
      const currentAngle = copiedPage.getRotation().angle;
      const newAngle = ((currentAngle + userRotation) % 360 + 360) % 360;
      copiedPage.setRotation(degrees(newAngle));
    }

    newDoc.addPage(copiedPage);

    onProgress({
      progress: 25 + ((i + 1) / pageOrder.length) * 55,
      status: `Processing... page ${i + 1}/${pageOrder.length}`,
    });
  }

  onProgress({ progress: 85, status: "Saving PDF..." });
  const pdfBytes = await newDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    pageCount: pageOrder.length,
    originalSize: file.size,
    processedSize: blob.size,
  };
}
