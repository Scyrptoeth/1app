import { PDFDocument, degrees } from "pdf-lib";

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface SplitGroup {
  id: string;
  label: string;
  pageIndices: number[]; // 0-based index referring to original PDF pages
}

export interface SplitPdfFileResult {
  label: string;
  blob: Blob;
  pageCount: number;
}

export interface SplitPdfResult {
  files: SplitPdfFileResult[];
  originalPageCount: number;
  originalSize: number;
}

export interface SplitPdfOptions {
  file: File;
  groups: SplitGroup[];
  rotations?: Map<number, number>;
  onProgress?: (update: ProcessingUpdate) => void;
}

/**
 * Render a single page thumbnail using pdfjs-dist.
 * Returns a data URL string.
 */
export async function renderPageThumbnail(
  file: File,
  pageIndex: number,
  thumbWidth: number = 150
): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdfDoc.getPage(pageIndex + 1); // pdfjs uses 1-based

  const viewport = page.getViewport({ scale: 1 });
  const scale = thumbWidth / viewport.width;
  const scaledViewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = scaledViewport.width;
  canvas.height = scaledViewport.height;
  const ctx = canvas.getContext("2d")!;

  await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.6);

  page.cleanup();
  pdfDoc.destroy();

  return dataUrl;
}

/**
 * Get total page count from a PDF file using pdf-lib.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
  });
  return pdfDoc.getPageCount();
}

/**
 * Split a PDF into multiple files based on groups.
 * Uses pdf-lib copyPages() for zero quality loss — pages are copied byte-for-byte.
 */
export async function splitPdf(
  options: SplitPdfOptions
): Promise<SplitPdfResult> {
  const { file, groups, rotations, onProgress } = options;

  const report = (progress: number, status: string) => {
    onProgress?.({ progress, status });
  };

  // Filter out empty groups
  const activeGroups = groups.filter((g) => g.pageIndices.length > 0);

  if (activeGroups.length === 0) {
    throw new Error("No groups with pages to split.");
  }

  // Step 1: Load the source PDF
  report(5, "Loading PDF file...");
  const arrayBuffer = await file.arrayBuffer();
  const originalSize = arrayBuffer.byteLength;
  const sourceDoc = await PDFDocument.load(arrayBuffer, {
    ignoreEncryption: true,
  });
  const originalPageCount = sourceDoc.getPageCount();

  // Step 2: Create output PDFs for each group
  const files: SplitPdfFileResult[] = [];
  const totalPages = activeGroups.reduce(
    (sum, g) => sum + g.pageIndices.length,
    0
  );
  let processedPages = 0;

  for (let gi = 0; gi < activeGroups.length; gi++) {
    const group = activeGroups[gi];

    report(
      10 + Math.round((processedPages / totalPages) * 80),
      `Creating "${group.label}"...`
    );

    const newDoc = await PDFDocument.create();

    for (const pageIndex of group.pageIndices) {
      const [copiedPage] = await newDoc.copyPages(sourceDoc, [pageIndex]);
      const rotation = rotations?.get(pageIndex) || 0;
      if (rotation !== 0) {
        copiedPage.setRotation(degrees(rotation));
      }
      newDoc.addPage(copiedPage);
      processedPages++;

      report(
        10 + Math.round((processedPages / totalPages) * 80),
        `Copying page ${processedPages} of ${totalPages}...`
      );
    }

    const pdfBytes = await newDoc.save();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });

    files.push({
      label: group.label,
      blob,
      pageCount: group.pageIndices.length,
    });
  }

  report(95, "Preparing downloads...");
  report(100, "Done!");

  return {
    files,
    originalPageCount,
    originalSize,
  };
}

/**
 * Create a ZIP file containing all split PDFs using fflate.
 */
export async function createZip(
  files: SplitPdfFileResult[]
): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");

  const zipData: Record<string, Uint8Array> = {};

  for (const file of files) {
    const arrayBuffer = await file.blob.arrayBuffer();
    const fileName = `${file.label}.pdf`;
    zipData[fileName] = new Uint8Array(arrayBuffer);
  }

  // Use strToU8 as a no-op reference to verify import works
  void strToU8;

  const zipped = zipSync(zipData);
  return new Blob([zipped], { type: "application/zip" });
}
