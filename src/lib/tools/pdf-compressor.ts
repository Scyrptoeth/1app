/**
 * PDF Compressor
 *
 * Compresses PDFs by re-rendering pages to JPEG at configurable DPI and quality.
 * Uses pdfjs-dist for rendering and pdf-lib for PDF creation.
 * 100% client-side processing.
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface CompressionMode {
  id: "high" | "medium" | "low";
  label: string;
  description: string;
  dpi: number;
  quality: number;
  estimateRatio: number;
}

export interface CompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  pageCount: number;
  mode: CompressionMode;
  previewUrl: string;
}

export const COMPRESSION_MODES: CompressionMode[] = [
  {
    id: "high",
    label: "High Compress, Low Quality",
    description:
      "Maximum compression. Text remains readable but images will be noticeably lower quality.",
    dpi: 72,
    quality: 0.35,
    estimateRatio: 0.3,
  },
  {
    id: "medium",
    label: "Medium Compress, Medium Quality",
    description:
      "Balanced compression. Good quality for most documents with significant size reduction.",
    dpi: 120,
    quality: 0.65,
    estimateRatio: 0.6,
  },
  {
    id: "low",
    label: "Low Compress, High Quality",
    description:
      "Minimal compression. Quality is nearly identical to the original file.",
    dpi: 150,
    quality: 0.87,
    estimateRatio: 0.85,
  },
];

export function estimateCompressedSize(
  originalSize: number,
  mode: CompressionMode
): number {
  return Math.round(originalSize * mode.estimateRatio);
}

export async function compressPdf(
  file: File,
  mode: CompressionMode,
  onProgress: (update: ProcessingUpdate) => void
): Promise<CompressionResult> {
  onProgress({ progress: 2, status: "Loading libraries..." });

  // Dynamic imports — avoids SSR/webpack issues in Next.js
  const pdfjsLib = await import("pdfjs-dist");
  const { PDFDocument } = await import("pdf-lib");

  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  onProgress({ progress: 5, status: "Reading PDF..." });
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageCount = pdf.numPages;

  onProgress({
    progress: 10,
    status: `Compressing ${pageCount} page${pageCount > 1 ? "s" : ""}...`,
  });

  const newPdf = await PDFDocument.create();
  const scale = mode.dpi / 72;
  let previewUrl = "";

  for (let i = 1; i <= pageCount; i++) {
    const progressPercent = 10 + Math.round(((i - 1) / pageCount) * 80);
    onProgress({
      progress: progressPercent,
      status: `Compressing page ${i} of ${pageCount}...`,
    });

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    // Render page to canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Convert to JPEG blob
    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Canvas JPEG export failed")),
        "image/jpeg",
        mode.quality
      );
    });

    // Generate preview URL for first page only
    if (i === 1) {
      previewUrl = URL.createObjectURL(jpegBlob);
    }

    // Embed JPEG in new PDF
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const jpegImage = await newPdf.embedJpg(jpegBytes);

    // Use original page dimensions (PDF points at 72 DPI)
    const originalViewport = page.getViewport({ scale: 1 });
    const pdfPage = newPdf.addPage([
      originalViewport.width,
      originalViewport.height,
    ]);

    pdfPage.drawImage(jpegImage, {
      x: 0,
      y: 0,
      width: originalViewport.width,
      height: originalViewport.height,
    });

    // Free canvas memory
    canvas.width = 0;
    canvas.height = 0;
  }

  onProgress({ progress: 92, status: "Saving compressed PDF..." });
  const pdfBytes = await newPdf.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  const compressionRatio = Math.round((1 - blob.size / file.size) * 100);

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: Math.max(compressionRatio, 0),
    pageCount,
    mode,
    previewUrl,
  };
}
