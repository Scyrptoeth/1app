/**
 * Remove & Change Background
 *
 * AI-powered background removal using @imgly/background-removal (ONNX, client-side).
 * Compositing (color/image background) via Canvas API.
 * Format: always outputs PNG for transparency support.
 * Quality: maximum — no downscaling, no lossy compression.
 *
 * CRITICAL: @imgly/background-removal MUST be dynamically imported.
 * Static import causes build errors / page freeze in Next.js.
 */

export interface RemoveBackgroundResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
}

export interface CompositeResult {
  blob: Blob;
  previewUrl: string;
  processedSize: number;
}

/**
 * 9-point position grid for background image placement.
 * Maps to anchor points on the canvas.
 */
export type BgPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ImageBgOptions {
  /** Scale percentage: 50–300. 100 = cover (default). */
  scale: number;
  /** Anchor position on the canvas. Default: "center". */
  position: BgPosition;
}

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    const img = new Image();
    img.onload = () => {
      if (src instanceof Blob) URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (src instanceof Blob) URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

function loadFileAsImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png",
      1.0
    );
  });
}

/**
 * Remove background from an image using AI (client-side ONNX inference).
 * Model is downloaded once (~5-10MB) and cached by the browser.
 */
export async function removeImageBackground(
  file: File,
  onProgress: (update: { stage: string; progress: number }) => void
): Promise<RemoveBackgroundResult> {
  onProgress({ stage: "Loading image...", progress: 5 });

  // Get original dimensions
  const originalImg = await loadFileAsImage(file);
  const width = originalImg.naturalWidth;
  const height = originalImg.naturalHeight;

  onProgress({ stage: "Downloading AI model (first time only)...", progress: 10 });

  // Dynamic import — MUST NOT be static
  const { removeBackground } = await import("@imgly/background-removal");

  onProgress({ stage: "Removing background...", progress: 30 });

  const result = await removeBackground(file, {
    model: "small",
    output: {
      format: "image/png",
      quality: 1.0,
    },
    progress: (key: string, current: number, total: number) => {
      if (total > 0) {
        const pct = Math.round((current / total) * 100);
        if (key.includes("fetch") || key.includes("download")) {
          onProgress({
            stage: "Downloading AI model (first time only)...",
            progress: 10 + Math.round(pct * 0.2),
          });
        } else {
          onProgress({
            stage: "Removing background...",
            progress: 30 + Math.round(pct * 0.6),
          });
        }
      }
    },
  });

  const blob = result as Blob;
  const previewUrl = URL.createObjectURL(blob);

  onProgress({ stage: "Complete!", progress: 100 });

  return {
    blob,
    previewUrl,
    originalSize: file.size,
    processedSize: blob.size,
    width,
    height,
  };
}

/**
 * Composite foreground (bg-removed) onto a solid color background.
 * Output: PNG at original dimensions, quality 1.0.
 */
export async function addColorBackground(
  foregroundBlob: Blob,
  color: string,
  originalWidth: number,
  originalHeight: number
): Promise<CompositeResult> {
  const fg = await loadImage(foregroundBlob);

  const canvas = document.createElement("canvas");
  canvas.width = originalWidth;
  canvas.height = originalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Fill solid color
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, originalWidth, originalHeight);

  // Draw foreground on top
  ctx.drawImage(fg, 0, 0, originalWidth, originalHeight);

  const blob = await canvasToBlob(canvas);
  const previewUrl = URL.createObjectURL(blob);

  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  return { blob, previewUrl, processedSize: blob.size };
}

/**
 * Compute the drawn position and size for a background image given
 * canvas dimensions, bg natural dimensions, scale %, and anchor position.
 */
function computeBgDrawParams(
  canvasW: number,
  canvasH: number,
  bgNatW: number,
  bgNatH: number,
  scale: number,
  position: BgPosition
): { dx: number; dy: number; dw: number; dh: number } {
  // At scale 100%, the background covers the canvas (object-fit: cover).
  const canvasRatio = canvasW / canvasH;
  const bgRatio = bgNatW / bgNatH;

  let baseW: number;
  let baseH: number;
  if (bgRatio > canvasRatio) {
    // bg is wider than canvas ratio — match height, overflow width
    baseH = canvasH;
    baseW = (bgNatW / bgNatH) * canvasH;
  } else {
    // bg is taller — match width, overflow height
    baseW = canvasW;
    baseH = (bgNatH / bgNatW) * canvasW;
  }

  // Apply user scale
  const factor = scale / 100;
  const dw = baseW * factor;
  const dh = baseH * factor;

  // Anchor position mapping — determines which point of the drawn bg
  // is anchored to which point of the canvas.
  let anchorX: number; // 0 = left, 0.5 = center, 1 = right
  let anchorY: number; // 0 = top, 0.5 = center, 1 = bottom
  switch (position) {
    case "top-left":
      anchorX = 0; anchorY = 0; break;
    case "top-center":
      anchorX = 0.5; anchorY = 0; break;
    case "top-right":
      anchorX = 1; anchorY = 0; break;
    case "center-left":
      anchorX = 0; anchorY = 0.5; break;
    case "center":
      anchorX = 0.5; anchorY = 0.5; break;
    case "center-right":
      anchorX = 1; anchorY = 0.5; break;
    case "bottom-left":
      anchorX = 0; anchorY = 1; break;
    case "bottom-center":
      anchorX = 0.5; anchorY = 1; break;
    case "bottom-right":
      anchorX = 1; anchorY = 1; break;
  }

  // dx/dy: top-left corner of the drawn bg image
  const dx = anchorX * canvasW - anchorX * dw;
  const dy = anchorY * canvasH - anchorY * dh;

  return { dx, dy, dw, dh };
}

/**
 * Composite foreground (bg-removed) onto a custom image background.
 * Scale and position control how the background image is placed.
 * Output: PNG at original dimensions, quality 1.0.
 */
export async function addImageBackground(
  foregroundBlob: Blob,
  backgroundFile: File,
  originalWidth: number,
  originalHeight: number,
  options: ImageBgOptions = { scale: 100, position: "center" }
): Promise<CompositeResult> {
  const [fg, bg] = await Promise.all([
    loadImage(foregroundBlob),
    loadFileAsImage(backgroundFile),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = originalWidth;
  canvas.height = originalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Compute bg draw params
  const { dx, dy, dw, dh } = computeBgDrawParams(
    originalWidth,
    originalHeight,
    bg.naturalWidth,
    bg.naturalHeight,
    options.scale,
    options.position
  );

  ctx.drawImage(bg, dx, dy, dw, dh);

  // Draw foreground on top
  ctx.drawImage(fg, 0, 0, originalWidth, originalHeight);

  const blob = await canvasToBlob(canvas);
  const previewUrl = URL.createObjectURL(blob);

  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  return { blob, previewUrl, processedSize: blob.size };
}
