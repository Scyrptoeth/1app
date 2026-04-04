// ─── Image-to-PDF Converter ─────────────────────────────────────────
// Convert one or more images into a PDF file using jsPDF.
// Processing is 100% client-side — no server upload.

export interface ImageItem {
  file: File;
  id: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  rotation: number; // 0, 90, 180, 270
  removed: boolean;
  orientation: "portrait" | "landscape" | "auto";
}

export interface PageSize {
  name: string;
  width: number; // mm
  height: number; // mm
}

export const PAGE_SIZES: PageSize[] = [
  { name: "A4", width: 210, height: 297 },
  { name: "Letter", width: 215.9, height: 279.4 },
  { name: "Legal", width: 215.9, height: 355.6 },
  { name: "F4/Folio", width: 215, height: 330 },
  { name: "A3", width: 297, height: 420 },
  { name: "A5", width: 148, height: 210 },
  { name: "Fit to Image", width: 0, height: 0 },
];

export type MarginOption = "none" | "small" | "big";

export interface ConvertOptions {
  pageSize: PageSize;
  globalOrientation: "portrait" | "landscape";
  margin: MarginOption;
  mergeAll: boolean;
}

export interface ProcessingUpdate {
  stage: string;
  progress: number;
}

export interface ImageToPdfResult {
  blob: Blob;
  fileName: string;
  pageCount: number;
  totalSize: number;
  originalImageCount: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const MARGIN_MM: Record<MarginOption, number> = {
  none: 0,
  small: 10,
  big: 20,
};

const PX_TO_MM = 25.4 / 72;

// ─── Lazy-loaded jsPDF ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _JsPDF: any = null;
async function getJsPDF() {
  if (_JsPDF) return _JsPDF;
  const mod = await import("jspdf");
  _JsPDF = mod.default;
  return _JsPDF;
}

// ─── Helpers ────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function normalizeRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

function renderRotatedImage(
  img: HTMLImageElement,
  rotation: number
): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const rot = normalizeRotation(rotation);

  if (rot === 90 || rot === 270) {
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
  } else {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
  }

  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  return {
    dataUrl: canvas.toDataURL("image/png", 1.0),
    width: canvas.width,
    height: canvas.height,
  };
}

function getImageFormat(file: File): "JPEG" | "PNG" {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "JPEG";
  return "PNG";
}

// ─── Public helpers ─────────────────────────────────────────────────

export async function loadImageDimensions(
  file: File
): Promise<{ width: number; height: number; thumbnailUrl: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight, thumbnailUrl: url };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Failed to load image: ${file.name}`);
  }
}

export function createThumbnailUrl(file: File): string {
  return URL.createObjectURL(file);
}

// ─── Core conversion ────────────────────────────────────────────────

async function buildPdfFromImages(
  images: ImageItem[],
  options: ConvertOptions,
  onProgress?: (update: ProcessingUpdate) => void,
  progressOffset = 0,
  progressScale = 90,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ blob: Blob; pageCount: number }> {
  const JsPDF = await getJsPDF();
  const margin = MARGIN_MM[options.margin];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = null;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];

    onProgress?.({
      stage: `Converting image ${i + 1} of ${images.length}...`,
      progress: progressOffset + (i / images.length) * progressScale,
    });

    const dataUrl = await fileToDataUrl(item.file);
    const img = await loadImage(dataUrl);

    let imgData: string;
    let imgW: number;
    let imgH: number;
    let imgFormat: "JPEG" | "PNG";

    const rot = normalizeRotation(item.rotation);
    if (rot !== 0) {
      const rotated = renderRotatedImage(img, rot);
      imgData = rotated.dataUrl;
      imgW = rotated.width;
      imgH = rotated.height;
      imgFormat = "PNG";
    } else {
      imgData = dataUrl;
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;
      imgFormat = getImageFormat(item.file);
    }

    // Determine effective orientation
    const orientation =
      item.orientation !== "auto" ? item.orientation : options.globalOrientation;

    // Determine page dimensions
    let pageW: number;
    let pageH: number;

    if (options.pageSize.name === "Fit to Image") {
      pageW = imgW * PX_TO_MM + margin * 2;
      pageH = imgH * PX_TO_MM + margin * 2;
    } else {
      pageW = options.pageSize.width;
      pageH = options.pageSize.height;
      if (orientation === "landscape") {
        [pageW, pageH] = [pageH, pageW];
      }
    }

    // Available area after margins
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;

    // Scale image to fit (contain) — never upscale beyond page
    const imgWMm = imgW * PX_TO_MM;
    const imgHMm = imgH * PX_TO_MM;
    let displayW: number;
    let displayH: number;

    if (options.pageSize.name === "Fit to Image") {
      displayW = imgWMm;
      displayH = imgHMm;
    } else {
      const scale = Math.min(availW / imgWMm, availH / imgHMm);
      displayW = imgWMm * scale;
      displayH = imgHMm * scale;
    }

    // Center in available area
    const x = margin + (availW - displayW) / 2;
    const y = margin + (availH - displayH) / 2;

    if (i === 0) {
      doc = new JsPDF({
        orientation: pageW > pageH ? "landscape" : "portrait",
        unit: "mm",
        format: [Math.min(pageW, pageH), Math.max(pageW, pageH)],
      });
      // Set actual page size — jsPDF auto-arranges format based on orientation
      // So we need to verify the page dimensions are correct
    } else {
      doc.addPage(
        [Math.min(pageW, pageH), Math.max(pageW, pageH)],
        pageW > pageH ? "landscape" : "portrait"
      );
    }

    doc.addImage(imgData, imgFormat, x, y, displayW, displayH);
  }

  const blob = doc.output("blob") as Blob;
  return { blob, pageCount: images.length };
}

// ─── Main export ────────────────────────────────────────────────────

export async function convertImagesToPdf(
  images: ImageItem[],
  options: ConvertOptions,
  onProgress?: (update: ProcessingUpdate) => void,
): Promise<ImageToPdfResult> {
  const activeImages = images.filter((img) => !img.removed);

  if (activeImages.length === 0) {
    throw new Error("No images to convert");
  }

  if (options.mergeAll || activeImages.length === 1) {
    const { blob, pageCount } = await buildPdfFromImages(
      activeImages,
      options,
      onProgress,
    );

    onProgress?.({ stage: "Complete!", progress: 100 });

    return {
      blob,
      fileName: "images.pdf",
      pageCount,
      totalSize: blob.size,
      originalImageCount: activeImages.length,
    };
  } else {
    // Individual PDFs → ZIP
    const { zipSync } = await import("fflate");

    const files: Record<string, Uint8Array> = {};

    for (let i = 0; i < activeImages.length; i++) {
      const img = activeImages[i];
      const perImgProgress = (85 / activeImages.length);

      onProgress?.({
        stage: `Converting image ${i + 1} of ${activeImages.length}...`,
        progress: i * perImgProgress,
      });

      const { blob } = await buildPdfFromImages([img], options);
      const buffer = await blob.arrayBuffer();
      const baseName = img.file.name.replace(/\.[^.]+$/, "");
      files[`${baseName}.pdf`] = new Uint8Array(buffer);
    }

    onProgress?.({ stage: "Creating ZIP...", progress: 90 });

    const zipped = zipSync(files);
    const zipBlob = new Blob([zipped], { type: "application/zip" });

    onProgress?.({ stage: "Complete!", progress: 100 });

    return {
      blob: zipBlob,
      fileName: "images.zip",
      pageCount: activeImages.length,
      totalSize: zipBlob.size,
      originalImageCount: activeImages.length,
    };
  }
}
