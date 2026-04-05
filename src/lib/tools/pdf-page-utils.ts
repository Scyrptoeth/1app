/**
 * Shared PDF page manipulation utilities.
 * Used by PdfPageManager and any tool that needs to apply page modifications.
 */

export interface PageConfig {
  originalIndex: number;
  rotation: number;
  included: boolean;
}

/**
 * Apply page modifications (reorder, rotate, remove) to a PDF.
 * Uses pdf-lib copyPages + setRotation for lossless manipulation.
 */
export async function applyPageModifications(
  pdfBytes: ArrayBuffer,
  pages: PageConfig[],
  onProgress?: (update: { progress: number; status: string }) => void
): Promise<ArrayBuffer> {
  const { PDFDocument, degrees } = await import("pdf-lib");

  onProgress?.({ progress: 10, status: "Loading PDF..." });

  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const includedPages = pages.filter((p) => p.included);

  if (includedPages.length === 0) {
    throw new Error("At least one page must be included.");
  }

  const newDoc = await PDFDocument.create();

  for (let i = 0; i < includedPages.length; i++) {
    const page = includedPages[i];
    const [copiedPage] = await newDoc.copyPages(srcDoc, [page.originalIndex]);

    if (page.rotation !== 0) {
      const currentAngle = copiedPage.getRotation().angle;
      const newAngle = ((currentAngle + page.rotation) % 360 + 360) % 360;
      copiedPage.setRotation(degrees(newAngle));
    }

    newDoc.addPage(copiedPage);

    onProgress?.({
      progress: 10 + ((i + 1) / includedPages.length) * 80,
      status: `Processing page ${i + 1}/${includedPages.length}...`,
    });
  }

  onProgress?.({ progress: 95, status: "Saving PDF..." });
  const resultBytes = await newDoc.save();

  onProgress?.({ progress: 100, status: "Complete!" });
  return resultBytes.buffer as ArrayBuffer;
}

/**
 * Check if pages have any modifications from default state.
 */
export function hasPageModifications(
  pages: PageConfig[],
  totalPages: number
): boolean {
  if (pages.length !== totalPages) return true;
  return pages.some(
    (p, i) => p.originalIndex !== i || p.rotation !== 0 || !p.included
  );
}
