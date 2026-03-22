/**
 * Image Watermark Remover
 *
 * Automatic watermark detection and removal using Canvas API.
 * Strategy:
 * 1. Detect watermarks via adaptive color-deviation + blue-bias analysis
 * 2. Classify watermark pixels: on-background vs on-text
 * 3. Background pixels: replace with nearest clean neighbor (inpainting)
 * 4. Text pixels: reverse alpha blending with estimated overlay color
 * 5. Two-pass processing for residual watermark removal
 * 6. Smooth edges with gaussian-like blur
 *
 * Supports colored watermarks (blue, red, etc.) and white/gray watermarks.
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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(imageBitmap, 0, 0);

  onProgress({ progress: 10, status: "Analyzing image for watermarks..." });

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Pass 1: Detect and remove watermark
  onProgress({ progress: 20, status: "Detecting watermark regions..." });
  const mask = detectWatermarkRegions(data, width, height);

  onProgress({ progress: 35, status: "Finding clean reference pixels..." });
  const { nearestClean, distance } = findNearestCleanPixels(
    data,
    mask,
    width,
    height
  );

  onProgress({ progress: 50, status: "Removing watermark (pass 1)..." });
  const pass1 = removeWatermark(data, mask, nearestClean, distance, width, height);

  // Pass 2: Re-detect residual watermark and remove again
  onProgress({ progress: 65, status: "Detecting residual watermark..." });
  const mask2 = detectWatermarkRegions(pass1, width, height);

  // Only keep detections near original watermark area
  const expandedMask = expandMask(mask, width, height, 5);
  const residualMask = new Uint8Array(width * height);
  for (let i = 0; i < residualMask.length; i++) {
    residualMask[i] = mask2[i] === 1 && expandedMask[i] === 1 ? 1 : 0;
  }

  let finalData = pass1;
  const residualCount = residualMask.reduce((a, b) => a + b, 0);
  if (residualCount > 100) {
    onProgress({ progress: 75, status: "Removing residual watermark..." });
    const nc2 = findNearestCleanPixels(pass1, residualMask, width, height);
    finalData = removeWatermark(
      pass1,
      residualMask,
      nc2.nearestClean,
      nc2.distance,
      width,
      height
    );
  }

  // Smooth edges
  onProgress({ progress: 85, status: "Smoothing edges..." });
  const combinedMask = new Uint8Array(width * height);
  for (let i = 0; i < combinedMask.length; i++) {
    combinedMask[i] = mask[i] === 1 || residualMask[i] === 1 ? 1 : 0;
  }
  const smoothed = smoothEdges(finalData, combinedMask, width, height);

  // Generate output
  onProgress({ progress: 95, status: "Generating output..." });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outputImageData = new ImageData(smoothed as any, width, height);
  ctx.putImageData(outputImageData, 0, 0);

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
 * Compute the median of a Float32Array using histogram-based estimation.
 */
function histogramMedian(values: Float32Array, totalCount: number): number {
  let maxVal = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > maxVal) maxVal = values[i];
  }
  if (maxVal === 0) return 0;

  const numBins = 1000;
  const binSize = maxVal / numBins;
  const histogram = new Uint32Array(numBins);
  for (let i = 0; i < values.length; i++) {
    const bin = Math.min(Math.floor(values[i] / binSize), numBins - 1);
    histogram[bin]++;
  }

  const halfCount = totalCount / 2;
  let cumulative = 0;
  for (let i = 0; i < numBins; i++) {
    cumulative += histogram[i];
    if (cumulative >= halfCount) {
      return (i + 0.5) * binSize;
    }
  }
  return maxVal / 2;
}

/**
 * Compute standard deviation from pre-computed sum and sumOfSquares.
 */
function computeStd(sum: number, sumSq: number, count: number): number {
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Detect watermark regions using adaptive color-deviation + blue-bias analysis.
 * Returns a mask where 1 = watermark pixel, 0 = normal pixel.
 */
function detectWatermarkRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const totalPixels = width * height;

  // Compute per-pixel color deviation from gray
  const colorDiff = new Float32Array(totalPixels);
  let cdSum = 0,
    cdSumSq = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;
    const grayNorm = brightness / 255;
    const cd = Math.max(
      Math.abs(r / 255 - grayNorm),
      Math.abs(g / 255 - grayNorm),
      Math.abs(b / 255 - grayNorm)
    );
    colorDiff[i] = cd;
    cdSum += cd;
    cdSumSq += cd * cd;
  }

  // Adaptive threshold: median + 1.5*std
  const cdMedian = histogramMedian(colorDiff, totalPixels);
  const cdStd = computeStd(cdSum, cdSumSq, totalPixels);
  const adaptiveColorThreshold = Math.max(cdMedian + 1.5 * cdStd, 0.03);

  // Detect: color deviation above threshold OR blue-biased pixels
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;

    // Strategy A: High color deviation (primary detector)
    if (colorDiff[i] > adaptiveColorThreshold) {
      mask[i] = 1;
      continue;
    }

    // Strategy B: Blue-bias detector for semi-transparent watermark edges
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const blueBias = bNorm - (rNorm + gNorm) / 2;
    if (
      blueBias > 0.03 &&
      colorDiff[i] > 0.03 &&
      brightness > 50 &&
      brightness < 252
    ) {
      mask[i] = 1;
    }
  }

  // Morphological cleanup: erosion (remove noise)
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

  // Dilation: reconnect and expand (2 iterations)
  let dilated = new Uint8Array(eroded);
  for (let iter = 0; iter < 2; iter++) {
    const next = new Uint8Array(dilated);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (dilated[y * width + x] === 1) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              next[(y + dy) * width + (x + dx)] = 1;
            }
          }
        }
      }
    }
    dilated = next;
  }

  return dilated;
}

/**
 * Expand a mask by N pixels in all directions.
 */
function expandMask(
  mask: Uint8Array,
  width: number,
  height: number,
  iterations: number
): Uint8Array {
  let current = new Uint8Array(mask);
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(current);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (current[y * width + x] === 1) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              next[(y + dy) * width + (x + dx)] = 1;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
}

/**
 * BFS-based search for nearest non-watermark pixel for each watermark pixel.
 * Returns the color of the nearest clean pixel and distance to it.
 */
function findNearestCleanPixels(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
): { nearestClean: Float32Array; distance: Int32Array } {
  const totalPixels = width * height;
  const nearestClean = new Float32Array(totalPixels * 3);
  const distance = new Int32Array(totalPixels);
  distance.fill(999);

  // Initialize non-watermark pixels
  for (let i = 0; i < totalPixels; i++) {
    if (mask[i] === 0) {
      distance[i] = 0;
      const idx = i * 4;
      nearestClean[i * 3] = data[idx];
      nearestClean[i * 3 + 1] = data[idx + 1];
      nearestClean[i * 3 + 2] = data[idx + 2];
    }
  }

  // BFS from boundary watermark pixels
  const queue: number[] = [];
  let queueStart = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i] === 0) continue;

      // Check if this watermark pixel has a clean neighbor
      let found = false;
      for (let dy = -1; dy <= 1 && !found; dy++) {
        for (let dx = -1; dx <= 1 && !found; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            const ni = ny * width + nx;
            if (mask[ni] === 0) {
              distance[i] = 1;
              const idx = ni * 4;
              nearestClean[i * 3] = data[idx];
              nearestClean[i * 3 + 1] = data[idx + 1];
              nearestClean[i * 3 + 2] = data[idx + 2];
              queue.push(i);
              found = true;
            }
          }
        }
      }
    }
  }

  // Propagate
  while (queueStart < queue.length) {
    const ci = queue[queueStart++];
    const cy = Math.floor(ci / width);
    const cx = ci % width;
    const d = distance[ci];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dy === 0 && dx === 0) continue;
        const ny = cy + dy;
        const nx = cx + dx;
        if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
          const ni = ny * width + nx;
          if (distance[ni] > d + 1) {
            distance[ni] = d + 1;
            nearestClean[ni * 3] = nearestClean[ci * 3];
            nearestClean[ni * 3 + 1] = nearestClean[ci * 3 + 1];
            nearestClean[ni * 3 + 2] = nearestClean[ci * 3 + 2];
            queue.push(ni);
          }
        }
      }
    }
  }

  return { nearestClean, distance };
}

/**
 * Remove watermark using two-track strategy:
 * - Background pixels: replace with nearest clean neighbor (inpainting)
 * - Text pixels: reverse alpha blending to remove watermark color overlay
 */
function removeWatermark(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  nearestClean: Float32Array,
  distance: Int32Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);
  const totalPixels = width * height;

  // Brightness threshold to distinguish background vs text
  const BG_THRESHOLD = 150;

  for (let i = 0; i < totalPixels; i++) {
    if (mask[i] === 0) continue;

    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;

    const cleanR = nearestClean[i * 3];
    const cleanG = nearestClean[i * 3 + 1];
    const cleanB = nearestClean[i * 3 + 2];

    if (brightness > BG_THRESHOLD) {
      // Track A: Watermark on BACKGROUND — use 97% clean neighbor
      const maxDiff = Math.max(
        Math.abs(r - cleanR),
        Math.abs(g - cleanG),
        Math.abs(b - cleanB)
      );
      const strength = Math.min(maxDiff / 80, 1);
      const confidence = 0.88 + strength * 0.10; // 0.88 to 0.98
      const distFactor = Math.max(1 - distance[i] / 20, 0.75);
      const blend = confidence * distFactor;

      output[idx] = clamp(cleanR * blend + r * (1 - blend));
      output[idx + 1] = clamp(cleanG * blend + g * (1 - blend));
      output[idx + 2] = clamp(cleanB * blend + b * (1 - blend));
    } else {
      // Track B: Watermark on TEXT — reverse alpha blending
      // Watermark overlay adds blue tint: B >> R,G
      // Estimate per-pixel alpha from blue excess
      const rgAvg = (r + g) / 2;
      const wmBlue = 245; // typical blue watermark overlay
      let pxAlpha = 0;
      if (wmBlue > rgAvg + 10) {
        pxAlpha = Math.min(Math.max((b - rgAvg) / (wmBlue - rgAvg), 0), 0.55);
      }

      if (pxAlpha > 0.03) {
        const invA = 1 - pxAlpha;
        if (invA > 0.3) {
          // Reverse blend: remove watermark overlay
          const newR = clamp(r / invA);
          const newG = clamp(g / invA);
          const newB = clamp((b - pxAlpha * wmBlue) / invA);
          // Blend 85% restored, 15% original for safety
          output[idx] = clamp(newR * 0.85 + r * 0.15);
          output[idx + 1] = clamp(newG * 0.85 + g * 0.15);
          output[idx + 2] = clamp(newB * 0.85 + b * 0.15);
        }
      } else {
        // Weak watermark on text: reduce blue channel toward gray
        output[idx + 2] = clamp(b - (b - rgAvg) * 0.6);
      }
    }
  }

  return output;
}

/**
 * Smooth edges of removed regions using weighted averaging.
 * Background areas get gaussian-like blur; text areas get lighter smoothing.
 */
function smoothEdges(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);

  // Pass 1: Gaussian-like 3x3 blur on background watermark pixels
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      const pi = idx * 4;
      const brightness = (data[pi] + data[pi + 1] + data[pi + 2]) / 3;
      if (brightness <= 150) continue; // Skip text pixels

      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          // Center pixel gets more weight
          const w = dx === 0 && dy === 0 ? 4 : 1;
          rSum += data[ni] * w;
          gSum += data[ni + 1] * w;
          bSum += data[ni + 2] * w;
          weight += w;
        }
      }

      output[pi] = Math.round(rSum / weight);
      output[pi + 1] = Math.round(gSum / weight);
      output[pi + 2] = Math.round(bSum / weight);
    }
  }

  // Pass 2: Edge blending — smooth boundary between watermark and non-watermark
  const blended = new Uint8ClampedArray(output);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx] === 0) continue;

      // Check if this is an edge pixel (has non-watermark neighbor)
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
          if (mask[(y + dy) * width + (x + dx)] === 0) {
            isEdge = true;
          }
        }
      }
      if (!isEdge) continue;

      const pi = idx * 4;
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          const nMask = mask[(y + dy) * width + (x + dx)];
          // Non-watermark neighbors get higher weight for natural blending
          const w = nMask === 0 ? 2.0 : 0.5;
          rSum += output[ni] * w;
          gSum += output[ni + 1] * w;
          bSum += output[ni + 2] * w;
          weight += w;
        }
      }

      blended[pi] = Math.round(rSum / weight);
      blended[pi + 1] = Math.round(gSum / weight);
      blended[pi + 2] = Math.round(bSum / weight);
    }
  }

  return blended;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
