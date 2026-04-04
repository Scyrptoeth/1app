import { PDFDocument, degrees } from "pdf-lib";

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface PageInfo {
  fileIndex: number;
  fileName: string;
  pageIndex: number;
  pageLabel: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  included: boolean;
}

export interface MergePdfOptions {
  files: File[];
  pageOrder: PageInfo[];
  rotations?: Map<string, number>;
  onProgress?: (update: ProcessingUpdate) => void;
}

export interface MergePdfResult {
  blob: Blob;
  fileName: string;
  originalTotalSize: number;
  mergedSize: number;
  totalPages: number;
  sourceFiles: string[];
}

/**
 * Load all files and extract page info (dimensions) for the configure stage.
 * Returns PageInfo[] with all pages from all files in order.
 */
export async function extractPageInfos(files: File[]): Promise<PageInfo[]> {
  const pages: PageInfo[] = [];

  for (let fi = 0; fi < files.length; fi++) {
    const file = files[fi];
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer, {
      ignoreEncryption: true,
    });
    const pageCount = pdfDoc.getPageCount();

    for (let pi = 0; pi < pageCount; pi++) {
      const page = pdfDoc.getPage(pi);
      const { width, height } = page.getSize();
      pages.push({
        fileIndex: fi,
        fileName: file.name,
        pageIndex: pi,
        pageLabel: `${file.name} — Page ${pi + 1}`,
        width,
        height,
        included: true,
      });
    }
  }

  return pages;
}

/**
 * Render thumbnail for a single page using pdfjs-dist.
 * Returns a data URL string.
 */
export async function renderThumbnail(
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

  // Cleanup
  page.cleanup();
  pdfDoc.destroy();

  return dataUrl;
}

/**
 * Merge PDFs according to the given page order.
 * Uses pdf-lib copyPages to preserve quality byte-for-byte.
 */
export async function mergePdfs(
  options: MergePdfOptions
): Promise<MergePdfResult> {
  const { files, pageOrder, rotations, onProgress } = options;

  const report = (progress: number, status: string) => {
    onProgress?.({ progress, status });
  };

  // Filter to included pages only
  const includedPages = pageOrder.filter((p) => p.included);

  if (includedPages.length === 0) {
    throw new Error("No pages selected for merge.");
  }

  // Step 1: Load all source PDFs
  report(5, "Loading PDF files...");
  const sourceDocs: PDFDocument[] = [];
  const fileBuffers: ArrayBuffer[] = [];
  let originalTotalSize = 0;

  for (let i = 0; i < files.length; i++) {
    const buffer = await files[i].arrayBuffer();
    fileBuffers.push(buffer);
    originalTotalSize += buffer.byteLength;

    report(
      5 + Math.round((i / files.length) * 20),
      `Loading ${files[i].name}...`
    );

    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    sourceDocs.push(doc);
  }

  // Step 2: Create output document and copy pages
  report(30, "Merging pages...");
  const mergedDoc = await PDFDocument.create();

  for (let i = 0; i < includedPages.length; i++) {
    const pageInfo = includedPages[i];
    const sourceDoc = sourceDocs[pageInfo.fileIndex];

    const [copiedPage] = await mergedDoc.copyPages(sourceDoc, [
      pageInfo.pageIndex,
    ]);
    const rotationKey = `${pageInfo.fileIndex}-${pageInfo.pageIndex}`;
    const rotation = rotations?.get(rotationKey) || 0;
    if (rotation !== 0) {
      copiedPage.setRotation(degrees(rotation));
    }
    mergedDoc.addPage(copiedPage);

    report(
      30 + Math.round((i / includedPages.length) * 55),
      `Copying page ${i + 1} of ${includedPages.length}...`
    );
  }

  // Step 3: Save
  report(90, "Saving merged PDF...");
  const mergedBytes = await mergedDoc.save();
  const blob = new Blob([mergedBytes], { type: "application/pdf" });

  // Unique source file names
  const sourceFiles = [
    ...new Set(includedPages.map((p) => p.fileName)),
  ];

  report(100, "Done!");

  return {
    blob,
    fileName: "merged.pdf",
    originalTotalSize,
    mergedSize: mergedBytes.byteLength,
    totalPages: includedPages.length,
    sourceFiles,
  };
}
