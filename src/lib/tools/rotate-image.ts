/**
 * Rotate Image
 *
 * Rotates and flips images client-side using Canvas API.
 * Supports 90-degree increments and horizontal/vertical flip.
 * Format preservation: JPEG->JPEG, PNG->PNG.
 * Maximum quality output: JPEG quality 1.0, PNG lossless.
 */

export interface RotateImageOptions {
  rotation: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
  onProgress?: (update: { stage: string; progress: number }) => void;
}

export interface RotateImageResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

function detectMimeType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function loadImage(file: File): Promise<HTMLImageElement> {
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

export async function rotateImage(
  file: File,
  options: RotateImageOptions
): Promise<RotateImageResult> {
  const mimeType = detectMimeType(file);
  const report = options.onProgress ?? (() => {});

  report({ stage: "Loading image...", progress: 10 });
  const img = await loadImage(file);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  report({ stage: "Applying transformations...", progress: 30 });

  const { rotation, flipHorizontal, flipVertical } = options;
  const swap = rotation === 90 || rotation === 270;
  const canvasW = swap ? originalHeight : originalWidth;
  const canvasH = swap ? originalWidth : originalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  // White background for JPEG (before transforms)
  if (mimeType === "image/jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  // Apply transforms: translate to center, rotate, flip, draw centered
  ctx.translate(canvasW / 2, canvasH / 2);
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180);
  }
  ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
  ctx.drawImage(img, -originalWidth / 2, -originalHeight / 2);

  report({ stage: "Encoding...", progress: 70 });

  const quality = mimeType === "image/jpeg" ? 1.0 : undefined;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      mimeType,
      quality
    );
  });

  const previewUrl = URL.createObjectURL(blob);

  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  report({ stage: "Complete!", progress: 100 });

  return {
    blob,
    previewUrl,
    originalSize: file.size,
    processedSize: blob.size,
    width: canvasW,
    height: canvasH,
    originalWidth,
    originalHeight,
  };
}
