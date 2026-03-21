/**
 * Image Watermark Remover
 *
 * Automatic watermark detection and removal using Canvas API.
 * Strategy:
 * 1. Detect semi-transparent overlays via brightness deviation (white/gray watermarks)
 * 2. Detect colored watermarks via color-deviation-from-gray analysis
 * 3. Combine both detections with morphological cleanup
 * 4. Apply reverse alpha blending with local neighbor context
 * 5. Smooth the result with weighted interpolation
 *
 * Supports both white/gray watermarks AND colored watermarks (blue, red, etc.)
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
  const wmProps = estimateWatermarkProperties(
    data,
    watermarkMask,
    width,
    height
  );

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputImageData = new ImageData(smoothedData as any, width, height);
  ctx.putImageData(outputImageData, 0, 0);

  // Determine output format from input
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  const quality = ext === "png" ? undefined : 0.95;

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), mimeType, quality);
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
 *
 * Uses TWO complementary strategies:
 * A. Color deviation from gray — catches colored watermarks (blue, red, etc.)
 *    Document images are mostly neutral (black text on white paper).
 *    Any pixel with notable color deviation is suspicious.
 * B. Brightness deviation — catches white/gray watermarks (original approach)
 *    Pixels brighter than local average with low saturation.
 */
function detectWatermarkRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const totalPixels = width * height;

  // =========================================================
  // Compute local brightness statistics using a block approach
  // =========================================================
  const blockSize = 32;
  const blocksX = Math.ceil(width / blockSize);
  const blocksY = Math.ceil(height / blockSize);

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

  // =========================================================
  // Compute per-pixel features
  // =========================================================
  const deviations = new Float32Array(totalPixels);
  const colorDiff = new Float32Array(totalPixels);

  let posDevSum = 0,
    posDevCount = 0;

  for (let y = 0; y < height; y++) {
    const by = Math.floor(y / blockSize);
    for (let x = 0; x < width; x++) {
      const bx = Math.floor(x / blockSize);
      const pixelIdx = y * width + x;
      const idx = pixelIdx * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const brightness = (r + g + b) / 3;
      const bi = by * blocksX + bx;
      const dev = brightness - blockAvg[bi];
      deviations[pixelIdx] = dev;

      if (dev > 0) {
        posDevSum += dev;
        posDevCount++;
      }

      // Color deviation from gray: how far each channel is from the
      // pixel's own brightness. In a pure grayscale image, this is 0.
      // Colored watermarks introduce non-zero color deviation.
      const grayNorm = brightness / 255;
      const rNorm = r / 255;
      const gNorm = g / 255;
      const bNorm = b / 255;
      const diffR = Math.abs(rNorm - grayNorm);
      const diffG = Math.abs(gNorm - grayNorm);
      const diffB = Math.abs(bNorm - grayNorm);
      colorDiff[pixelIdx] = Math.max(diffR, diffG, diffB);
    }
  }

  const avgPosDev = posDevCount > 0 ? posDevSum / posDevCount : 10;
  const posThreshold = Math.max(avgPosDev * 0.6, 8);

  // =========================================================
  // Apply detection strategies
  // =========================================================
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      const idx = pixelIdx * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const dev = deviations[pixelIdx];
      const cDiff = colorDiff[pixelIdx];

      // Strategy A: Color deviation from gray
      // This is the PRIMARY detector for colored watermarks.
      // In document images (mostly black/white), colored pixels are anomalous.
      // Threshold 0.018 gives high recall with very few false positives.
      if (cDiff > 0.018) {
        mask[pixelIdx] = 1;
        continue;
      }

      // Strategy B: Brightness deviation (for white/gray watermarks)
      // Pixels brighter than local average with low saturation
      if (dev > posThreshold) {
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;

        if (saturation < 0.35) {
          mask[pixelIdx] = 1;
        }
      }
    }
  }

  // =========================================================
  // Post-processing: morphological cleanup
  // =========================================================

  // Erosion: remove isolated pixels (noise)
  const eroded = new Uint8Array(totalPixels);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;
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

  // Dilation: reconnect nearby detections (3x3)
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
 * Handles both bright overlays and colored overlays.
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
  let alphaCount = 0;

  // Use pixels with strong color deviation for better color estimation
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
        const [nr, ng, nb] = neighbor;
        // Use maximum channel difference as alpha proxy
        const maxChannelDiff = Math.max(
          Math.abs(data[idx] - nr),
          Math.abs(data[idx + 1] - ng),
          Math.abs(data[idx + 2] - nb)
        );
        if (maxChannelDiff > 3) {
          const a = maxChannelDiff / 255;
          if (a > 0.02 && a < 0.95) {
            alphaEstimate += a;
            alphaCount++;
          }
        }
      }
    }
  }

  if (count === 0) {
    return { avgColor: [255, 255, 255], avgAlpha: 0.3 };
  }

  const estAlpha = alphaCount > 0 ? alphaEstimate / alphaCount : 0.3;

  return {
    avgColor: [rSum / count, gSum / count, bSum / count],
    avgAlpha: Math.min(Math.max(estAlpha, 0.1), 0.8),
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
  const searchRadius = 8;
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
 * Remove watermark by local-adaptive reverse alpha blending.
 * Uses per-pixel alpha estimation from neighbor context for better results.
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
  const globalAlpha = props.avgAlpha;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      if (mask[pixelIdx] !== 1) continue;

      const idx = pixelIdx * 4;
      const neighbor = findNearestCleanPixel(
        data,
        mask,
        x,
        y,
        width,
        height
      );

      if (neighbor) {
        const [nr, ng, nb] = neighbor;
        const maxDiff = Math.max(
          Math.abs(data[idx] - nr),
          Math.abs(data[idx + 1] - ng),
          Math.abs(data[idx + 2] - nb)
        );

        // Estimate per-pixel alpha from difference to neighbor
        const localAlpha = Math.min(
          Math.max((maxDiff / 255) * 1.5, globalAlpha * 0.5),
          globalAlpha * 1.5
        );
        const invAlpha = 1 - localAlpha;

        // Confidence: how strong is the watermark signal at this pixel
        const confidence = Math.min(maxDiff / 60, 1);

        if (invAlpha > 0.15) {
          // Reverse alpha blend
          const rRestored = clamp(
            (data[idx] - localAlpha * wmR) / invAlpha
          );
          const gRestored = clamp(
            (data[idx + 1] - localAlpha * wmG) / invAlpha
          );
          const bRestored = clamp(
            (data[idx + 2] - localAlpha * wmB) / invAlpha
          );

          // Blend: use restored pixel where confident, neighbor where not
          output[idx] = clamp(
            rRestored * confidence + nr * (1 - confidence)
          );
          output[idx + 1] = clamp(
            gRestored * confidence + ng * (1 - confidence)
          );
          output[idx + 2] = clamp(
            bRestored * confidence + nb * (1 - confidence)
          );
        } else {
          // Very high alpha — just use neighbor
          output[idx] = nr;
          output[idx + 1] = ng;
          output[idx + 2] = nb;
        }
      } else {
        // No clean neighbor: global reverse blend
        const invAlpha = 1 - globalAlpha;
        if (invAlpha > 0.1) {
          output[idx] = clamp(
            (data[idx] - globalAlpha * wmR) / invAlpha
          );
          output[idx + 1] = clamp(
            (data[idx + 1] - globalAlpha * wmG) / invAlpha
          );
          output[idx + 2] = clamp(
            (data[idx + 2] - globalAlpha * wmB) / invAlpha
          );
        }
      }
    }
  }

  return output;
}

/**
 * Smooth the edges of removed regions to blend with surroundings.
 * Uses weighted averaging that prefers non-watermark neighbors.
 */
function smoothEdges(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);

  // Pass 1: Smooth edge pixels
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

      // Weighted average: non-watermark neighbors get higher weight
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          const nMask = mask[(y + dy) * width + (x + dx)];
          const w = nMask === 0 ? 2.0 : 0.5;
          rSum += data[ni] * w;
          gSum += data[ni + 1] * w;
          bSum += data[ni + 2] * w;
          weight += w;
        }
      }

      const pi = idx * 4;
      output[pi] = Math.round(rSum / weight);
      output[pi + 1] = Math.round(gSum / weight);
      output[pi + 2] = Math.round(bSum / weight);
    }
  }

  // Pass 2: Light center-weighted blur on all watermark pixels
  const blurred = new Uint8ClampedArray(output);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      if (mask[idx] !== 1) continue;

      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          const w = dx === 0 && dy === 0 ? 4 : 1;
          rSum += output[ni] * w;
          gSum += output[ni + 1] * w;
          bSum += output[ni + 2] * w;
          weight += w;
        }
      }

      const pi = idx * 4;
      blurred[pi] = Math.round(rSum / weight);
      blurred[pi + 1] = Math.round(gSum / weight);
      blurred[pi + 2] = Math.round(bSum / weight);
    }
  }

  return blurred;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
