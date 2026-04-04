/**
 * Resize Image
 *
 * Resizes images to standard formal/administrative photo sizes at 300 DPI.
 * Multi-step downscale for maximum quality. Client-side only via Canvas API.
 */

export interface PhotoPreset {
  id: string;
  label: string;
  widthCm: number;
  heightCm: number;
  description: string;
  widthPx: number;
  heightPx: number;
}

export const PRINT_DPI = 300;

function cmToPx(cm: number): number {
  return Math.round((cm / 2.54) * PRINT_DPI);
}

export const PHOTO_PRESETS: PhotoPreset[] = [
  { id: "2x3", label: "2\u00d73", widthCm: 2, heightCm: 3, description: "KTP, Ijazah, BPJS", widthPx: cmToPx(2), heightPx: cmToPx(3) },
  { id: "3x4", label: "3\u00d74", widthCm: 3, heightCm: 4, description: "SKCK, SIM, Paspor", widthPx: cmToPx(3), heightPx: cmToPx(4) },
  { id: "4x6", label: "4\u00d76", widthCm: 4, heightCm: 6, description: "Visa, Lamaran Kerja", widthPx: cmToPx(4), heightPx: cmToPx(6) },
  { id: "2x2", label: "2\u00d72", widthCm: 2, heightCm: 2, description: "Formulir, Stamp", widthPx: cmToPx(2), heightPx: cmToPx(2) },
  { id: "3.5x4.5", label: "3.5\u00d74.5", widthCm: 3.5, heightCm: 4.5, description: "Paspor Eropa, Visa Schengen", widthPx: cmToPx(3.5), heightPx: cmToPx(4.5) },
  { id: "2x2inch", label: "2\u00d72\"", widthCm: 5.08, heightCm: 5.08, description: "Paspor US, Green Card", widthPx: 600, heightPx: 600 },
];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeImageResult {
  blob: Blob;
  previewUrl: string;
  originalWidth: number;
  originalHeight: number;
  originalSize: number;
  resizedWidth: number;
  resizedHeight: number;
  resizedSize: number;
  preset: PhotoPreset;
}

/**
 * Resize image by cropping a source region and scaling to target preset dimensions.
 * Uses multi-step downscale for best quality. Output: JPEG Q=1.0 with 300 DPI metadata.
 */
export async function resizeImage(
  source: Blob,
  preset: PhotoPreset,
  cropRect: CropRect,
  onProgress?: (update: { stage: string; progress: number }) => void
): Promise<ResizeImageResult> {
  onProgress?.({ stage: "Loading image...", progress: 10 });

  const img = await loadImage(source);

  onProgress?.({ stage: `Resizing to ${preset.label} cm...`, progress: 30 });

  const canvas = multiStepResize(
    img,
    cropRect.x, cropRect.y, cropRect.width, cropRect.height,
    preset.widthPx, preset.heightPx
  );

  onProgress?.({ stage: "Encoding JPEG at 300 DPI...", progress: 70 });

  let blob = await canvasToJpeg(canvas, 1.0);
  canvas.width = 0;
  canvas.height = 0;

  blob = await setJpegDpi(blob, PRINT_DPI);

  const previewUrl = URL.createObjectURL(blob);

  onProgress?.({ stage: "Complete!", progress: 100 });

  return {
    blob,
    previewUrl,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    originalSize: source.size,
    resizedWidth: preset.widthPx,
    resizedHeight: preset.heightPx,
    resizedSize: blob.size,
    preset,
  };
}

/**
 * Multi-step downscale: halve dimensions until within 2x of target, then final resize.
 * Produces significantly better quality than a single large downscale.
 */
function multiStepResize(
  img: HTMLImageElement,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): HTMLCanvasElement {
  // Step 1: extract source region at full resolution
  let canvas = document.createElement("canvas");
  canvas.width = Math.round(srcW);
  canvas.height = Math.round(srcH);
  let ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

  // Step 2: halve until close to target
  while (canvas.width > dstW * 2 || canvas.height > dstH * 2) {
    const halfW = Math.max(dstW, Math.round(canvas.width / 2));
    const halfH = Math.max(dstH, Math.round(canvas.height / 2));
    const next = document.createElement("canvas");
    next.width = halfW;
    next.height = halfH;
    const nctx = next.getContext("2d")!;
    nctx.imageSmoothingEnabled = true;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(canvas, 0, 0, halfW, halfH);
    canvas.width = 0;
    canvas.height = 0;
    canvas = next;
  }

  // Step 3: final resize to exact target
  if (canvas.width !== dstW || canvas.height !== dstH) {
    const fin = document.createElement("canvas");
    fin.width = dstW;
    fin.height = dstH;
    const fctx = fin.getContext("2d")!;
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = "high";
    fctx.drawImage(canvas, 0, 0, dstW, dstH);
    canvas.width = 0;
    canvas.height = 0;
    return fin;
  }

  return canvas;
}

function loadImage(src: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG export failed"))),
      "image/jpeg",
      quality
    );
  });
}

/** Patch JPEG JFIF header to embed DPI metadata. */
async function setJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Verify: SOI (FF D8) + APP0 (FF E0) + JFIF identifier
  if (
    bytes.length > 18 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[3] === 0xe0 &&
    bytes[6] === 0x4a &&
    bytes[7] === 0x46 &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46
  ) {
    bytes[13] = 1; // density units = DPI
    bytes[14] = (dpi >> 8) & 0xff; // X density high byte
    bytes[15] = dpi & 0xff; // X density low byte
    bytes[16] = (dpi >> 8) & 0xff; // Y density high byte
    bytes[17] = dpi & 0xff; // Y density low byte
  }
  return new Blob([bytes], { type: "image/jpeg" });
}
