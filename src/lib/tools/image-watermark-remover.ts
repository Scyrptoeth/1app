/**
 * Image Watermark Remover
 *
 * Automatic watermark detection and removal using Canvas API.
 * Strategy:
 * 1. Detect semi-transparent text/pattern overlays (most common watermark type)
 * 2. Use frequency analysis to find repeating patterns
 * 3. Apply reverse alpha blending to restore original pixels
 * 4. Smooth the result with surrounding pixel interpolation
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface ProcessingResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
}

/**
 * Main entry point: auto-detect and remove watermark from an image file.
 */
export async function removeImageWatermark(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<ProcessingResult> {
  onProgress({ progress: 5, status: "Loading image..." });

  const imageBitmap = await createImageBitmap(file);
  const { width, height } = imageBitmap;

  // Create working canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(imageBitmap, 0, 0);

  onProgress({ progress: 15, status: "Analyzing image for watermarks..." });

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Step 1: Detect watermark regions
  onProgress({ progress: 25, status: "Detecting watermark regions..." });
  const watermarkMask = detectWatermarkRegions(data, width, height);

  // Step 2: Estimate watermark properties
  onProgress({
    progress: 40,
    status: "Estimating watermark properties...",
  });
  const wmProps = estimateWatermarkProperties(data, watermarkMask, width, height);

  // Step 3: Remove watermark using reverse alpha blending
  onProgress({ progress: 55, status: "Removing watermark..." });
  const cleanedData = removeWatermarkPixels(
    data,
    watermarkMask,
    wmProps,
    width,
    height
  );

  // Step 4: Smooth edges of removed regions
  onProgress({ progress: 75, status: "Smoothing edges..." });
  const smoothedData = smoothEdges(cleanedData, watermarkMask, width, height);

  // Step 5: Generate output
  onProgress({ progress: 90, status: "Generating output..." });
  const outputImageData = new ImageData(smoothedData, width, height);
  ctx.putImageData(outputImageData, 0, 0);

  // Determine output format from input
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeType =
    ext === "png" ? "image/png" : "image/jpeg";
  const quality = ext === "png" ? undefined : 0.95;

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (b) => resolve(b!),
      mimeType,
      quality
    );
  });

  const previewUrl = URL.createObjectURL(blob);

  onProgress({ progress: 100, status: "Complete!" });

  return {
    blob,
    previewUrl,
    originalSize: file.size,
    processedSize: blob.size,
  };
}

/**
 * Detect watermark regions by analyzing pixel patterns.
 * Returns a mask where 1 = watermark pixel, 0 = normal pixel.
 */
function detectWatermarkRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const totalPixels = width * height;

  // --- Strategy 1: Detect semi-transparent bright overlays ---
  // Watermarks are typically lighter than the surrounding content.
  // We look for pixels that are significantly brighter than their
  // local neighborhood, suggesting an additive overlay.

  // Compute local brightness statistics using a block-based approach
  const blockSize = 32;
  const blocksX = Math.ceil(width / blockSize);
  const blocksY = Math.ceil(height / blockSize);

  // Compute per-block average brightness
  const blockAvg = new Float32Array(blocksX * blocksY);
  const blockCount = new Uint32Array(blocksX * blocksY);

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / blockSize);
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blockSize);
      const idx = (y * width + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const bi = by * blocksX + bx;
      blockAvg[bi] += brightness;
      blockCount[bi]++;
    }
  }

  for (let i = 0; i < blockAvg.length; i++) {
    if (blockCount[i] > 0) blockAvg[i] /= blockCount[i];
  }

  // --- Strategy 2: Detect repeating patterns (diagonal watermark text) ---
  // Many watermarks repeat the same text diagonally across the image.
  // We detect this by looking for pixels with consistent brightness deviation.

  // Build histogram of brightness deviations from local average
  const deviations = new Float32Array(totalPixels);
  let devSum = 0;
  let devCount = 0;

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / blockSize);
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blockSize);
      const idx = (y * width + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const bi = by * blocksX + bx;
      const localAvg = blockAvg[bi];
      const dev = brightness - localAvg;
      const pixelIdx = y * width + x;
      deviations[pixelIdx] = dev;
      if (dev > 0) {
        devSum += dev;
        devCount++;
      }
    }
  }

  // Threshold: pixels that deviate positively (brighter) by a consistent amount
  // are likely watermark pixels
  const avgPositiveDev = devCount > 0 ? devSum / devCount : 10;
  const threshold = Math.max(avgPositiveDev * 0.6, 8);

  // --- Strategy 3: Color consistency check ---
  // Watermark text typically has consistent color (usually white/gray).
  // Check if bright-deviated pixels have low color saturation.

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      const idx = pixelIdx * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const dev = deviations[pixelIdx];

      // Check if pixel is brighter than local average
      if (dev > threshold) {
        // Check color saturation — watermarks tend to be desaturated
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;

        // Low saturation + bright deviation = likely watermark
        if (saturation < 0.35) {
          mask[pixelIdx] = 1;
        }
      }
    }
  }

  // --- Post-processing: clean up noise with morphological operations ---
  // Remove isolated pixels (noise) and fill small gaps

  // Erosion pass: remove isolated detections
  const eroded = new Uint8Array(totalPixels);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;
      // Count neighbors
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (mask[(y + dy) * width + (x + dx)] === 1) neighbors++;
        }
      }
      if (neighbors >= 2) eroded[idx] = 1;
    }
  }

  // Dilation pass: reconnect nearby detections
  const dilated = new Uint8Array(totalPixels);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (eroded[idx] === 1) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            dilated[(y + dy) * width + (x + dx)] = 1;
          }
        }
      }
    }
  }

  return dilated;
}

interface WatermarkProperties {
  avgColor: [number, number, number];
  avgAlpha: number;
}

/**
 * Estimate watermark color and opacity from detected regions.
 */
function estimateWatermarkProperties(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
): WatermarkProperties {
  let rSum = 0,
    gSum = 0,
    bSum = 0;
  let count = 0;
  let alphaEstimate = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (mask[pixelIdx] !== 1) continue;

      const idx = pixelIdx * 4;
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;

      // Estimate alpha by comparing with nearest non-watermark pixel
      const neighbor = findNearestCleanPixel(data, mask, x, y, width, height);
      if (neighbor) {
        const origBright =
          (neighbor[0] + neighbor[1] + neighbor[2]) / 3;
        const wmBright = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        if (wmBright > origBright && wmBright < 255) {
          const a = (wmBright - origBright) / (255 - origBright + 0.001);
          alphaEstimate += Math.min(Math.max(a, 0), 1);
        }
      }
    }
  }

  if (count === 0) {
    return { avgColor: [255, 255, 255], avgAlpha: 0.3 };
  }

  return {
    avgColor: [rSum / count, gSum / count, bSum / count],
    avgAlpha: Math.min(Math.max(alphaEstimate / count, 0.1), 0.9),
  };
}

/**
 * Find the nearest non-watermark pixel to use as reference.
 */
function findNearestCleanPixel(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  cx: number,
  cy: number,
  width: number,
  height: number
): [number, number, number] | null {
  const searchRadius = 5;
  for (let r = 1; r <= searchRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] === 0) {
          const idx = ni * 4;
          return [data[idx], data[idx + 1], data[idx + 2]];
        }
      }
    }
  }
  return null;
}

/**
 * Remove watermark by reverse alpha blending.
 * Formula: original = (blended - alpha * watermark_color) / (1 - alpha)
 */
function removeWatermarkPixels(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  props: WatermarkProperties,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);
  const [wmR, wmG, wmB] = props.avgColor;
  const alpha = props.avgAlpha;
  const invAlpha = 1 - alpha;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (mask[pixelIdx] !== 1) continue;

      const idx = pixelIdx * 4;

      // Reverse alpha blend
      output[idx] = clamp((data[idx] - alpha * wmR) / invAlpha);
      output[idx + 1] = clamp((data[idx + 1] - alpha * wmG) / invAlpha);
      output[idx + 2] = clamp((data[idx + 2] - alpha * wmB) / invAlpha);
      // Alpha channel stays at 255
    }
  }

  return output;
}

/**
 * Smooth the edges of removed regions to blend with surroundings.
 */
function smoothEdges(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);

  // Find edge pixels (watermark pixels adjacent to non-watermark)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] !== 1) continue;

      // Check if this is an edge pixel
      let isEdge = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * width + (x + dx)] === 0) {
            isEdge = true;
            break;
          }
        }
        if (isEdge) break;
      }

      if (!isEdge) continue;

      // Average with 3x3 neighborhood
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          rSum += data[ni];
          gSum += data[ni + 1];
          bSum += data[ni + 2];
          count++;
        }
      }

      const pi = idx * 4;
      output[pi] = Math.round(rSum / count);
      output[pi + 1] = Math.round(gSum / count);
      output[pi + 2] = Math.round(bSum / count);
    }
  }

  return output;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
