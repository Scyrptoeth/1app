/**
 * Image-to-Excel Converter
 *
 * Pipeline: Image → Tesseract.js OCR → Layout Analysis → Editable Preview → ExcelJS → .xlsx
 *
 * Architecture:
 * - Phase 1: extractFromImage() — OCR + layout analysis → structured data for preview
 * - Phase 2: generateExcel() — takes (possibly user-edited) data → .xlsx Blob
 *
 * All processing is client-side (browser). No server-side API calls.
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

interface OcrLine {
  words: OcrWord[];
  bbox: { x0: number; y0: number; x1: number; y1: number };
  text: string;
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
  'BEBAN DILUAR', 'BEBAN LUAR', 'LABA KOTOR', 'PENDAPATAN BUNGA DEPOSIT',
];

/** Keywords indicating a total/subtotal row */
const TOTAL_KEYWORDS = [
  'HARGA POKOK PENJUALAN', 'LABA BERSIH', 'TOTAL', 'LABA SETELAH',
  'PPH TERUTANG', 'JUMLAH', 'PENGHASILAN DARI LUAR',
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

function isNumericValue(text: string): boolean {
  const cleaned = text.replace(/[.,\s]/g, '');
  return /^\d{2,}$/.test(cleaned);
}

function parseIndonesianNumber(text: string): number | null {
  // Remove Rp prefix and whitespace
  let cleaned = text.replace(/[Rp\s_]/gi, '');
  // Remove all dots (thousand separators)
  cleaned = cleaned.replace(/\./g, '');
  // Replace comma with dot for decimal
  cleaned = cleaned.replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ============================================================
// Phase 1: OCR
// ============================================================

async function performOcr(
  imageFile: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<{ lines: OcrLine[]; rawText: string; confidence: number }> {
  onProgress({ progress: 2, status: 'Initializing OCR engine...' });

  const worker = await createWorker('ind+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress({
          progress: 5 + Math.round(m.progress * 40),
          status: 'Recognizing text...',
        });
      } else if (m.status === 'loading language traineddata') {
        onProgress({
          progress: 3,
          status: 'Loading language data (first time may take a moment)...',
        });
      }
    },
  });

  onProgress({ progress: 5, status: 'Running OCR...' });

  const result = await worker.recognize(imageFile);
  await worker.terminate();

  onProgress({ progress: 48, status: 'OCR complete, analyzing layout...' });

  // Extract lines with word-level bounding boxes
  const lines: OcrLine[] = [];

  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const words: OcrWord[] = line.words.map((w: any) => ({
            text: w.text,
            confidence: w.confidence,
            bbox: w.bbox,
          }));

          if (words.length > 0) {
            lines.push({
              words,
              bbox: line.bbox,
              text: line.text.trim(),
            });
          }
        }
      }
    }
  }

  return {
    lines,
    rawText: result.data.text,
    confidence: result.data.confidence,
  };
}

// ============================================================
// Phase 1: Column Detection
// ============================================================

function detectValueColumns(lines: OcrLine[], imageWidth: number): ColumnInfo[] {
  // Collect right-edges of all numeric words that are in the right half of the image
  const numericRightEdges: number[] = [];

  for (const line of lines) {
    for (const word of line.words) {
      if (isNumericValue(word.text) && word.bbox.x0 > imageWidth * 0.45) {
        numericRightEdges.push(word.bbox.x1);
      }
    }
  }

  if (numericRightEdges.length === 0) return [];

  // Sort and cluster right edges
  numericRightEdges.sort((a, b) => a - b);
  const threshold = imageWidth * 0.05;

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

  return columns;
}

// ============================================================
// Phase 1: Layout Analysis
// ============================================================

function analyzeLayout(
  lines: OcrLine[],
  imageWidth: number,
  imageHeight: number,
  onProgress: (update: ProcessingUpdate) => void
): { rows: RowData[]; columns: ColumnInfo[] } {
  onProgress({ progress: 50, status: 'Detecting columns...' });

  const columns = detectValueColumns(lines, imageWidth);

  onProgress({ progress: 55, status: 'Analyzing structure...' });

  // Determine content area: skip header/logo lines
  // Heuristic: content starts below ~15% of image height
  const contentStartY = imageHeight * 0.14;
  // Content ends above ~85% (skip footer/signature)
  const contentEndY = imageHeight * 0.82;

  // Left margin baseline from content lines only
  const contentLines = lines.filter(
    (l) => l.bbox.y0 >= contentStartY && l.bbox.y0 <= contentEndY
  );
  const leftMargins = contentLines.map((l) => l.bbox.x0);
  const minLeftMargin = leftMargins.length > 0 ? Math.min(...leftMargins) : 0;
  const indentUnit = imageWidth * 0.015;

  const rows: RowData[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    onProgress({
      progress: 55 + Math.round((li / lines.length) * 30),
      status: `Processing line ${li + 1}/${lines.length}...`,
    });

    // Skip header/footer lines
    if (line.bbox.y0 < contentStartY || line.bbox.y0 > contentEndY) continue;

    // Skip empty lines
    if (line.text.trim().length === 0) continue;

    // Separate words into: label parts, Rp prefixes, and numeric values
    const labelParts: string[] = [];
    const valuesByColumn: Map<number, string> = new Map();

    let wi = 0;
    while (wi < line.words.length) {
      const word = line.words[wi];

      // Case 1: Rp prefix — look for following number
      if (isRpPrefix(word.text)) {
        const rpX = word.bbox.x0;
        const numParts: string[] = [];
        let j = wi + 1;

        while (j < line.words.length) {
          const nextWord = line.words[j];
          if (isNumericValue(nextWord.text)) {
            numParts.push(nextWord.text);
            j++;
          } else if (nextWord.text === '.' || nextWord.text === ',') {
            numParts.push(nextWord.text);
            j++;
          } else {
            break;
          }
        }

        if (numParts.length > 0) {
          const numText = numParts.join('');
          const numRight = line.words[j - 1].bbox.x1;

          // Find closest column
          let bestCol = -1;
          let bestDist = Infinity;
          for (let ci = 0; ci < columns.length; ci++) {
            const dist = Math.abs(numRight - columns[ci].avgRight);
            if (dist < bestDist) {
              bestDist = dist;
              bestCol = ci;
            }
          }

          if (bestCol >= 0 && bestDist < imageWidth * 0.15) {
            valuesByColumn.set(bestCol, numText);
          }

          wi = j;
          continue;
        } else {
          // Rp without number — skip it
          wi++;
          continue;
        }
      }

      // Case 2: Standalone number in the right half of the image
      if (
        isNumericValue(word.text) &&
        word.bbox.x0 > imageWidth * 0.4
      ) {
        const numRight = word.bbox.x1;
        let bestCol = -1;
        let bestDist = Infinity;
        for (let ci = 0; ci < columns.length; ci++) {
          const dist = Math.abs(numRight - columns[ci].avgRight);
          if (dist < bestDist) {
            bestDist = dist;
            bestCol = ci;
          }
        }

        if (bestCol >= 0 && bestDist < imageWidth * 0.15) {
          const existing = valuesByColumn.get(bestCol) || '';
          valuesByColumn.set(bestCol, (existing + word.text).trim());
          wi++;
          continue;
        }
      }

      // Case 3: Regular text word — part of label
      labelParts.push(word.text);
      wi++;
    }

    let label = labelParts.join(' ').trim();
    if (!label && valuesByColumn.size === 0) continue;

    // Detect row number at the start of label
    let rowNumber: number | null = null;
    const numMatch = label.match(/^(\d{1,2})[\s.:]+(.+)$/);
    if (numMatch && parseInt(numMatch[1]) <= 50) {
      rowNumber = parseInt(numMatch[1]);
      label = numMatch[2].trim();
    }

    // Calculate indent level
    const indent = Math.max(
      0,
      Math.round((line.bbox.x0 - minLeftMargin) / indentUnit)
    );
    const clampedIndent = Math.min(indent, 5);

    // Classify row
    const upperLabel = label.toUpperCase();
    const isHeader =
      HEADER_KEYWORDS.some((kw) => upperLabel.includes(kw)) &&
      valuesByColumn.size === 0;

    const isSectionTitle =
      ['BIAYA LANGSUNG', 'BIAYA UMUM', 'PENDAPATAN BUNGA'].some((kw) =>
        upperLabel.includes(kw)
      );

    const isTotal =
      TOTAL_KEYWORDS.some((kw) => upperLabel.includes(kw)) &&
      valuesByColumn.size > 0;

    // Build values array
    const values: string[] = [];
    for (let ci = 0; ci < columns.length; ci++) {
      values.push(valuesByColumn.get(ci) || '');
    }

    rows.push({
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

  return { rows, columns };
}

// ============================================================
// Phase 1: Main Extract Function
// ============================================================

export async function extractFromImage(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<ExtractionResult> {
  // Get image dimensions
  const img = new Image();
  const imgUrl = URL.createObjectURL(file);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imgUrl;
  });

  const imageWidth = img.naturalWidth;
  const imageHeight = img.naturalHeight;
  URL.revokeObjectURL(imgUrl);

  // OCR
  const ocrResult = await performOcr(file, onProgress);

  // Layout analysis
  const { rows, columns } = analyzeLayout(
    ocrResult.lines,
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

  // If no columns detected, add at least one value column
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
  // Dynamic import for code splitting
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

  // Add border to header
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
        fgColor: { argb: 'FFF2F2F2' },
      };
    } else if (rowData.isTotal) {
      row.font = { bold: true, size: 10 };
      row.border = {
        top: { style: 'thin' },
        bottom: { style: 'double' },
      };
    } else {
      row.font = { size: 10 };
    }

    // Format individual cells
    // No column
    row.getCell(1).alignment = { horizontal: 'center' };

    // Keterangan column
    row.getCell(2).alignment = { horizontal: 'left', wrapText: true };

    // Value columns
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
  worksheet.getColumn(1).width = 6; // No
  worksheet.getColumn(2).width = 50; // Keterangan
  for (let i = 3; i <= headers.length; i++) {
    worksheet.getColumn(i).width = 22; // Value columns
  }

  // ---- Freeze header ----
  worksheet.views = [{ state: 'frozen', ySplit: 3 }];

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
