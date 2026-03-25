// ============================================================================
// PDF to Word Converter — Hybrid Adaptive Approach
//
// Task 1: PDF loading + structured text extraction (font parsing, line grouping)
// Task 2: docx generation (paragraphs + formatting + page breaks)
// Task 3: Table detection (x/y clustering heuristic)
// Task 4: Image extraction + OCR heuristic (confidence > 60% & words > 10 → text)
// Task 5: Layout reconstruction (paragraphs, tables, images by y-position)
//
// Processing strategy per page:
//   - Text-based PDF  → text extraction → table detection → layout reconstruction
//   - Scanned/image PDF → OCR fallback → text or image embed based on confidence
// ============================================================================

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
  AlignmentType,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ImageRun,
} from 'docx';

// ---------------------------------------------------------------------------
// Tesseract — dynamic import to avoid Next.js Web Worker bundling issues
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _createWorker: any = null;
async function getCreateWorker() {
  if (_createWorker) return _createWorker;
  const Tesseract = await import('tesseract.js');
  _createWorker = Tesseract.createWorker;
  return _createWorker;
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------
export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface PdfToWordResult {
  blob: Blob;
  pageCount: number;
  originalSize: number;
  processedSize: number;
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------
interface RawTextItem {
  str: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  isBold: boolean;
  isItalic: boolean;
  width: number;
}

interface TextLine {
  items: RawTextItem[];
  y: number;       // average baseline y (PDF coords: 0 = bottom)
  avgFontSize: number;
  minX: number;
  maxX: number;
}

interface ConsolidatedRun {
  text: string;
  isBold: boolean;
  isItalic: boolean;
  fontSize: number;
  fontName: string;
}

// A detected table block: ordered rows, each row is an ordered array of cell texts
interface TableBlock {
  rows: CellGrid[];
  yMin: number;
  yMax: number;
  lineIndices: Set<number>;
}

interface CellGrid {
  cells: ConsolidatedRun[][];  // cells[colIndex] = runs for that cell
  y: number;
}

// Unified content element per page, carrying y-position for sorting
type DocElement = Paragraph | Table;
interface PositionedElement {
  element: DocElement;
  y: number;  // used to order elements within a page
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 1: TEXT EXTRACTION ════════════════════════════════
// ---------------------------------------------------------------------------

function parseRawItem(item: unknown): RawTextItem | null {
  const i = item as {
    str?: string;
    transform?: number[];
    width?: number;
    fontName?: string;
  };

  if (!i.str || !i.transform) return null;
  if (i.str.trim() === '') return null;

  const transform = i.transform;
  const x = transform[4];
  const y = transform[5];
  // For horizontal text: transform[0] ≈ fontSize. Fall back to transform[3].
  const fontSize =
    Math.abs(transform[0]) > 1
      ? Math.abs(transform[0])
      : Math.abs(transform[3]) > 1
      ? Math.abs(transform[3])
      : 12;

  const fontName = i.fontName || '';
  // Strip 6-char ABCDEF+ subset prefix embedded in most PDF font names
  const normalizedFont = fontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();

  return {
    str: i.str,
    x,
    y,
    fontSize,
    fontName,
    isBold: /bold|heavy|black|demi/i.test(normalizedFont),
    isItalic: /italic|oblique|slant/i.test(normalizedFont),
    width: i.width || 0,
  };
}

function groupIntoLines(items: RawTextItem[]): TextLine[] {
  if (items.length === 0) return [];

  // Sort by y descending (higher y = higher on page in PDF coords), then x ascending
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextLine[] = [];
  let currentGroup: RawTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prev = currentGroup[currentGroup.length - 1];
    const threshold = Math.max(prev.fontSize, item.fontSize) * 0.45;

    if (Math.abs(item.y - prev.y) <= threshold) {
      currentGroup.push(item);
    } else {
      lines.push(buildLine(currentGroup));
      currentGroup = [item];
    }
  }
  if (currentGroup.length > 0) lines.push(buildLine(currentGroup));

  return lines;
}

function buildLine(items: RawTextItem[]): TextLine {
  const sortedByX = [...items].sort((a, b) => a.x - b.x);
  const avgFontSize = items.reduce((s, i) => s + i.fontSize, 0) / items.length;
  const avgY = items.reduce((s, i) => s + i.y, 0) / items.length;
  const rightEdges = sortedByX.map((i) => i.x + i.width);
  return {
    items: sortedByX,
    y: avgY,
    avgFontSize,
    minX: sortedByX[0].x,
    maxX: Math.max(...rightEdges),
  };
}

// Merge adjacent items with identical formatting into consolidated runs
function consolidateLineRuns(line: TextLine): ConsolidatedRun[] {
  const runs: ConsolidatedRun[] = [];

  for (let i = 0; i < line.items.length; i++) {
    const item = line.items[i];
    const prev = i > 0 ? line.items[i - 1] : null;

    let prefix = '';
    if (prev) {
      const gap = item.x - (prev.x + prev.width);
      if (gap > prev.fontSize * 0.25) prefix = ' ';
    }

    const text = prefix + item.str;
    const last = runs[runs.length - 1];

    if (
      last &&
      last.isBold === item.isBold &&
      last.isItalic === item.isItalic &&
      Math.abs(last.fontSize - item.fontSize) < 0.5 &&
      last.fontName === item.fontName
    ) {
      last.text += text;
    } else {
      runs.push({
        text,
        isBold: item.isBold,
        isItalic: item.isItalic,
        fontSize: item.fontSize,
        fontName: item.fontName,
      });
    }
  }

  return runs;
}

function extractFontFamily(fontName: string): string | undefined {
  const clean = fontName.replace(/^[A-Z]{6}\+/, '');
  if (/times/i.test(clean)) return 'Times New Roman';
  if (/arial/i.test(clean)) return 'Arial';
  if (/helvetica/i.test(clean)) return 'Arial';
  if (/courier/i.test(clean)) return 'Courier New';
  if (/calibri/i.test(clean)) return 'Calibri';
  if (/georgia/i.test(clean)) return 'Georgia';
  if (/verdana/i.test(clean)) return 'Verdana';
  if (/garamond/i.test(clean)) return 'Garamond';
  if (/palatino/i.test(clean)) return 'Palatino Linotype';
  return undefined;
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 2: PARAGRAPH GENERATION ═══════════════════════════
// ---------------------------------------------------------------------------

function runsToTextRuns(runs: ConsolidatedRun[]): TextRun[] {
  return runs.map((run) => {
    const fontFamily = extractFontFamily(run.fontName);
    return new TextRun({
      text: run.text,
      bold: run.isBold,
      italics: run.isItalic,
      size: Math.max(16, Math.round(run.fontSize * 2)), // half-points
      ...(fontFamily ? { font: fontFamily } : {}),
    });
  });
}

function lineToDocxParagraph(line: TextLine): Paragraph {
  const runs = consolidateLineRuns(line);
  const textRuns = runsToTextRuns(runs);

  const isHeading = line.avgFontSize >= 14 && line.items.every((i) => i.isBold);
  const isCentered = line.minX > 150; // heuristic for centered text

  return new Paragraph({
    children: textRuns,
    ...(isHeading ? { heading: HeadingLevel.HEADING_1 } : {}),
    alignment: isCentered ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { after: line.avgFontSize >= 14 ? 240 : 80 },
  });
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 3: TABLE DETECTION ════════════════════════════════
// ---------------------------------------------------------------------------

// Cluster a list of x-positions into column centers with the given tolerance
function clusterXPositions(xPositions: number[], tolerance: number): number[] {
  const clusters: number[] = [];
  for (const x of xPositions) {
    const nearest = clusters.findIndex((c) => Math.abs(c - x) <= tolerance);
    if (nearest >= 0) {
      // Update cluster center with running average (simple online mean)
      clusters[nearest] = (clusters[nearest] + x) / 2;
    } else {
      clusters.push(x);
    }
  }
  return clusters.sort((a, b) => a - b);
}

// Assign a text item to its nearest column index given column centers
function assignToColumn(x: number, columns: number[], tolerance: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < columns.length; i++) {
    const dist = Math.abs(columns[i] - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  // If the item is too far from any column, it doesn't belong → return -1
  return bestDist <= tolerance * 2 ? best : -1;
}

// A line is "table-like" if its items distribute across 2+ distinct x-columns
function isTableLikeLine(line: TextLine, columns: number[], tolerance: number): boolean {
  if (line.items.length < 2) return false;
  const usedColumns = new Set<number>();
  for (const item of line.items) {
    const col = assignToColumn(item.x, columns, tolerance);
    if (col >= 0) usedColumns.add(col);
  }
  return usedColumns.size >= 2;
}

// Main table detection: returns which line indices belong to tables,
// and the structured table data for each detected block
function detectTables(lines: TextLine[]): TableBlock[] {
  if (lines.length === 0) return [];

  // Collect all x-positions across all lines to build global column clusters
  const allX: number[] = lines.flatMap((l) => l.items.map((i) => i.x));
  const avgFontSize = lines.reduce((s, l) => s + l.avgFontSize, 0) / lines.length;
  const xTolerance = avgFontSize * 2.0;

  const globalColumns = clusterXPositions(allX, xTolerance);

  // Only meaningful if we have 2+ columns
  if (globalColumns.length < 2) return [];

  // Mark each line as table-like or not
  const isTableLike = lines.map((l) => isTableLikeLine(l, globalColumns, xTolerance));

  // Group consecutive table-like lines into blocks (min 2 rows = actual table)
  const blocks: TableBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTableLike[i]) { i++; continue; }

    // Found start of a potential table block
    const blockStart = i;
    while (i < lines.length && isTableLike[i]) i++;
    const blockEnd = i; // exclusive

    const blockLines = lines.slice(blockStart, blockEnd);
    if (blockLines.length < 2) continue; // single row — not a table

    // Determine column structure for this block specifically
    const blockX: number[] = blockLines.flatMap((l) => l.items.map((item) => item.x));
    const blockColumns = clusterXPositions(blockX, xTolerance);
    if (blockColumns.length < 2) continue;

    // Build cell grid for each row
    const cellGrid: CellGrid[] = blockLines.map((line) => {
      const cells: ConsolidatedRun[][] = Array.from({ length: blockColumns.length }, () => []);
      const runs = consolidateLineRuns(line);

      for (const run of runs) {
        // Map run to nearest column using the first item's x
        const firstItem = line.items.find(
          (item) => item.str === run.text.trim() || run.text.includes(item.str)
        );
        const x = firstItem ? firstItem.x : line.minX;
        const col = assignToColumn(x, blockColumns, xTolerance);
        if (col >= 0) cells[col].push(run);
      }

      return { cells, y: line.y };
    });

    const lineIndices = new Set<number>(
      Array.from({ length: blockEnd - blockStart }, (_, k) => blockStart + k)
    );

    blocks.push({
      rows: cellGrid,
      yMin: blockLines[blockLines.length - 1].y,
      yMax: blockLines[0].y,
      lineIndices,
    });
  }

  return blocks;
}

// Convert a detected TableBlock → docx Table
function tableBlockToDocxTable(block: TableBlock, numColumns: number): Table {
  const rows = block.rows.map((gridRow) => {
    const cells = Array.from({ length: numColumns }, (_, colIdx) => {
      const cellRuns = gridRow.cells[colIdx] || [];
      const textRuns = runsToTextRuns(cellRuns);
      return new TableCell({
        children: [
          new Paragraph({
            children: textRuns.length > 0 ? textRuns : [new TextRun({ text: '' })],
            spacing: { after: 60 },
          }),
        ],
      });
    });

    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows,
  });
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 4: IMAGE / OCR HANDLING ═══════════════════════════
// ---------------------------------------------------------------------------

const OCR_SCALE = 3;

async function hasTextContent(page: unknown): Promise<boolean> {
  const p = page as { getTextContent: () => Promise<{ items: unknown[] }> };
  const textContent = await p.getTextContent();
  const meaningfulItems = (textContent.items as Array<{ str?: string }>).filter(
    (item) => item.str && item.str.trim().length > 0
  );
  return meaningfulItems.length >= 10;
}

async function renderPageToCanvas(
  page: unknown,
  scaleFactor: number
): Promise<HTMLCanvasElement> {
  const p = page as {
    getViewport: (opts: { scale: number }) => { width: number; height: number };
    render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
  };
  const viewport = p.getViewport({ scale: scaleFactor });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function sauvolaThreshold(
  gray: Uint8Array,
  w: number,
  h: number,
  blockSize: number = 25,
  k: number = 0.15
): Uint8Array {
  const binary = new Uint8Array(w * h);
  const halfBlock = Math.floor(blockSize / 2);
  const R = 128;
  const integral = new Float64Array((w + 1) * (h + 1));
  const integralSq = new Float64Array((w + 1) * (h + 1));

  for (let y = 0; y < h; y++) {
    let rowSum = 0, rowSumSq = 0;
    for (let x = 0; x < w; x++) {
      const val = gray[y * w + x];
      rowSum += val;
      rowSumSq += val * val;
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      integralSq[(y + 1) * (w + 1) + (x + 1)] = integralSq[y * (w + 1) + (x + 1)] + rowSumSq;
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - halfBlock), y0 = Math.max(0, y - halfBlock);
      const x1 = Math.min(w - 1, x + halfBlock), y1 = Math.min(h - 1, y + halfBlock);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      const sumSq =
        integralSq[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integralSq[y0 * (w + 1) + (x1 + 1)] -
        integralSq[(y1 + 1) * (w + 1) + x0] +
        integralSq[y0 * (w + 1) + x0];
      const mean = sum / count;
      const stddev = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
      binary[y * w + x] = gray[y * w + x] > mean * (1 + k * (stddev / R - 1)) ? 255 : 0;
    }
  }
  return binary;
}

async function preprocessCanvasForOcr(
  canvas: HTMLCanvasElement,
  scaleFactor: number
): Promise<Blob> {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const pixelCount = w * h;

  // Grayscale (BT.601 luma)
  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

  // Contrast normalization (1%–99% histogram stretch)
  const hist = new Uint32Array(256);
  for (let i = 0; i < pixelCount; i++) hist[gray[i]]++;
  let cumul = 0, p1 = 0, p99 = 255;
  for (let v = 0; v < 256; v++) {
    cumul += hist[v];
    if (cumul / pixelCount < 0.01) p1 = v;
    if (cumul / pixelCount < 0.99) p99 = v;
  }
  const cRange = Math.max(p99 - p1, 1);
  for (let i = 0; i < pixelCount; i++) {
    gray[i] = Math.round(Math.max(0, Math.min(255, ((gray[i] - p1) / cRange) * 255)));
  }

  // Unsharp mask (3×3 box blur, strength 1.0)
  const blurred = new Uint8Array(pixelCount);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          sum += gray[(y + dy) * w + (x + dx)];
      blurred[y * w + x] = Math.round(sum / 9);
    }
  }
  for (let x = 0; x < w; x++) { blurred[x] = gray[x]; blurred[(h - 1) * w + x] = gray[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { blurred[y * w] = gray[y * w]; blurred[y * w + w - 1] = gray[y * w + w - 1]; }

  const sharpened = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    sharpened[i] = Math.max(0, Math.min(255, Math.round(gray[i] + 1.0 * (gray[i] - blurred[i]))));
  }

  // Sauvola adaptive binarization
  const blockSize = Math.round(25 * scaleFactor / 3);
  const binary = sauvolaThreshold(sharpened, w, h, blockSize, 0.15);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    data[idx] = data[idx + 1] = data[idx + 2] = binary[i];
    data[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}

interface OcrPageResult {
  confidence: number;
  wordCount: number;
  lines: string[];  // OCR text grouped by line
}

async function runOcrOnPage(imageBlob: Blob): Promise<OcrPageResult> {
  const createWorker = await getCreateWorker();
  const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist';
  const CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0';
  const BEST_LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

  const workerOpts = {
    workerPath: `${TESS_CDN}/worker.min.js`,
    corePath: `${CORE_CDN}/tesseract-core-simd-lstm.wasm.js`,
    logger: () => {},
  };

  // Try Indonesian first, fall back to English
  let worker;
  try {
    worker = await createWorker('ind', 1, {
      ...workerOpts,
      langPath: `${BEST_LANG_PATH}/ind@1.0.0/4.0.0_best_int`,
    });
  } catch {
    worker = await createWorker('eng', 1, {
      ...workerOpts,
      langPath: `${BEST_LANG_PATH}/eng@1.0.0/4.0.0_best_int`,
    });
  }

  const dpi = String(Math.round(OCR_SCALE * 72));
  await worker.setParameters({
    tessedit_pageseg_mode: '6' as unknown,
    preserve_interword_spaces: '1' as unknown,
    user_defined_dpi: dpi as unknown,
  });
  const result = await worker.recognize(imageBlob);
  await worker.terminate();

  const data = result.data;
  const lines: string[] = [];
  let wordCount = 0;

  if (data.blocks) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const lineText = line.words.map((w: { text: string }) => w.text).join(' ').trim();
          if (lineText) {
            lines.push(lineText);
            wordCount += line.words.length;
          }
        }
      }
    }
  }

  return {
    confidence: data.confidence || 0,
    wordCount,
    lines,
  };
}

async function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas export failed'));
      blob.arrayBuffer().then(resolve).catch(reject);
    }, 'image/png');
  });
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 5: LAYOUT RECONSTRUCTION ══════════════════════════
// ---------------------------------------------------------------------------

// Process a text-based page: combine table detection + paragraph extraction,
// sorted by y-position (top to bottom reading order).
function buildTextPageContent(lines: TextLine[]): DocElement[] {
  if (lines.length === 0) return [];

  const tables = detectTables(lines);

  // Build a set of line indices consumed by tables
  const tableLineIndices = new Set<number>();
  for (const table of tables) {
    for (const idx of table.lineIndices) tableLineIndices.add(idx);
  }

  // Collect positioned elements: paragraphs from non-table lines + tables
  const positioned: PositionedElement[] = [];

  // Paragraphs (lines not in a table)
  for (let i = 0; i < lines.length; i++) {
    if (tableLineIndices.has(i)) continue;
    positioned.push({
      element: lineToDocxParagraph(lines[i]),
      y: lines[i].y,
    });
  }

  // Tables
  for (const table of tables) {
    const numColumns = Math.max(...table.rows.map((r) => r.cells.length));
    positioned.push({
      element: tableBlockToDocxTable(table, numColumns),
      y: table.yMax, // use top of table for sorting
    });
  }

  // Sort by y descending (top of page = highest y in PDF coordinates)
  positioned.sort((a, b) => b.y - a.y);

  return positioned.map((p) => p.element);
}

// Process a scanned page: OCR → paragraphs, or image embed
async function buildScannedPageContent(
  page: unknown,
  onProgress: (u: ProcessingUpdate) => void,
  progressBase: number,
  pageNum: number
): Promise<DocElement[]> {
  onProgress({
    progress: progressBase,
    status: `Page ${pageNum}: Scanned — rendering for OCR...`,
  });

  const canvas = await renderPageToCanvas(page, OCR_SCALE);
  const binarizedBlob = await preprocessCanvasForOcr(canvas, OCR_SCALE);

  onProgress({
    progress: progressBase + 3,
    status: `Page ${pageNum}: Running OCR...`,
  });

  const ocrResult = await runOcrOnPage(binarizedBlob);

  // Heuristic: use OCR text if confidence is good AND there are meaningful words
  if (ocrResult.confidence >= 60 && ocrResult.wordCount >= 10) {
    onProgress({
      progress: progressBase + 10,
      status: `Page ${pageNum}: OCR confidence ${ocrResult.confidence.toFixed(0)}% — converting to text...`,
    });

    return ocrResult.lines.map(
      (lineText) =>
        new Paragraph({
          children: [new TextRun({ text: lineText, size: 24 })],
          spacing: { after: 80 },
        })
    );
  }

  // Low OCR confidence → embed the page as an image in the Word document
  onProgress({
    progress: progressBase + 10,
    status: `Page ${pageNum}: Low OCR confidence (${ocrResult.confidence.toFixed(0)}%) — embedding as image...`,
  });

  // Re-render at 2× for a cleaner image (no binarization artifacts)
  const imageCanvas = await renderPageToCanvas(page, 2);
  const imageBuffer = await canvasToArrayBuffer(imageCanvas);

  // Target width: ~450pt (standard Word page content width)
  const p = page as { getViewport: (opts: { scale: number }) => { width: number; height: number } };
  const viewport = p.getViewport({ scale: 1 });
  const targetWidth = 450;
  const aspectRatio = viewport.height / viewport.width;
  const targetHeight = Math.round(targetWidth * aspectRatio);

  return [
    new Paragraph({
      children: [
        new ImageRun({
          data: imageBuffer,
          transformation: { width: targetWidth, height: targetHeight },
          type: 'png',
        }),
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// ════════════════════ MAIN ENTRY POINT ══════════════════════════════════════
// ---------------------------------------------------------------------------

export async function convertPdfToWord(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<PdfToWordResult> {
  onProgress({ progress: 5, status: 'Loading PDF...' });

  // Dynamic import: avoids SSR/webpack Web Worker bundling issues in Next.js
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  onProgress({
    progress: 10,
    status: `Found ${totalPages} page(s). Analyzing content...`,
  });

  const allDocChildren: DocElement[] = [];
  const progressPerPage = 75 / totalPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const progressBase = 10 + Math.round((pageNum - 1) * progressPerPage);

    onProgress({
      progress: progressBase,
      status: `Processing page ${pageNum} of ${totalPages}...`,
    });

    const page = await pdf.getPage(pageNum);
    const isText = await hasTextContent(page);

    let pageElements: DocElement[];

    if (isText) {
      // Text-based page: extract text, detect tables, reconstruct layout
      const textContent = await (page as unknown as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent();
      const rawItems = (textContent.items as unknown[])
        .map(parseRawItem)
        .filter((i): i is RawTextItem => i !== null);

      if (rawItems.length === 0) {
        pageElements = [new Paragraph({ children: [] })];
      } else {
        const lines = groupIntoLines(rawItems);
        pageElements = buildTextPageContent(lines);
      }
    } else {
      // Scanned/image page: OCR fallback or image embed
      pageElements = await buildScannedPageContent(
        page,
        onProgress,
        progressBase,
        pageNum
      );
    }

    allDocChildren.push(...pageElements);

    // Page break between pages (not after the last page)
    if (pageNum < totalPages) {
      allDocChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }
  }

  onProgress({ progress: 88, status: 'Generating Word document...' });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: allDocChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);

  onProgress({ progress: 100, status: 'Done!' });

  return {
    blob,
    pageCount: totalPages,
    originalSize: file.size,
    processedSize: blob.size,
  };
}
