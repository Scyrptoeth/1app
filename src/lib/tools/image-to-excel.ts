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
  return RP_VARIANTS.has(text.trim().toLowerCase());
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
// Phase 0: Image Preprocessing (Canvas-based)
// ============================================================

/**
 * Preprocess image for optimal OCR accuracy.
 *
 * This is the CRITICAL step that fixes the 32% OCR confidence problem.
 * Without preprocessing, Tesseract receives a low-DPI RGBA image and produces garbage.
 *
 * Steps:
 * 1. Upscale to minimum 2500px width (Tesseract needs ~300 DPI)
 * 2. Flatten RGBA to RGB with white background
 * 3. Convert to grayscale (luminance)
 * 4. Compute Otsu's threshold for adaptive binarization
 * 5. Apply binarization (pure black & white)
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
  // Higher resolution significantly improves digit and character recognition
  const MIN_WIDTH = 3400;
  const scale = origWidth < MIN_WIDTH
    ? Math.ceil(MIN_WIDTH / origWidth)
    : 1;
  const scaledWidth = origWidth * scale;
  const scaledHeight = origHeight * scale;

  onProgress({ progress: 2, status: `Upscaling image ${scale}x for OCR accuracy...` });

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

  onProgress({ progress: 3, status: 'Sharpening and converting to grayscale...' });

  // Step 0.5: Apply unsharp mask (sharpen) to improve character edges
  // This makes thin strokes and digits much clearer for OCR
  {
    const w = scaledWidth;
    const h = scaledHeight;
    const src = new Uint8ClampedArray(data);
    // 3x3 sharpen kernel: center=9, edges=-1
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

  // Step 1: Convert to grayscale (luminance)
  const grayscale = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    grayscale[i] = Math.round(
      0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
    );
  }

  // Step 2: Compute Otsu's threshold
  const histogram = new Int32Array(256);
  for (let i = 0; i < pixelCount; i++) {
    histogram[grayscale[i]]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = pixelCount - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  // Step 3: Apply binarization
  // Moderate bias toward preserving text (lower threshold = more black pixels preserved)
  // Reduced from +15 to +10 to preserve more thin strokes and digits
  const binaryThreshold = Math.min(threshold + 10, 245);

  for (let i = 0; i < pixelCount; i++) {
    const val = grayscale[i] < binaryThreshold ? 0 : 255;
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
  let worker;
  try {
    worker = await createWorker('ind', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress({
            progress: 8 + Math.round(m.progress * 35),
            status: 'Recognizing text...',
          });
        } else if (m.status === 'loading language traineddata') {
          onProgress({
            progress: 6,
            status: 'Loading Indonesian language data (first time may take a moment)...',
          });
        }
      },
    });
  } catch {
    // Fallback to English if Indonesian data unavailable
    onProgress({ progress: 5, status: 'Falling back to English OCR...' });
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress({
            progress: 8 + Math.round(m.progress * 35),
            status: 'Recognizing text...',
          });
        } else if (m.status === 'loading language traineddata') {
          onProgress({
            progress: 6,
            status: 'Loading language data (first time may take a moment)...',
          });
        }
      },
    });
  }

  // Set optimal parameters for financial documents
  await worker.setParameters({
    tessedit_pageseg_mode: '6', // Uniform block of text
    preserve_interword_spaces: '1',
  });

  onProgress({ progress: 8, status: 'Running OCR on preprocessed image...' });

  const result = await worker.recognize(imageBlob);
  await worker.terminate();

  onProgress({ progress: 46, status: 'OCR complete, analyzing layout...' });

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
      if (isNumericValue(word.text) && word.bbox.x0 > imageWidth * 0.45) {
        numericRightEdges.push(word.bbox.x1);
      }
    }
  }

  if (numericRightEdges.length === 0) return [];

  // Sort and cluster right edges
  numericRightEdges.sort((a, b) => a - b);
  // Use larger threshold (8% of width) to avoid splitting into too many columns
  const threshold = imageWidth * 0.08;

  const clusters: number[][] = [];
  let currentCluster: number[] = [numericRightEdges[0]];

  for (let i = 1; i < numericRightEdges.length; i++) {
    if (numericRightEdges[i] - numericRightEdges[i - 1] < threshold) {
      currentCluster.push(numericRightEdges[i]);
    } else {
      clusters.push(currentCluster);
      currentCluster = [numericRightEdges[i]];
    }
  }
  clusters.push(currentCluster);

  // Keep significant clusters (at least 3 values)
  const significant = clusters.filter((c) => c.length >= 3);

  const columns: ColumnInfo[] = significant.map((cluster) => ({
    rightEdge: Math.max(...cluster),
    avgRight: cluster.reduce((a, b) => a + b, 0) / cluster.length,
    count: cluster.length,
  }));

  // Sort by position (left to right)
  columns.sort((a, b) => a.avgRight - b.avgRight);

  // If we detected more than 3 columns, merge the closest pair iteratively
  // Financial statements typically have at most 2-3 value columns
  while (columns.length > 3) {
    let minGap = Infinity;
    let mergeIdx = -1;
    for (let i = 0; i < columns.length - 1; i++) {
      const gap = columns[i + 1].avgRight - columns[i].avgRight;
      if (gap < minGap) {
        minGap = gap;
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
  const contentStartY = imageHeight * 0.10;
  const contentEndY = imageHeight * 0.82;

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
