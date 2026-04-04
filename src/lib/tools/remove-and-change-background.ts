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
 * Composite foreground (bg-removed) onto a custom image background.
 * Background is scaled/cropped to cover the entire canvas (object-fit: cover logic).
 * Output: PNG at original dimensions, quality 1.0.
 */
export async function addImageBackground(
  foregroundBlob: Blob,
  backgroundFile: File,
  originalWidth: number,
  originalHeight: number
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

  // Draw background with "cover" logic
  const bgW = bg.naturalWidth;
  const bgH = bg.naturalHeight;
  const targetRatio = originalWidth / originalHeight;
  const bgRatio = bgW / bgH;

  let sx: number, sy: number, sw: number, sh: number;
  if (bgRatio > targetRatio) {
    // Background is wider — crop sides
    sh = bgH;
    sw = bgH * targetRatio;
    sx = (bgW - sw) / 2;
    sy = 0;
  } else {
    // Background is taller — crop top/bottom
    sw = bgW;
    sh = bgW / targetRatio;
    sx = 0;
    sy = (bgH - sh) / 2;
  }

  ctx.drawImage(bg, sx, sy, sw, sh, 0, 0, originalWidth, originalHeight);

  // Draw foreground on top
  ctx.drawImage(fg, 0, 0, originalWidth, originalHeight);

  const blob = await canvasToBlob(canvas);
  const previewUrl = URL.createObjectURL(blob);

  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  return { blob, previewUrl, processedSize: blob.size };
}
