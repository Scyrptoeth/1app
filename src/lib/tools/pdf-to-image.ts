// ============================================================================
// PDF to Image Converter
// Renders each PDF page to a high-quality PNG using pdfjs-dist.
// Designed for client-side (browser) execution in Next.js.
// ============================================================================

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------
export interface ProcessingUpdate {
  stage: string;
  progress: number;
}

export interface PageImage {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  pageNumber: number;
  fileSize: number;
}

export interface PdfToImageResult {
  pages: PageImage[];
  totalPages: number;
  qualityScore: number;
  pdfFileName: string;
  originalFileSize: number;
}

// ---------------------------------------------------------------------------
// Quality score helpers
// ---------------------------------------------------------------------------
function pageQualityScore(width: number, height: number): number {
  if (width >= 2400 && height >= 3000) return 90; // High
  if (width >= 1200 && height >= 1500) return 65; // Medium
  return 30;                                        // Low
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function convertPdfToImages(
  file: ArrayBuffer,
  fileName: string,
  onProgress?: (update: ProcessingUpdate) => void,
  options?: { scale?: number }
): Promise<PdfToImageResult> {
  const scale = options?.scale ?? 2.0;

  onProgress?.({ stage: 'Loading PDF library...', progress: 2 });

  // Dynamic import — avoids SSR/webpack issues in Next.js (same as pdf-to-excel)
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  onProgress?.({ stage: 'Reading PDF file...', progress: 5 });
  const pdf = await pdfjsLib.getDocument({ data: file }).promise;
  const totalPages = pdf.numPages;

  const pages: PageImage[] = [];
  const qualityScores: number[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const progressBase = 5 + Math.round(((pageNum - 1) / totalPages) * 90);
    onProgress?.({
      stage: `Rendering page ${pageNum} of ${totalPages}...`,
      progress: progressBase,
    });

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas PNG export failed'))),
        'image/png'
      );
    });

    const previewUrl = URL.createObjectURL(blob);
    qualityScores.push(pageQualityScore(canvas.width, canvas.height));

    pages.push({
      blob,
      previewUrl,
      width: canvas.width,
      height: canvas.height,
      pageNumber: pageNum,
      fileSize: blob.size,
    });
  }

  onProgress?.({ stage: 'Done', progress: 100 });

  return {
    pages,
    totalPages,
    qualityScore: average(qualityScores),
    pdfFileName: fileName,
    originalFileSize: file.byteLength,
  };
}
