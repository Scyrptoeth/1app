/**
 * Image-to-Excel Converter
 *
 * Pipeline: Image -> Preprocessing -> Tesseract.js OCR -> Layout Analysis -> ExcelJS -> .xlsx
 *
 * Architecture:
 * - Phase 0: preprocessImage() — upscale + grayscale + binarize for OCR accuracy
 * - Phase 1: extractFromImage() — OCR + layout analysis -> structured data
 * - Phase 2: generateExcel() — structured data -> .xlsx Blob
 *
 * All processing is client-side (browser). No server-side API calls.
 *
 * KEY DESIGN DECISIONS:
 * 1. We preprocess images before OCR (upscale, binarize) because Tesseract
 *    needs ~300 DPI equivalent for good accuracy. Phone photos at 850px are ~100 DPI.
 * 2. We do NOT rely on Tesseract's line grouping — we re-group words by Y-coordinate.
 */

import { createWorker } from 'tesseract.js';

// ============================================================
// Public Types
// ============================================================

export interface ProcessingUpdate {
  progress: number; // 0-100
  status: string;
}

export interface CellData {
  value: string;
  type: 'text' | 'number' | 'currency' | 'header';
  rawNumber?: number;
}

export interface RowData {
  id: string;
  rowNumber: number | null;
  label: string;
  values: string[]; // one per detected column
  indent: number;
  isHeader: boolean;
  isSectionTitle: boolean;
  isTotal: boolean;
}

export interface ExtractionResult {
  rows: RowData[];
  columnCount: number;
  headers: string[];
  confidence: number;
  rawText: string;
  imageWidth: number;
  imageHeight: number;
}

// ============================================================
// Internal Types
// ============================================================

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface WordRow {
  words: OcrWord[];
  minY: number;
  maxY: number;
  minX: number;
}

interface ColumnInfo {
  rightEdge: number;
  avgRight: number;
  count: number;
}

// ============================================================
// Constants
// ============================================================

/** OCR frequently misreads "Rp" as these variants */
const RP_VARIANTS = new Set([
  'rp', 'fp', 'ip', 'ro', 'np', 'mp', 'bp', 'kp', 're', 'ry', 'me',
]);

/** Keywords indicating a header/section row */
const HEADER_KEYWORDS = [
  'PENERIMAAN', 'BIAYA LANGSUNG', 'BIAYA UMUM', 'PENDAPATAN BUNGA',
  'BEBAN DILUAR', 'BEBAN LUAR', 'HARGA POKOK', 'PENDAPATAN BUNGA DEPOSIT',
  'PENGHASILAN DARI LUAR USAHA', 'LABA BERSIH DARI USAHA',
];

/** Keywords indicating a total/subtotal row */
const TOTAL_KEYWORDS = [
  'HARGA POKOK PENJUALAN', 'LABA BERSIH', 'TOTAL', 'LABA SETELAH',
  'PPH TERUTANG', 'JUMLAH', 'PENGHASILAN DARI LUAR',
  'LABA KOTOR', 'PENDAPATAN DILUAR', 'TERSEDIA DIJUAL',
];

// ============================================================
// Utility Functions
// ============================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function isRpPrefix(text: string): boolean {
  const lower = text.trim().toLowerCase();
  // Exact match: "Rp", "rp", "fp", etc.
  if (RP_VARIANTS.has(lower)) return true;
  // Also match "Rp." or "Rp:" or "Rp " variants with trailing punctuation
  const stripped = lower.replace(/[.:,\s]+$/, '');
  if (RP_VARIANTS.has(stripped)) return true;
  return false;
}

/**
 * Extract digits from an Rp-prefixed word.
 * Handles cases where OCR merges "Rp" with the number like "Rp61.039.612.496"
 * Returns the digit portion or null if no digits found.
 */
function extractDigitsFromRpWord(text: string): string | null {
  const lower = text.trim().toLowerCase();
  for (const variant of RP_VARIANTS) {
    if (lower.startsWith(variant)) {
      const rest = text.trim().substring(variant.length).trim();
      // Check if remaining part has digits
      const cleaned = rest.replace(/[.,\s]/g, '');
      if (/\d{3,}/.test(cleaned)) {
        return rest;
      }
    }
  }
  return null;
}

/**
 * Check if a word is a numeric value (financial amount).
 * Requires at least 3 consecutive digits to avoid matching
 * line numbers, dates, or short codes.
 */
function isNumericValue(text: string): boolean {
  const cleaned = text.replace(/[.,\s_\-()]/g, '');
  return /\d{3,}/.test(cleaned);
}

/**
 * Parse Indonesian-format number string to number.
 * Indonesian: dots = thousands separator, comma = decimal.
 * Example: "1.975.155.731" -> 1975155731
 */
function parseIndonesianNumber(text: string): number | null {
  let cleaned = text.trim();
  const lowerCleaned = cleaned.toLowerCase();
  for (const variant of RP_VARIANTS) {
    if (lowerCleaned.startsWith(variant)) {
      cleaned = cleaned.substring(variant.length).trim();
      break;
    }
  }
  // Remove all non-numeric except dots, commas, minus
  cleaned = cleaned.replace(/[^\d.,\-]/g, '');
  if (!cleaned) return null;

  // Indonesian format: dots are thousand separators
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/\./g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ============================================================
// Phase 0: Image Preprocessing (Enhanced Pipeline v6)
// ============================================================

/**
 * CLAHE — Contrast Limited Adaptive Histogram Equalization.
 * Dramatically improves contrast in images with uneven lighting (phone photos).
 * Divides image into tiles and equalizes each tile's histogram independently,
 * with a clip limit to prevent over-amplification of noise.
 *
 * @param gray - Grayscale pixel array
 * @param w - Image width
 * @param h - Image height
 * @param tileX - Number of horizontal tiles (default 8)
 * @param tileY - Number of vertical tileW (default 8)
 * @param clipLimit - Histogram clip limit (default 2.5)
 */
function applyCLAHE(
  gray: Uint8Array,
  w: number,
  h: number,
  tileX: number = 8,
  tileY: number = 8,
  clipLimit: number = 2.5
): Uint8Array {
  const result = new Uint8Array(gray.length);
  const tileW = Math.ceil(w / tileX);
  const tileH = Math.ceil(h / tileY);
  const bins = 256;

  // Build lookup tables for each tile
  const luts: Uint8Array[][] = [];
  for (let ty = 0; ty < tileY; ty++) {
    luts[ty] = [];
    for (let tx = 0; tx < tileX; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(x0 + tileW, w);
      const y1 = Math.min(y0 + tileH, h);
      const tilePixels = (x1 - x0) * (y1 - y0);

      // Build histogram for this tile
      const hist = new Int32Array(bins);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[gray[y * w + x]]++;
        }
      }

      // Clip histogram and redistribute
      const limit = Math.max(1, Math.round(clipLimit * tilePixels / bins));
      let excess = 0;
      for (let i = 0; i < bins; i++) {
        if (hist[i] > limit) {
          excess += hist[i] - limit;
          hist[i] = limit;
        }
      }
      const increment = Math.floor(excess / bins);
      const remainder = excess - increment * bins;
      for (let i = 0; i < bins; i++) {
        hist[i] += increment + (i < remainder ? 1 : 0);
      }

      // Build CDF lookup table
      const lut = new Uint8Array(bins);
      let cumSum = 0;
      for (let i = 0; i < bins; i++) {
        cumSum += hist[i];
        lut[i] = Math.round(((cumSum - 1) / Math.max(1, tilePixels - 1)) * 255);
      }
      luts[ty][tx] = lut;
    }
  }

  // Interpolate between tiles for smooth result
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pixel = gray[y * w + x];
      // Find which tile center this pixel is closest to
      const fx = (x / tileW) - 0.5;
      const fy = (y / tileH) - 0.5;
      const tx0 = Math.max(0, Math.floor(fx));
      const ty0 = Math.max(0, Math.floor(fy));
      const tx1 = Math.min(tx0 + 1, tileX - 1);
      const ty1 = Math.min(ty0 + 1, tileY - 1);
      const dx = Math.max(0, Math.min(1, fx - tx0));
      const dy = Math.max(0, Math.min(1, fy - ty0));

      // Bilinear interpolation of 4 surrounding tile LUTs
      const v00 = luts[ty0][tx0][pixel];
      const v10 = luts[ty0][tx1][pixel];
      const v01 = luts[ty1][tx0][pixel];
      const v11 = luts[ty1][tx1][pixel];
      const top = v00 * (1 - dx) + v10 * dx;
      const bot = v01 * (1 - dx) + v11 * dx;
      result[y * w + x] = Math.round(top * (1 - dy) + bot * dy);
    }
  }

  return result;
}

/**
 * Gaussian Blur 5x5 — reduces noise before thresholding.
 * Tesseract docs specifically recommend slight blur to smooth grain.
 * A 5x5 kernel gives better noise reduction than 3x3 while preserving character edges.
 */
function applyGaussianBlur5x5(gray: Uint8Array, w: number, h: number): Uint8Array {
  const result = new Uint8Array(gray.length);
  // 5x5 Gaussian kernel (σ ≈ 1.0), sum = 273
  const kernel = [
    1, 4, 7, 4, 1,
    4, 16, 26, 16, 4,
    7, 26, 41, 26, 7,
    4, 16, 26, 16, 4,
    1, 4, 7, 4, 1,
  ];
  const kSum = 273;

  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      let val = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          val += gray[(y + ky) * w + (x + kx)] * kernel[(ky + 2) * 5 + (kx + 2)];
        }
      }
      result[y * w + x] = Math.round(val / kSum);
    }
  }

  // Copy edges unchanged
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < 2 || y >= h - 2 || x < 2 || x >= w - 2) {
        result[y * w + x] = gray[y * w + x];
      }
    }
  }

  return result;
}

/**
 * Sauvola Adaptive Thresholding — handles uneven lighting much better than global Otsu.
 *
 * For each pixel, the threshold is computed from a local neighborhood:
 *   T(x,y) = mean * (1 + k * (stddev / R - 1))
 * where R = 128 (dynamic range of grayscale), k = tuning parameter.
 *
 * Uses integral image and integral square image for O(1) per-pixel computation.
 *
 * @param gray - Grayscale pixel array
 * @param w - Image width
 * @param h - Image height
 * @param blockSize - Local neighborhood size (must be odd)
 * @param k - Sauvola parameter (0.0-0.5, lower = more text preserved)
 */
function sauvolaThreshold(
  gray: Uint8Array,
  w: number,
  h: number,
  blockSize: number = 25,
  k: number = 0.15
): Uint8Array {
  const binary = new Uint8Array(w * h);
  const halfBlock = Math.floor(blockSize / 2);
  const R = 128; // Half the dynamic range

  // Build integral image and integral of squares for O(1) block mean/variance
  const integral = new Float64Array((w + 1) * (h + 1));
  const integralSq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    let rowSumSq = 0;
    for (let x = 0; x < w; x++) {
      const val = gray[y * w + x];
      rowSum += val;
      rowSumSq += val * val;
      integral[(y + 1) * (w + 1) + (x + 1)] =
        integral[y * (w + 1) + (x + 1)] + rowSum;
      integralSq[(y + 1) * (w + 1) + (x + 1)] =
        integralSq[y * (w + 1) + (x + 1)] + rowSumSq;
    }
  }

  // Helper to get block sum from integral image
  const getBlockSum = (img: Float64Array, x0: number, y0: number, x1: number, y1: number): number => {
    return img[(y1 + 1) * (w + 1) + (x1 + 1)]
      - img[(y0) * (w + 1) + (x1 + 1)]
      - img[(y1 + 1) * (w + 1) + (x0)]
      + img[(y0) * (w + 1) + (x0)];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - halfBlock);
      const y0 = Math.max(0, y - halfBlock);
      const x1 = Math.min(w - 1, x + halfBlock);
      const y1 = Math.min(h - 1, y + halfBlock);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);

      const blockSum = getBlockSum(integral, x0, y0, x1, y1);
      const blockSumSq = getBlockSum(integralSq, x0, y0, x1, y1);
      const mean = blockSum / count;
      const variance = (blockSumSq / count) - (mean * mean);
      const stddev = Math.sqrt(Math.max(0, variance));

      // Sauvola formula: T = mean * (1 + k * (stddev / R - 1))
      const threshold = mean * (1 + k * (stddev / R - 1));

      binary[y * w + x] = gray[y * w + x] > threshold ? 255 : 0;
    }
  }

  return binary;
}

/**
 * Morphological Opening — erode then dilate to remove small noise (salt/pepper).
 * Uses a 3x3 cross-shaped structuring element.
 * Erode removes isolated white noise, dilate restores character edges.
 */
function morphologicalOpen(binary: Uint8Array, w: number, h: number): Uint8Array {
  // Erode: pixel is 0 (black) if ANY neighbor in structuring element is 0
  const eroded = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const center = binary[y * w + x];
      const top = binary[(y - 1) * w + x];
      const bot = binary[(y + 1) * w + x];
      const left = binary[y * w + (x - 1)];
      const right = binary[y * w + (x + 1)];
      // Cross element: if center AND all 4 neighbors are white, keep white
      eroded[y * w + x] = (center & top & bot & left & right) ? 255 : 0;
    }
  }

  // Dilate: pixel is 255 (white) if ANY neighbor in structuring element is 255
  const dilated = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const center = eroded[y * w + x];
      const top = eroded[(y - 1) * w + x];
      const bot = eroded[(y + 1) * w + x];
      const left = eroded[y * w + (x - 1)];
      const right = eroded[y * w + (x + 1)];
      // Cross element: if ANY is white, set white
      dilated[y * w + x] = (center | top | bot | left | right) ? 255 : 0;
    }
  }

  // Copy edges from original binary
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
        dilated[y * w + x] = binary[y * w + x];
      }
    }
  }

  return dilated;
}

/**
 * Enhanced Preprocessing Pipeline v6 for optimal OCR accuracy.
 *
 * This is the CRITICAL step for high OCR confidence. The pipeline:
 * 1. Upscale to ~400 DPI equivalent (3400px minimum width)
 * 2. Sharpen with 3x3 unsharp mask for crisp character edges
 * 3. Convert to grayscale (luminance)
 * 4. CLAHE — adaptive contrast enhancement (handles uneven lighting)
 * 5. Gaussian Blur 5x5 — smooths grain/noise before thresholding
 * 6. Sauvola Adaptive Threshold — per-pixel threshold based on local neighborhood
 * 7. Morphological Opening — removes salt/pepper noise
 *
 * Key improvements over v5 (Global Otsu):
 * - CLAHE handles low-contrast phone photos
 * - Sauvola adapts to uneven lighting (shadows, vignetting)
 * - Gaussian blur reduces noise that causes false characters
 * - Morphological opening cleans residual noise pixels
 *
 * Returns { blob, scale } where scale maps OCR coordinates back to original space.
 */
async function preprocessImage(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<{ blob: Blob; scale: number; width: number; height: number }> {
  onProgress({ progress: 1, status: 'Loading image...' });

  // Load image into an HTMLImageElement
  const img = document.createElement('img');
  const imgUrl = URL.createObjectURL(file);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imgUrl;
  });

  const origWidth = img.naturalWidth;
  const origHeight = img.naturalHeight;
  URL.revokeObjectURL(imgUrl);

  // Determine scale factor: target at least 3400px width (~400 DPI equivalent)
  const MIN_WIDTH = 3400;
  const scale = origWidth < MIN_WIDTH
    ? Math.ceil(MIN_WIDTH / origWidth)
    : 1;
  const scaledWidth = origWidth * scale;
  const scaledHeight = origHeight * scale;

  onProgress({ progress: 1, status: `Upscaling image ${scale}x for OCR accuracy...` });

  // Create canvas at scaled size
  const canvas = document.createElement('canvas');
  canvas.width = scaledWidth;
  canvas.height = scaledHeight;
  const ctx = canvas.getContext('2d')!;

  // White background (flattens RGBA alpha channel)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, scaledWidth, scaledHeight);

  // High-quality upscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);

  // Get pixel data for processing
  const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
  const data = imageData.data;
  const pixelCount = data.length / 4;

  onProgress({ progress: 2, status: 'Sharpening character edges...' });

  // Step 1: Sharpen with 3x3 unsharp mask — improves thin strokes and digits
  {
    const w = scaledWidth;
    const h = scaledHeight;
    const src = new Uint8ClampedArray(data);
    const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              val += src[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          data[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, val));
        }
      }
    }
  }

  // Step 2: Convert to grayscale (luminance)
  const grayscale = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    grayscale[i] = Math.round(
      0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
    );
  }

  onProgress({ progress: 2, status: 'Enhancing contrast (CLAHE)...' });

  // Step 3: CLAHE — adaptive contrast enhancement
  // Dramatically improves text visibility in low-contrast / unevenly-lit images
  const enhanced = applyCLAHE(grayscale, scaledWidth, scaledHeight, 8, 8, 2.5);

  onProgress({ progress: 3, status: 'Reducing noise (Gaussian blur)...' });

  // Step 4: Gaussian blur 5x5 — smooth noise before thresholding
  // Tesseract docs: slight blur reduces grain and improves recognition
  const smoothed = applyGaussianBlur5x5(enhanced, scaledWidth, scaledHeight);

  onProgress({ progress: 3, status: 'Applying adaptive threshold (Sauvola)...' });

  // Step 5: Sauvola adaptive threshold — per-pixel threshold based on local statistics
  // Handles uneven lighting, shadows, and vignetting much better than global Otsu
  // blockSize=25 is ~2.5mm at 400 DPI, good for document text
  // k=0.15 is slightly aggressive to preserve thin strokes
  const binary = sauvolaThreshold(smoothed, scaledWidth, scaledHeight, 25, 0.15);

  onProgress({ progress: 4, status: 'Cleaning noise (morphological opening)...' });

  // Step 6: Morphological opening — remove small salt/pepper noise
  const cleaned = morphologicalOpen(binary, scaledWidth, scaledHeight);

  // Write binary result back to canvas
  for (let i = 0; i < pixelCount; i++) {
    const val = cleaned[i];
    const idx = i * 4;
    data[idx] = val;
    data[idx + 1] = val;
    data[idx + 2] = val;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);

  onProgress({ progress: 4, status: 'Image preprocessing complete' });

  // Export as PNG Blob
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
      'image/png'
    );
  });

  return { blob, scale, width: origWidth, height: origHeight };
}

// ============================================================
// Phase 1: OCR — extract ALL words with bounding boxes
// ============================================================

async function performOcr(
  imageBlob: Blob,
  scale: number,
  onProgress: (update: ProcessingUpdate) => void
): Promise<{ words: OcrWord[]; rawText: string; confidence: number }> {
  onProgress({ progress: 5, status: 'Initializing OCR engine...' });

  // Try Indonesian language first for much better text accuracy on Indonesian documents.
  // Fall back to English if Indonesian language data fails to load.
  let lang = 'ind';
  let worker;
  try {
    worker = await createWorker('ind', 1, {
      logger: (m) => {
        if (m.status === 'loading language traineddata') {
          onProgress({
            progress: 6,
            status: 'Loading Indonesian language data (first time may take a moment)...',
          });
        }
      },
    });
  } catch {
    lang = 'eng';
    onProgress({ progress: 5, status: 'Falling back to English OCR...' });
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'loading language traineddata') {
          onProgress({
            progress: 6,
            status: 'Loading language data (first time may take a moment)...',
          });
        }
      },
    });
  }

  // --- Multi-pass OCR ---
  // Pass 1: PSM 6 — assume uniform block of text (good for full-page documents)
  // Pass 2: PSM 4 — assume single column of variable-size text (better for tables)
  // We pick the result with highest confidence.

  onProgress({ progress: 8, status: 'OCR Pass 1/2 (block mode)...' });

  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    preserve_interword_spaces: '1',
  });
  const result1 = await worker.recognize(imageBlob);
  const conf1 = result1.data.confidence;

  onProgress({ progress: 28, status: `Pass 1 confidence: ${conf1.toFixed(1)}%. Running Pass 2...` });

  await worker.setParameters({
    tessedit_pageseg_mode: '4',
    preserve_interword_spaces: '1',
  });
  const result2 = await worker.recognize(imageBlob);
  const conf2 = result2.data.confidence;

  await worker.terminate();

  // Pick better result
  const result = conf2 > conf1 ? result2 : result1;
  const bestConf = Math.max(conf1, conf2);
  const bestPsm = conf2 > conf1 ? 4 : 6;

  onProgress({
    progress: 46,
    status: `OCR complete (PSM ${bestPsm}, ${bestConf.toFixed(1)}%), analyzing layout...`,
  });

  // Collect ALL words from ALL blocks/paragraphs/lines
  const allWords: OcrWord[] = [];

  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const w of line.words) {
            if (w.text.trim().length > 0) {
              // Scale bbox coordinates back to original image space
              allWords.push({
                text: w.text,
                confidence: w.confidence,
                bbox: {
                  x0: w.bbox.x0 / scale,
                  y0: w.bbox.y0 / scale,
                  x1: w.bbox.x1 / scale,
                  y1: w.bbox.y1 / scale,
                },
              });
            }
          }
        }
      }
    }
  }

  return {
    words: allWords,
    rawText: result.data.text,
    confidence: result.data.confidence,
  };
}

// ============================================================
// Phase 1: Re-group words into visual rows by Y-coordinate
// ============================================================

/**
 * Group words into rows based on Y-coordinate overlap.
 * This is the KEY function that fixes Tesseract's broken line grouping.
 *
 * Two words are in the same row if their Y-ranges overlap significantly.
 * We sort all words by Y, then merge words whose vertical center
 * falls within the Y-range of the current row.
 */
function groupWordsIntoRows(words: OcrWord[], imageHeight: number): WordRow[] {
  if (words.length === 0) return [];

  // Sort by vertical center position
  const sorted = [...words].sort((a, b) => {
    const centerA = (a.bbox.y0 + a.bbox.y1) / 2;
    const centerB = (b.bbox.y0 + b.bbox.y1) / 2;
    return centerA - centerB;
  });

  // Average word height to calculate gap threshold
  const heights = sorted.map((w) => w.bbox.y1 - w.bbox.y0);
  const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
  // Gap threshold: if center-to-center Y distance > 70% of avg height, new row
  const yGapThreshold = avgHeight * 0.7;

  const rows: WordRow[] = [];
  let currentRow: OcrWord[] = [sorted[0]];
  let currentRowCenterY = (sorted[0].bbox.y0 + sorted[0].bbox.y1) / 2;

  for (let i = 1; i < sorted.length; i++) {
    const word = sorted[i];
    const wordCenterY = (word.bbox.y0 + word.bbox.y1) / 2;

    if (Math.abs(wordCenterY - currentRowCenterY) < yGapThreshold) {
      // Same row
      currentRow.push(word);
      // Update row center as running average
      currentRowCenterY =
        currentRow.reduce((sum, w) => sum + (w.bbox.y0 + w.bbox.y1) / 2, 0) /
        currentRow.length;
    } else {
      // New row — finalize current
      rows.push(finalizeRow(currentRow));
      currentRow = [word];
      currentRowCenterY = wordCenterY;
    }
  }

  // Finalize last row
  if (currentRow.length > 0) {
    rows.push(finalizeRow(currentRow));
  }

  return rows;
}

function finalizeRow(words: OcrWord[]): WordRow {
  // Sort words left-to-right within the row
  words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return {
    words,
    minY: Math.min(...words.map((w) => w.bbox.y0)),
    maxY: Math.max(...words.map((w) => w.bbox.y1)),
    minX: Math.min(...words.map((w) => w.bbox.x0)),
  };
}

// ============================================================
// Phase 1: Column Detection
// ============================================================

function detectValueColumns(
  rows: WordRow[],
  imageWidth: number
): ColumnInfo[] {
  // Collect right-edges of all numeric words in the right portion of the image
  const numericRightEdges: number[] = [];

  for (const row of rows) {
    for (const word of row.words) {
      if (isNumericValue(word.text) && word.bbox.x0 > imageWidth * 0.35) {
        numericRightEdges.push(word.bbox.x1);
      }
    }
  }

  if (numericRightEdges.length === 0) return [];

  // Sort right edges
  numericRightEdges.sort((a, b) => a - b);

  // Strategy: Find the LARGEST GAP in sorted right-edges to split columns.
  // This is much more robust than fixed-threshold sequential clustering,
  // because it adapts to the actual column separation in the document.
  // Financial statements typically have 2 value columns (Sub Jumlah + Jumlah).
  const minGapForSplit = imageWidth * 0.04; // 4% minimum gap to consider a split

  // Find all gaps between adjacent sorted edges
  const gaps: { index: number; gap: number }[] = [];
  for (let i = 1; i < numericRightEdges.length; i++) {
    const gap = numericRightEdges[i] - numericRightEdges[i - 1];
    if (gap >= minGapForSplit) {
      gaps.push({ index: i, gap });
    }
  }

  // Sort gaps by size descending — the largest gap is the most likely column boundary
  gaps.sort((a, b) => b.gap - a.gap);

  // Determine split points (at most 2 splits → 3 columns max)
  const splitIndices: number[] = [];
  for (const g of gaps) {
    if (splitIndices.length >= 2) break;
    // Ensure split points are not too close to each other
    const tooClose = splitIndices.some(
      (si) => Math.abs(numericRightEdges[g.index] - numericRightEdges[si]) < imageWidth * 0.06
    );
    if (!tooClose) {
      splitIndices.push(g.index);
    }
  }

  // Build clusters from split points
  splitIndices.sort((a, b) => a - b);
  const clusters: number[][] = [];
  let start = 0;
  for (const si of splitIndices) {
    clusters.push(numericRightEdges.slice(start, si));
    start = si;
  }
  clusters.push(numericRightEdges.slice(start));

  // Keep significant clusters (at least 3 values)
  const significant = clusters.filter((c) => c.length >= 3);

  // If no significant splits found, try single cluster
  if (significant.length === 0) {
    return [{
      rightEdge: Math.max(...numericRightEdges),
      avgRight: numericRightEdges.reduce((a, b) => a + b, 0) / numericRightEdges.length,
      count: numericRightEdges.length,
    }];
  }

  const columns: ColumnInfo[] = significant.map((cluster) => ({
    rightEdge: Math.max(...cluster),
    avgRight: cluster.reduce((a, b) => a + b, 0) / cluster.length,
    count: cluster.length,
  }));

  // Sort by position (left to right)
  columns.sort((a, b) => a.avgRight - b.avgRight);

  // If we detected more than 3 columns, merge the closest pair iteratively
  while (columns.length > 3) {
    let minGapVal = Infinity;
    let mergeIdx = -1;
    for (let i = 0; i < columns.length - 1; i++) {
      const gapVal = columns[i + 1].avgRight - columns[i].avgRight;
      if (gapVal < minGapVal) {
        minGapVal = gapVal;
        mergeIdx = i;
      }
    }
    if (mergeIdx >= 0) {
      const merged: ColumnInfo = {
        rightEdge: Math.max(
          columns[mergeIdx].rightEdge,
          columns[mergeIdx + 1].rightEdge
        ),
        avgRight:
          (columns[mergeIdx].avgRight * columns[mergeIdx].count +
            columns[mergeIdx + 1].avgRight * columns[mergeIdx + 1].count) /
          (columns[mergeIdx].count + columns[mergeIdx + 1].count),
        count: columns[mergeIdx].count + columns[mergeIdx + 1].count,
      };
      columns.splice(mergeIdx, 2, merged);
    } else {
      break;
    }
  }

  return columns;
}

// ============================================================
// Phase 1: Layout Analysis (using re-grouped rows)
// ============================================================

function analyzeLayout(
  wordRows: WordRow[],
  columns: ColumnInfo[],
  imageWidth: number,
  imageHeight: number,
  onProgress: (update: ProcessingUpdate) => void
): RowData[] {
  onProgress({ progress: 55, status: 'Analyzing structure...' });

  // Determine content area: skip header/logo and footer/signature
  // Reduced endY from 0.82 to 0.78 to exclude footer text and signature
  const contentStartY = imageHeight * 0.10;
  const contentEndY = imageHeight * 0.78;

  // Filter to content rows only
  const contentRows = wordRows.filter(
    (r) => r.minY >= contentStartY && r.minY <= contentEndY
  );

  // Left margin baseline
  const leftMargins = contentRows.map((r) => r.minX);
  const minLeftMargin =
    leftMargins.length > 0 ? Math.min(...leftMargins) : 0;
  const indentUnit = imageWidth * 0.025;

  const result: RowData[] = [];

  for (let ri = 0; ri < contentRows.length; ri++) {
    const row = contentRows[ri];

    onProgress({
      progress: 55 + Math.round((ri / contentRows.length) * 30),
      status: `Processing row ${ri + 1}/${contentRows.length}...`,
    });

    // Separate words into: label parts and numeric values
    const labelParts: string[] = [];
    const valuesByColumn: Map<number, string> = new Map();

    let wi = 0;
    while (wi < row.words.length) {
      const word = row.words[wi];

      // Case 1: Rp prefix — look for following number(s)
      if (isRpPrefix(word.text)) {
        // First check: does the Rp word itself contain digits? (e.g., "Rp61.039")
        const embeddedDigits = extractDigitsFromRpWord(word.text);
        if (embeddedDigits && isNumericValue(embeddedDigits)) {
          assignToColumn(embeddedDigits, word.bbox.x1, columns, valuesByColumn, imageWidth);
          wi++;
          continue;
        }

        const numParts: string[] = [];
        let j = wi + 1;

        while (j < row.words.length) {
          const nextWord = row.words[j];
          if (isNumericValue(nextWord.text)) {
            numParts.push(nextWord.text);
            j++;
          } else if (
            nextWord.text === '.' ||
            nextWord.text === ','
          ) {
            numParts.push(nextWord.text);
            j++;
          } else {
            break;
          }
        }

        if (numParts.length > 0) {
          const numText = numParts.join('');
          const numRight = row.words[j - 1].bbox.x1;
          assignToColumn(numText, numRight, columns, valuesByColumn, imageWidth);
          wi = j;
          continue;
        } else {
          wi++;
          continue;
        }
      }

      // Case 1b: Word starts with Rp variant + digits (e.g., "Rp3.208.050.970")
      // but isRpPrefix returned false because of the digits
      {
        const embeddedDigits = extractDigitsFromRpWord(word.text);
        if (embeddedDigits && isNumericValue(embeddedDigits) && word.bbox.x0 > imageWidth * 0.35) {
          assignToColumn(embeddedDigits, word.bbox.x1, columns, valuesByColumn, imageWidth);
          wi++;
          continue;
        }
      }

      // Case 2: Standalone number in the right portion
      if (
        isNumericValue(word.text) &&
        word.bbox.x0 > imageWidth * 0.4
      ) {
        // Look ahead for adjacent numeric fragments (handles OCR splitting)
        let combinedText = word.text;
        let combinedRight = word.bbox.x1;
        let j = wi + 1;

        while (j < row.words.length) {
          const nextWord = row.words[j];
          const gap = nextWord.bbox.x0 - combinedRight;
          if (
            gap < imageWidth * 0.025 &&
            /[\d.,]/.test(nextWord.text) &&
            !isRpPrefix(nextWord.text)
          ) {
            combinedText += nextWord.text;
            combinedRight = nextWord.bbox.x1;
            j++;
          } else {
            break;
          }
        }

        if (assignToColumn(combinedText, combinedRight, columns, valuesByColumn, imageWidth)) {
          wi = j;
          continue;
        }
      }

      // Case 3: Regular text word — part of label
      // Skip standalone 1-2 digit numbers at far left (line item numbers)
      if (
        word.bbox.x0 < imageWidth * 0.2 &&
        /^\d{1,2}[.:]?$/.test(word.text.trim())
      ) {
        const maybeNum = parseInt(word.text);
        if (maybeNum > 0 && maybeNum <= 50) {
          labelParts.push(word.text);
          wi++;
          continue;
        }
      }

      labelParts.push(word.text);
      wi++;
    }

    let label = labelParts.join(' ').trim();

    // Post-process label cleanup: remove OCR junk characters
    // Strip leading/trailing punctuation noise from OCR artifacts
    label = label
      .replace(/^[:\-—|.;,\s]+/, '')    // Leading junk
      .replace(/[:\-—|;,\s]+$/, '')      // Trailing junk
      .replace(/\s{2,}/g, ' ')           // Multiple spaces → single space
      .trim();

    if (!label && valuesByColumn.size === 0) continue;

    // Detect row number at start of label
    let rowNumber: number | null = null;
    const numMatch = label.match(/^(\d{1,2})[\s.:]+(.+)$/);
    if (numMatch && parseInt(numMatch[1]) <= 50) {
      rowNumber = parseInt(numMatch[1]);
      label = numMatch[2].trim();
    }

    // Calculate indent level
    const indent = Math.max(
      0,
      Math.round((row.minX - minLeftMargin) / indentUnit)
    );
    const clampedIndent = Math.min(indent, 5);

    // Classify row
    const upperLabel = label.toUpperCase();
    const hasValues = valuesByColumn.size > 0;

    const isHeader =
      !hasValues &&
      (HEADER_KEYWORDS.some((kw) => upperLabel.includes(kw)) ||
        (/^[A-Z\s]+$/.test(upperLabel) && upperLabel.length > 5));

    const isSectionTitle = [
      'BIAYA LANGSUNG',
      'BIAYA UMUM',
      'PENDAPATAN BUNGA',
    ].some((kw) => upperLabel.includes(kw));

    const isTotal =
      TOTAL_KEYWORDS.some((kw) => upperLabel.includes(kw)) && hasValues;

    // Build values array
    const values: string[] = [];
    for (let ci = 0; ci < columns.length; ci++) {
      values.push(valuesByColumn.get(ci) || '');
    }

    result.push({
      id: generateId(),
      rowNumber,
      label,
      values,
      indent: clampedIndent,
      isHeader,
      isSectionTitle,
      isTotal,
    });
  }

  return result;
}

/**
 * Assign a numeric value to the closest detected column.
 * Returns true if successfully assigned.
 */
function assignToColumn(
  numText: string,
  numRight: number,
  columns: ColumnInfo[],
  valuesByColumn: Map<number, string>,
  imageWidth: number
): boolean {
  let bestCol = -1;
  let bestDist = Infinity;
  for (let ci = 0; ci < columns.length; ci++) {
    const dist = Math.abs(numRight - columns[ci].avgRight);
    if (dist < bestDist) {
      bestDist = dist;
      bestCol = ci;
    }
  }

  if (bestCol >= 0 && bestDist < imageWidth * 0.12) {
    const existing = valuesByColumn.get(bestCol) || '';
    // Only set if not already set (first value wins to avoid overwriting)
    if (!existing) {
      valuesByColumn.set(bestCol, numText);
    }
    return true;
  }
  return false;
}

// ============================================================
// Phase 1: Main Extract Function
// ============================================================

export async function extractFromImage(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<ExtractionResult> {
  // Phase 0: Preprocess image for OCR accuracy
  const { blob: processedBlob, scale, width: imageWidth, height: imageHeight } =
    await preprocessImage(file, onProgress);

  // Phase 1a: OCR on preprocessed image — get all words
  // Coordinates are scaled back to original image space inside performOcr
  const ocrResult = await performOcr(processedBlob, scale, onProgress);

  onProgress({ progress: 48, status: 'Regrouping words into rows...' });

  // Phase 1b: Re-group words by Y-coordinate (fixes Tesseract line merging)
  const wordRows = groupWordsIntoRows(ocrResult.words, imageHeight);

  onProgress({ progress: 52, status: 'Detecting columns...' });

  // Phase 1c: Detect value columns
  const columns = detectValueColumns(wordRows, imageWidth);

  // Phase 1d: Layout analysis
  const rows = analyzeLayout(
    wordRows,
    columns,
    imageWidth,
    imageHeight,
    onProgress
  );

  // Build headers
  const headers: string[] = ['No', 'Keterangan'];
  for (let ci = 0; ci < columns.length; ci++) {
    if (ci === columns.length - 1) {
      headers.push('Jumlah (Rp)');
    } else {
      headers.push('Sub Jumlah (Rp)');
    }
  }

  if (columns.length === 0) {
    headers.push('Jumlah (Rp)');
  }

  onProgress({ progress: 90, status: 'Extraction complete!' });

  return {
    rows,
    columnCount: Math.max(columns.length, 1),
    headers,
    confidence: ocrResult.confidence,
    rawText: ocrResult.rawText,
    imageWidth,
    imageHeight,
  };
}

// ============================================================
// Phase 2: Excel Generation
// ============================================================

export async function generateExcel(
  rows: RowData[],
  headers: string[],
  title: string = 'Extracted Data'
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = '1APP - Image to Excel';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(title);

  // ---- Title Row ----
  const titleRow = worksheet.addRow([title]);
  titleRow.font = { bold: true, size: 14 };
  worksheet.mergeCells(1, 1, 1, headers.length);
  titleRow.alignment = { horizontal: 'center' };

  // ---- Empty row ----
  worksheet.addRow([]);

  // ---- Header Row ----
  const headerRow = worksheet.addRow(headers);
  headerRow.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
  });

  // ---- Data Rows ----
  for (const rowData of rows) {
    const rowValues: (string | number | null)[] = [];

    // Column: No
    rowValues.push(rowData.rowNumber);

    // Column: Keterangan (with indent)
    const indentStr = '  '.repeat(rowData.indent);
    rowValues.push(indentStr + rowData.label);

    // Value columns
    for (const val of rowData.values) {
      if (val) {
        const num = parseIndonesianNumber(val);
        rowValues.push(num !== null ? num : val);
      } else {
        rowValues.push(null);
      }
    }

    // Pad if fewer values than expected
    while (rowValues.length < headers.length) {
      rowValues.push(null);
    }

    const row = worksheet.addRow(rowValues);

    // Apply formatting
    if (rowData.isHeader || rowData.isSectionTitle) {
      row.font = { bold: true, size: 10 };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9D9D9' },
      };
    } else if (rowData.isTotal) {
      row.font = { bold: true, size: 10 };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFF2CC' },
      };
      row.border = {
        top: { style: 'thin' },
      };
    } else {
      row.font = { size: 10 };
    }

    // Format individual cells
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'left', wrapText: true };

    for (let vi = 0; vi < rowData.values.length; vi++) {
      const cell = row.getCell(3 + vi);
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.alignment = { horizontal: 'right' };
      }
    }
  }

  // ---- Column Widths ----
  worksheet.getColumn(1).width = 6;
  worksheet.getColumn(2).width = 50;
  for (let i = 3; i <= headers.length; i++) {
    worksheet.getColumn(i).width = 22;
  }

  // ---- Freeze header ----
  worksheet.views = [{ state: 'frozen', ySplit: 3 }];

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
