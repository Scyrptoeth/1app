/**
 * Crop Image
 *
 * Crops images client-side using Canvas API.
 * Supports rotation (0/90/180/270) applied before crop.
 * Format preservation: JPEG→JPEG, PNG→PNG.
 * Maximum quality output: JPEG quality 1.0, PNG lossless.
 */

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropImageOptions {
  cropArea: CropArea;
  rotation: 0 | 90 | 180 | 270;
}

export interface CropImageResult {
  blob: Blob;
  previewUrl: string;
  originalWidth: number;
  originalHeight: number;
  croppedWidth: number;
  croppedHeight: number;
  originalSize: number;
  croppedSize: number;
  format: "jpeg" | "png";
}

function detectFormat(file: File): "jpeg" | "png" {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "png";
  return "jpeg";
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

export async function cropImage(
  file: File,
  options: CropImageOptions,
  onProgress?: (update: { stage: string; progress: number }) => void
): Promise<CropImageResult> {
  const format = detectFormat(file);
  const report = onProgress ?? (() => {});

  report({ stage: "Loading image...", progress: 10 });
  const img = await loadImage(file);
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;

  report({ stage: "Preparing...", progress: 30 });

  const { rotation, cropArea } = options;
  const swap = rotation === 90 || rotation === 270;
  const rotatedW = swap ? originalHeight : originalWidth;
  const rotatedH = swap ? originalWidth : originalHeight;

  // Create rotated source canvas
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = rotatedW;
  sourceCanvas.height = rotatedH;
  const sourceCtx = sourceCanvas.getContext("2d")!;

  if (rotation !== 0) {
    sourceCtx.translate(rotatedW / 2, rotatedH / 2);
    sourceCtx.rotate((rotation * Math.PI) / 180);
    sourceCtx.drawImage(img, -originalWidth / 2, -originalHeight / 2);
  } else {
    sourceCtx.drawImage(img, 0, 0);
  }

  report({ stage: "Cropping...", progress: 60 });

  // Clamp crop area to rotated dimensions
  const cx = Math.round(Math.max(0, Math.min(cropArea.x, rotatedW - 1)));
  const cy = Math.round(Math.max(0, Math.min(cropArea.y, rotatedH - 1)));
  const cw = Math.round(Math.max(1, Math.min(cropArea.width, rotatedW - cx)));
  const ch = Math.round(Math.max(1, Math.min(cropArea.height, rotatedH - cy)));

  // Crop canvas
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cw;
  cropCanvas.height = ch;
  const cropCtx = cropCanvas.getContext("2d")!;

  // White background for JPEG (no alpha channel)
  if (format === "jpeg") {
    cropCtx.fillStyle = "#FFFFFF";
    cropCtx.fillRect(0, 0, cw, ch);
  }

  cropCtx.drawImage(sourceCanvas, cx, cy, cw, ch, 0, 0, cw, ch);

  report({ stage: "Encoding...", progress: 80 });

  const mimeType = format === "png" ? "image/png" : "image/jpeg";
  const quality = format === "jpeg" ? 1.0 : undefined;

  const blob = await new Promise<Blob>((resolve, reject) => {
    cropCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      mimeType,
      quality
    );
  });

  const previewUrl = URL.createObjectURL(blob);

  // Cleanup canvases
  sourceCanvas.width = 0;
  sourceCanvas.height = 0;
  cropCanvas.width = 0;
  cropCanvas.height = 0;

  report({ stage: "Complete!", progress: 100 });

  return {
    blob,
    previewUrl,
    originalWidth,
    originalHeight,
    croppedWidth: cw,
    croppedHeight: ch,
    originalSize: file.size,
    croppedSize: blob.size,
    format,
  };
}
