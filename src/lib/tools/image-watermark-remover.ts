/**
 * Image Watermark Remover
 *
 * Auto-detect and remove colored watermarks from document images.
 * Strategy: Ratio-based color restoration
 *
 * 1. Auto-detect the document's natural R/B and G/B color ratios from clean background
 * 2. Detect watermark pixels where ratios are disrupted (color overlay detection)
 * 3. Restore original colors by reversing the alpha blending on R and G channels
 * 4. Gently reduce blue tint on text areas under watermark
 * 5. Smooth edges for natural blending
 *
 * Works best on document images with colored (blue, red, etc.) semi-transparent watermarks.
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
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;   ctx.drawImage(imageBitmap, 0, 0);

  onProgress({ progress: 10, status: "Analyzing image for watermarks..." });

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const totalPixels = width * height;

  // Step 1: Auto-detect expected color ratios from clean bright pixels
  onProgress({ progress: 15, status: "Detecting document color profile..." });
  const { expectedRB, expectedGB } = detectColorProfile(data, totalPixels);

  // Step 2: Detect watermark regions via ratio disruption
  onProgress({ progress: 25, status: "Detecting watermark regions..." });
  const { alphaMask, wmMask } = detectWatermarkRatio(
    data,
    totalPixels,
    expectedRB,
    expectedGB
  );

  // Step 3: Restore colors
  onProgress({ progress: 50, status: "Removing watermark..." });
  const restored = restoreColors(data, alphaMask, wmMask, totalPixels);

  // Step 4: Smooth edges
  onProgress({ progress: 80, status: "Smoothing edges..." });
  const smoothed = smoothEdges(restored, wmMask, width, height);

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
 * Detect the document's natural color profile by analyzing clean bright pixels.
 * Returns expected R/B and G/B ratios (the 75th percentile from bright background).
 */
function detectColorProfile(
  data: Uint8ClampedArray,
  totalPixels: number
): { expectedRB: number; expectedGB: number } {
  // Collect R/B and G/B ratios from bright pixels (likely background)
  const rbRatios: number[] = [];
  const gbRatios: number[] = [];

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;

    if (brightness > 200 && b > 10) {
      rbRatios.push(r / b);
      gbRatios.push(g / b);
    }
  }

  if (rbRatios.length < 100) {
    // Fallback: assume standard document ratios
    return { expectedRB: 0.96, expectedGB: 0.98 };
  }

  // Use 75th percentile — above median to be robust against watermark pixels
  // pulling values down
  rbRatios.sort((a, b) => a - b);
  gbRatios.sort((a, b) => a - b);

  const p75 = Math.floor(rbRatios.length * 0.75);
  return {
    expectedRB: rbRatios[p75],
    expectedGB: gbRatios[p75],
  };
}

/**
 * Detect watermark pixels by analyzing color ratio disruption.
 * A colored watermark (e.g. blue) disrupts the natural R/B and G/B ratios.
 * Returns per-pixel alpha estimate and binary mask.
 */
function detectWatermarkRatio(
  data: Uint8ClampedArray,
  totalPixels: number,
  expectedRB: number,
  expectedGB: number
): { alphaMask: Float32Array; wmMask: Uint8Array } {
  const alphaMask = new Float32Array(totalPixels);
  const wmMask = new Uint8Array(totalPixels);

  const THRESHOLD = 0.02;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;

    // Only process bright pixels (background) — ratio method is unreliable on dark text
    if (brightness < 120) continue;

    const bSafe = Math.max(b, 1);
    const actualRB = r / bSafe;
    const actualGB = g / bSafe;

    // Estimate alpha: how much is the R/B ratio reduced from expected?
    const alphaR = Math.max(0, Math.min(0.6, 1 - actualRB / expectedRB));
    const alphaG = Math.max(0, Math.min(0.6, 1 - actualGB / expectedGB));
    const alpha = (alphaR + alphaG) / 2;

    if (alpha > THRESHOLD) {
      alphaMask[i] = alpha;
      wmMask[i] = 1;
    }
  }

  return { alphaMask, wmMask };
}

/**
 * Restore colors by reversing the watermark alpha blending.
 *
 * For a semi-transparent colored watermark with color (wm_R, wm_G, wm_B):
 *   displayed = original * (1 - alpha) + watermark_color * alpha
 *
 * For blue watermarks on documents: wm_R ≈ 0, wm_G ≈ 0, wm_B ≈ background_B
 * This means:
 *   - R and G are dimmed: displayed_R = original_R * (1-alpha)
 *   - B is barely changed: displayed_B ≈ original_B
 *
 * Restoration: R_original = R_displayed / (1 - alpha)
 */
function restoreColors(
  data: Uint8ClampedArray,
  alphaMask: Float32Array,
  wmMask: Uint8Array,
  totalPixels: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);
  const THRESHOLD = 0.02;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const brightness = (r + g + b) / 3;

    if (wmMask[i] === 1) {
      // === Background pixel with watermark detected ===
      const alpha = alphaMask[i];
      const invAlpha = Math.max(1 - alpha, 0.35);

      // Soft strength ramp near threshold for gentle transition
      const strength = Math.min((alpha - THRESHOLD) / 0.02, 1);

      // Reverse alpha blend on R and G (wm_R ≈ 0, wm_G ≈ 0)
      const idealR = r / invAlpha;
      const idealG = g / invAlpha;

      output[idx] = clamp(r + (idealR - r) * strength);
      output[idx + 1] = clamp(g + (idealG - g) * strength);
      // B stays the same — watermark B ≈ document background B
    } else if (brightness > 50 && brightness <= 150) {
      // === Text zone: check for residual blue tint ===
      const rgAvg = (r + g) / 2;
      const blueExcess = Math.max(b - rgAvg, 0);

      // Also verify this pixel has some ratio disruption
      const bSafe = Math.max(b, 1);
      const alphaCheck = Math.max(
        0,
        Math.min(0.6, 1 - r / (bSafe * 0.958))
      );

      if (blueExcess > 8 && alphaCheck > 0.03) {
        // Gently reduce blue excess (35% correction)
        output[idx + 2] = clamp(b - blueExcess * 0.35);
      }
    }
  }

  return output;
}

/**
 * Smooth edges of restored regions for natural blending.
 * Only processes boundary pixels between watermark and non-watermark areas.
 */
function smoothEdges(
  data: Uint8ClampedArray,
  wmMask: Uint8Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (wmMask[i] === 0) continue;

      // Check if this is an edge pixel (has at least one non-watermark neighbor)
      let isEdge = false;
      for (let dy = -1; dy <= 1 && !isEdge; dy++) {
        for (let dx = -1; dx <= 1 && !isEdge; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (wmMask[(y + dy) * width + (x + dx)] === 0) {
            isEdge = true;
          }
        }
      }
      if (!isEdge) continue;

      // Weighted 3x3 average for edge blending
      const pi = i * 4;
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * width + (x + dx)) * 4;
          const nMask = wmMask[(y + dy) * width + (x + dx)];
          // Non-watermark neighbors get higher weight for natural blending
          // Center pixel also gets high weight to preserve restoration
          const w =
            nMask === 0 ? 2.0 : dx === 0 && dy === 0 ? 3.0 : 0.5;
          rSum += data[ni] * w;
          gSum += data[ni + 1] * w;
          bSum += data[ni + 2] * w;
          weight += w;
        }
      }

      // Blend 30% smoothed + 70% restored for subtle effect
      output[pi] = clamp(Math.round(rSum / weight) * 0.3 + data[pi] * 0.7);
      output[pi + 1] = clamp(
        Math.round(gSum / weight) * 0.3 + data[pi + 1] * 0.7
      );
      output[pi + 2] = clamp(
        Math.round(bSum / weight) * 0.3 + data[pi + 2] * 0.7
      );
    }
  }

  return output;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
