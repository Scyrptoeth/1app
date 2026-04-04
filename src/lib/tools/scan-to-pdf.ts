// ─── Scan-to-PDF: Auto-Enhance Pipeline + Helpers ──────────────────
// Enhances camera-captured document images and converts them to PDF.
// All image processing is 100% client-side using Canvas API.

import type { ImageItem } from "@/lib/tools/image-to-pdf";

export interface ScanItem {
  id: string;
  blob: Blob;
  thumbnailUrl: string;
  enhancedBlob: Blob;
  enhancedThumbnailUrl: string;
  width: number;
  height: number;
  rotation: number; // 0, 90, 180, 270
  removed: boolean;
  orientation: "portrait" | "landscape" | "auto";
}

// ─── Canvas Helpers ────────────────────────────────────────────────

function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    return { canvas, ctx };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

async function blobToImageData(blob: Blob): Promise<{ data: ImageData; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const { ctx } = createCanvas(width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  return { data: imageData, width, height };
}

function imageDataToBlob(imageData: ImageData): Promise<Blob> {
  const { canvas, ctx } = createCanvas(imageData.width, imageData.height);
  ctx.putImageData(imageData, 0, 0);

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: "image/png" });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
      "image/png",
    );
  });
}

// ─── Enhancement Steps ─────────────────────────────────────────────

/** Step 1: Gentle Gaussian-like noise reduction (3×3 box blur) */
function applyNoiseReduction(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const d = out.data;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // 3×3 weighted average: center=4, edges=2, corners=1 (total=16)
        const val =
          data[((y - 1) * width + (x - 1)) * 4 + c] * 1 +
          data[((y - 1) * width + x) * 4 + c] * 2 +
          data[((y - 1) * width + (x + 1)) * 4 + c] * 1 +
          data[(y * width + (x - 1)) * 4 + c] * 2 +
          data[i + c] * 4 +
          data[(y * width + (x + 1)) * 4 + c] * 2 +
          data[((y + 1) * width + (x - 1)) * 4 + c] * 1 +
          data[((y + 1) * width + x) * 4 + c] * 2 +
          data[((y + 1) * width + (x + 1)) * 4 + c] * 1;
        d[i + c] = val >> 4; // divide by 16
      }
    }
  }
  return out;
}

/** Step 2: White balance correction — neutralize color cast from lighting */
function applyWhiteBalance(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const d = out.data;
  const total = width * height;

  // Find pixels that should be white (brightness > 200)
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < total * 4; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (brightness > 200) {
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count++;
    }
  }

  // If not enough bright pixels, skip correction
  if (count < total * 0.05) return out;

  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;

  // Target: make white areas truly white (balanced channels)
  const maxAvg = Math.max(avgR, avgG, avgB);
  if (maxAvg === 0) return out;

  const scaleR = maxAvg / avgR;
  const scaleG = maxAvg / avgG;
  const scaleB = maxAvg / avgB;

  for (let i = 0; i < total * 4; i += 4) {
    d[i] = Math.min(255, Math.round(data[i] * scaleR));
    d[i + 1] = Math.min(255, Math.round(data[i + 1] * scaleG));
    d[i + 2] = Math.min(255, Math.round(data[i + 2] * scaleB));
  }

  return out;
}

/** Step 3: Adaptive auto-contrast via histogram percentile stretching */
function applyAutoContrast(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const d = out.data;
  const total = width * height;

  // Build per-channel histograms
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);

  for (let i = 0; i < total * 4; i += 4) {
    histR[data[i]]++;
    histG[data[i + 1]]++;
    histB[data[i + 2]]++;
  }

  // Find 1st and 99th percentile per channel
  function findPercentile(hist: Uint32Array, percentile: number): number {
    const target = Math.floor(total * percentile);
    let cumulative = 0;
    for (let i = 0; i < 256; i++) {
      cumulative += hist[i];
      if (cumulative >= target) return i;
    }
    return 255;
  }

  const channels = [
    { hist: histR, offset: 0 },
    { hist: histG, offset: 1 },
    { hist: histB, offset: 2 },
  ];

  const luts: Uint8ClampedArray[] = [];

  for (const ch of channels) {
    const lo = findPercentile(ch.hist, 0.01);
    const hi = findPercentile(ch.hist, 0.99);
    const lut = new Uint8ClampedArray(256);

    if (hi <= lo) {
      // No contrast stretch possible
      for (let i = 0; i < 256; i++) lut[i] = i;
    } else {
      const range = hi - lo;
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.min(255, Math.max(0, Math.round(((i - lo) / range) * 255)));
      }
    }
    luts.push(lut);
  }

  for (let i = 0; i < total * 4; i += 4) {
    d[i] = luts[0][data[i]];
    d[i + 1] = luts[1][data[i + 1]];
    d[i + 2] = luts[2][data[i + 2]];
  }

  return out;
}

/** Step 4: Brightness optimization — target paper area at 230-250 brightness */
function applyBrightnessOptimization(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const d = out.data;
  const total = width * height;

  // Calculate average brightness
  let sumBrightness = 0;
  for (let i = 0; i < total * 4; i += 4) {
    sumBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  const avgBrightness = sumBrightness / total;

  // Target: paper area ~240 brightness
  // Only adjust if significantly off
  let adjustment = 0;
  if (avgBrightness < 128) {
    adjustment = Math.min(40, (180 - avgBrightness) * 0.3);
  } else if (avgBrightness > 200) {
    adjustment = Math.max(-15, (190 - avgBrightness) * 0.2);
  } else {
    // Moderate range — gentle nudge toward 180
    adjustment = (180 - avgBrightness) * 0.15;
  }

  if (Math.abs(adjustment) < 2) return out;

  for (let i = 0; i < total * 4; i += 4) {
    d[i] = Math.min(255, Math.max(0, data[i] + adjustment));
    d[i + 1] = Math.min(255, Math.max(0, data[i + 1] + adjustment));
    d[i + 2] = Math.min(255, Math.max(0, data[i + 2] + adjustment));
  }

  return out;
}

/** Step 5: Unsharp mask sharpening for crisper text */
function applySharpen(src: ImageData): ImageData {
  const { width, height, data } = src;
  const out = new ImageData(new Uint8ClampedArray(data), width, height);
  const d = out.data;

  // Kernel: [0,-1,0 / -1,5,-1 / 0,-1,0]
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = data[i + c] * 5;
        const top = data[((y - 1) * width + x) * 4 + c];
        const bottom = data[((y + 1) * width + x) * 4 + c];
        const left = data[(y * width + (x - 1)) * 4 + c];
        const right = data[(y * width + (x + 1)) * 4 + c];

        d[i + c] = Math.min(255, Math.max(0, center - top - bottom - left - right));
      }
    }
  }

  return out;
}

// ─── Main Enhancement Pipeline ─────────────────────────────────────

export async function enhanceScannedImage(
  blob: Blob,
  onProgress?: (progress: number) => void,
): Promise<{ enhancedBlob: Blob; enhancedUrl: string }> {
  onProgress?.(5);

  const { data: imageData } = await blobToImageData(blob);

  onProgress?.(15);

  // Pipeline: Noise reduction → White balance → Auto-contrast → Brightness → Sharpen
  const step1 = applyNoiseReduction(imageData);
  onProgress?.(30);

  const step2 = applyWhiteBalance(step1);
  onProgress?.(45);

  const step3 = applyAutoContrast(step2);
  onProgress?.(60);

  const step4 = applyBrightnessOptimization(step3);
  onProgress?.(75);

  const step5 = applySharpen(step4);
  onProgress?.(85);

  const enhancedBlob = await imageDataToBlob(step5);
  const enhancedUrl = URL.createObjectURL(enhancedBlob);

  onProgress?.(100);

  return { enhancedBlob, enhancedUrl };
}

// ─── ScanItem → ImageItem Converter ────────────────────────────────

export function scanItemsToImageItems(scans: ScanItem[]): ImageItem[] {
  return scans
    .filter((s) => !s.removed)
    .map((scan, index) => {
      const file = new File(
        [scan.enhancedBlob],
        `scan-${index + 1}.png`,
        { type: "image/png" },
      );
      return {
        file,
        id: scan.id,
        thumbnailUrl: scan.enhancedThumbnailUrl,
        width: scan.width,
        height: scan.height,
        rotation: scan.rotation,
        removed: scan.removed,
        orientation: scan.orientation,
      } satisfies ImageItem;
    });
}
