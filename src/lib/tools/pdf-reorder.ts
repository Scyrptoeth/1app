/**
 * PDF Reorder
 *
 * Reorders and removes PDF pages using pdf-lib's copyPages() — a lossless
 * operation that copies pages byte-for-byte without re-rendering or re-encoding.
 * Page dimensions, fonts, images, vectors, and form fields are fully preserved.
 */

import { renderPageThumbnail, getPdfPageCount } from "./pdf-splitter";

export { renderPageThumbnail, getPdfPageCount };

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface PageDimensions {
  width: number;
  height: number;
}

export interface ReorderPdfResult {
  blob: Blob;
  fileName: string;
  originalPageCount: number;
  finalPageCount: number;
  removedPageIndices: number[];
  originalSize: number;
  reorderedSize: number;
}

/**
 * Get dimensions (in pts) for all pages in a PDF.
 */
export async function getPageDimensions(file: File): Promise<PageDimensions[]> {
  const { PDFDocument } = await import("pdf-lib");
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  return pdfDoc.getPages().map((page) => ({
    width: page.getWidth(),
    height: page.getHeight(),
  }));
}

/**
 * Reorder and optionally remove pages from a PDF.
 * Uses copyPages() for zero quality loss — pages are copied as-is.
 *
 * @param file - Source PDF file
 * @param pageOrder - Ordered array of original page indices (0-based) to include
 * @param onProgress - Progress callback for UI
 */
export async function reorderPdf(
  file: File,
  pageOrder: number[],
  onProgress: (update: ProcessingUpdate) => void
): Promise<ReorderPdfResult> {
  onProgress({ progress: 10, status: "Loading PDF..." });

  const { PDFDocument } = await import("pdf-lib");

  const arrayBuffer = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const originalPageCount = srcDoc.getPageCount();

  onProgress({
    progress: 25,
    status: `Processing ${pageOrder.length} page${pageOrder.length > 1 ? "s" : ""}...`,
  });

  const newDoc = await PDFDocument.create();

  for (let i = 0; i < pageOrder.length; i++) {
    const srcIndex = pageOrder[i];
    const [copiedPage] = await newDoc.copyPages(srcDoc, [srcIndex]);
    newDoc.addPage(copiedPage);

    onProgress({
      progress: 25 + ((i + 1) / pageOrder.length) * 55,
      status: `Copying page ${i + 1}/${pageOrder.length}...`,
    });
  }

  onProgress({ progress: 85, status: "Saving PDF..." });
  const pdfBytes = await newDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  // Compute removed page indices
  const includedSet = new Set(pageOrder);
  const removedPageIndices: number[] = [];
  for (let i = 0; i < originalPageCount; i++) {
    if (!includedSet.has(i)) {
      removedPageIndices.push(i);
    }
  }

  const baseName = file.name.replace(/\.pdf$/i, "");

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    fileName: `reordered-${baseName}.pdf`,
    originalPageCount,
    finalPageCount: pageOrder.length,
    removedPageIndices,
    originalSize: file.size,
    reorderedSize: blob.size,
  };
}
