/**
 * Image Compressor
 *
 * Compresses JPEG/PNG images client-side using Canvas API.
 * - JPEG: re-encodes at lower quality via canvas.toBlob
 * - PNG: Median Cut color quantization to reduce unique colors, then re-encode
 *
 * Dimensions are always preserved. PNG alpha channel is never modified.
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface ImageCompressionMode {
  id: "high" | "medium" | "low";
  label: string;
  description: string;
  jpegQuality: number;
  pngColorCount: number;
  estimateRatio: number;
}

export interface ImageCompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  width: number;
  height: number;
  format: "jpeg" | "png";
  previewUrl: string;
}

export const COMPRESSION_MODES: ImageCompressionMode[] = [
  {
    id: "high",
    label: "High Compress, Low Quality",
    description:
      "Maximum compression. Images will be noticeably lower quality but much smaller.",
    jpegQuality: 0.3,
    pngColorCount: 24,
    estimateRatio: 0.3,
  },
  {
    id: "medium",
    label: "Medium Compress, Medium Quality",
    description:
      "Balanced compression. Good quality for most images with significant size reduction.",
    jpegQuality: 0.6,
    pngColorCount: 80,
    estimateRatio: 0.55,
  },
  {
    id: "low",
    label: "Low Compress, High Quality",
    description:
      "Minimal compression. Quality is nearly identical to the original image.",
    jpegQuality: 0.85,
    pngColorCount: 224,
    estimateRatio: 0.8,
  },
];

export function estimateCompressedSize(
  originalSize: number,
  mode: ImageCompressionMode
): number {
  return Math.round(originalSize * mode.estimateRatio);
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

// ---------------------------------------------------------------------------
// Median Cut Color Quantization (for PNG)
// ---------------------------------------------------------------------------

interface ColorBox {
  pixels: Uint8Array; // flat array: [r, g, b, r, g, b, ...]
  count: number;
}

function buildColorBox(
  imageData: ImageData,
  sampleSize: number
): ColorBox {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const step = Math.max(1, Math.floor(totalPixels / sampleSize));

  const sampled: number[] = [];
  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    // Skip fully transparent pixels — they don't contribute to visible color
    if (data[idx + 3] === 0) continue;
    sampled.push(data[idx], data[idx + 1], data[idx + 2]);
  }

  return {
    pixels: new Uint8Array(sampled),
    count: sampled.length / 3,
  };
}

function findLongestAxis(box: ColorBox): number {
  let minR = 255, maxR = 0;
  let minG = 255, maxG = 0;
  let minB = 255, maxB = 0;

  for (let i = 0; i < box.pixels.length; i += 3) {
    const r = box.pixels[i];
    const g = box.pixels[i + 1];
    const b = box.pixels[i + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  const rangeR = maxR - minR;
  const rangeG = maxG - minG;
  const rangeB = maxB - minB;

  if (rangeR >= rangeG && rangeR >= rangeB) return 0;
  if (rangeG >= rangeR && rangeG >= rangeB) return 1;
  return 2;
}

function splitBox(box: ColorBox, axis: number): [ColorBox, ColorBox] {
  // Sort pixels by the specified axis using a counting sort approach
  const buckets: number[][] = new Array(256);
  for (let i = 0; i < 256; i++) buckets[i] = [];

  for (let i = 0; i < box.pixels.length; i += 3) {
    const val = box.pixels[i + axis];
    buckets[val].push(box.pixels[i], box.pixels[i + 1], box.pixels[i + 2]);
  }

  const sorted: number[] = [];
  for (let v = 0; v < 256; v++) {
    for (let j = 0; j < buckets[v].length; j++) {
      sorted.push(buckets[v][j]);
    }
  }

  const mid = Math.floor(sorted.length / 2);
  // Align to RGB triplet boundary
  const splitAt = mid - (mid % 3);

  return [
    { pixels: new Uint8Array(sorted.slice(0, splitAt)), count: splitAt / 3 },
    { pixels: new Uint8Array(sorted.slice(splitAt)), count: (sorted.length - splitAt) / 3 },
  ];
}

function boxAverage(box: ColorBox): [number, number, number] {
  let totalR = 0, totalG = 0, totalB = 0;
  for (let i = 0; i < box.pixels.length; i += 3) {
    totalR += box.pixels[i];
    totalG += box.pixels[i + 1];
    totalB += box.pixels[i + 2];
  }
  const n = box.count || 1;
  return [Math.round(totalR / n), Math.round(totalG / n), Math.round(totalB / n)];
}

function medianCutPalette(
  imageData: ImageData,
  targetColors: number
): [number, number, number][] {
  const sampleSize = 15000;
  const initialBox = buildColorBox(imageData, sampleSize);

  if (initialBox.count === 0) return [[0, 0, 0]];

  let boxes: ColorBox[] = [initialBox];

  while (boxes.length < targetColors) {
    // Find box with most pixels to split
    let maxIdx = 0;
    let maxCount = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].count > maxCount) {
        maxCount = boxes[i].count;
        maxIdx = i;
      }
    }

    // Can't split a box with 1 or 0 pixels
    if (boxes[maxIdx].count <= 1) break;

    const axis = findLongestAxis(boxes[maxIdx]);
    const [a, b] = splitBox(boxes[maxIdx], axis);

    if (a.count === 0 || b.count === 0) break;

    boxes.splice(maxIdx, 1, a, b);
  }

  return boxes.map(boxAverage);
}

function findNearestColor(
  r: number,
  g: number,
  b: number,
  palette: [number, number, number][]
): [number, number, number] {
  let bestDist = Infinity;
  let best = palette[0];

  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = palette[i];
      if (dist === 0) break;
    }
  }

  return best;
}

function quantizeImageData(
  imageData: ImageData,
  targetColors: number,
  onProgress: (pct: number) => void
): ImageData {
  const { data, width, height } = imageData;
  const result = new ImageData(new Uint8ClampedArray(data), width, height);

  onProgress(30);

  const palette = medianCutPalette(imageData, targetColors);

  onProgress(60);

  // Build a lookup cache for speed
  const cache = new Map<number, [number, number, number]>();

  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const alpha = data[idx + 3];

    // Preserve fully transparent pixels as-is
    if (alpha === 0) {
      result.data[idx] = data[idx];
      result.data[idx + 1] = data[idx + 1];
      result.data[idx + 2] = data[idx + 2];
      result.data[idx + 3] = alpha;
      continue;
    }

    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    // Use cache key: pack RGB into single number
    const key = (r << 16) | (g << 8) | b;
    let nearest = cache.get(key);
    if (!nearest) {
      nearest = findNearestColor(r, g, b, palette);
      cache.set(key, nearest);
    }

    result.data[idx] = nearest[0];
    result.data[idx + 1] = nearest[1];
    result.data[idx + 2] = nearest[2];
    result.data[idx + 3] = alpha; // Alpha preserved as-is
  }

  onProgress(90);

  return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function compressImage(
  file: File,
  mode: ImageCompressionMode,
  onProgress: (update: ProcessingUpdate) => void
): Promise<ImageCompressionResult> {
  const format = detectFormat(file);

  onProgress({ progress: 5, status: "Loading image..." });
  const img = await loadImage(file);
  const { width, height } = img;

  onProgress({ progress: 10, status: "Preparing canvas..." });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  if (format === "jpeg") {
    // JPEG: simple quality re-encoding
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    onProgress({ progress: 50, status: "Compressing JPEG..." });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("JPEG export failed"))),
        "image/jpeg",
        mode.jpegQuality
      );
    });

    const previewUrl = URL.createObjectURL(blob);

    onProgress({ progress: 100, status: "Complete!" });

    canvas.width = 0;
    canvas.height = 0;

    return {
      blob,
      originalSize: file.size,
      compressedSize: blob.size,
      compressionRatio: Math.max(Math.round((1 - blob.size / file.size) * 100), 0),
      width,
      height,
      format,
      previewUrl,
    };
  }

  // PNG: Median Cut color quantization
  ctx.drawImage(img, 0, 0);

  onProgress({ progress: 15, status: "Reading pixel data..." });
  const imageData = ctx.getImageData(0, 0, width, height);

  onProgress({ progress: 20, status: "Quantizing colors..." });
  const quantized = quantizeImageData(
    imageData,
    mode.pngColorCount,
    (pct) => {
      const mapped = 20 + Math.round(pct * 0.65);
      onProgress({ progress: mapped, status: "Quantizing colors..." });
    }
  );

  onProgress({ progress: 88, status: "Encoding PNG..." });
  ctx.putImageData(quantized, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
      "image/png"
    );
  });

  const previewUrl = URL.createObjectURL(blob);

  onProgress({ progress: 100, status: "Complete!" });

  canvas.width = 0;
  canvas.height = 0;

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: Math.max(Math.round((1 - blob.size / file.size) * 100), 0),
    width,
    height,
    format,
    previewUrl,
  };
}
