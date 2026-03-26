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
  LineRuleType,
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
  qualityScore: number;
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
      if (gap > prev.fontSize * 0.15) prefix = ' ';
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

// Default font for OCR content and unrecognized PDF fonts.
// Arial is the closest universally-available equivalent to common web fonts
// (Inter, Roboto, Helvetica, system-ui) that appear in web-printed PDFs.
const DEFAULT_FONT = 'Arial';

function extractFontFamily(fontName: string): string {
  // Strip ABCDEF+ subset prefix common in embedded/subsetted PDF fonts
  const clean = fontName.replace(/^[A-Z]{6}\+/, '');

  // Named font matches (case-insensitive)
  if (/times\s*new\s*roman|timesnewroman/i.test(clean)) return 'Times New Roman';
  if (/times/i.test(clean)) return 'Times New Roman';
  if (/arial/i.test(clean)) return 'Arial';
  if (/helvetica/i.test(clean)) return 'Arial';   // Helvetica → Arial (equivalent)
  if (/courier\s*new|couriernew/i.test(clean)) return 'Courier New';
  if (/courier/i.test(clean)) return 'Courier New';
  if (/calibri/i.test(clean)) return 'Calibri';
  if (/georgia/i.test(clean)) return 'Georgia';
  if (/verdana/i.test(clean)) return 'Verdana';
  if (/garamond/i.test(clean)) return 'Garamond';
  if (/palatino/i.test(clean)) return 'Palatino Linotype';
  if (/trebuchet/i.test(clean)) return 'Trebuchet MS';
  if (/tahoma/i.test(clean)) return 'Tahoma';
  if (/cambria/i.test(clean)) return 'Cambria';
  if (/franklin\s*gothic|franklingothic/i.test(clean)) return 'Franklin Gothic Medium';
  // Common web fonts → closest Word-available equivalent
  if (/inter|roboto|opensans|open\s*sans|lato|source\s*sans|sourcesans/i.test(clean)) return 'Arial';
  if (/merriweather|playfair|lora|source\s*serif|sourceserif/i.test(clean)) return 'Georgia';
  if (/montserrat|raleway|nunito|poppins|ubuntu/i.test(clean)) return 'Arial';

  // Obfuscated/subset font names (e.g. g_d0_f1, AAAAAB+font000000...) → default
  return DEFAULT_FONT;
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 2: PARAGRAPH GENERATION ═══════════════════════════
// ---------------------------------------------------------------------------

function runsToTextRuns(runs: ConsolidatedRun[]): TextRun[] {
  return runs.map((run) => {
    return new TextRun({
      text: run.text,
      bold: run.isBold,
      italics: run.isItalic,
      size: Math.max(16, Math.round(run.fontSize * 2)), // half-points (1pt = 2 half-pts)
      font: extractFontFamily(run.fontName),
    });
  });
}

function lineToDocxParagraph(
  line: TextLine,
  pageWidth: number = 595,
  baseX: number = 0,
  spacingAfterTWIPs: number = 80,
  contentRight: number = 0
): Paragraph {
  const runs = consolidateLineRuns(line);
  const textRuns = runsToTextRuns(runs);

  // Heading detection: font size alone is the signal.
  // Requiring isBold would miss titles in PDFs with obfuscated font names
  // (e.g. g_d0_f3) where bold cannot be inferred from the font name string.
  const isHeading = line.avgFontSize >= 16;

  // Centering detection: a line is "centered" when its visual center (midpoint between
  // leftmost and rightmost glyph) is within 2% of the page width from the page center.
  // PDF layout engines place centered text very precisely, so 2% (≈12pt on A4) is tight
  // enough to reject left-aligned full-width text (whose center drifts noticeably) while
  // accepting titles, headings, and institutional headers that are geometrically centered.
  const pageCenter = pageWidth / 2;
  const lineCenter = (line.minX + line.maxX) / 2;
  const isCentered = Math.abs(lineCenter - pageCenter) < pageWidth * 0.02;

  // Full-justify detection: a non-centered line is "full-width" when its rightmost
  // glyph reaches at least 92% of the content area's right boundary (contentRight).
  // Full-width lines represent body text that spans margin-to-margin in the original PDF
  // (justified alignment). Short lines — the last line of a paragraph, list labels,
  // or short bullet text — fall below this threshold and remain left-aligned.
  const isJustified = !isCentered && contentRight > 0 && line.maxX >= contentRight * 0.92;

  // Indentation relative to baseX (the left margin of this page).
  // Only applied to non-centered lines; ignored when indentTWIPs = 0.
  const indentTWIPs = isCentered ? 0 : Math.max(0, Math.round((line.minX - baseX) * 20));

  let alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  if (isCentered) alignment = AlignmentType.CENTER;
  else if (isJustified) alignment = AlignmentType.BOTH;
  else alignment = AlignmentType.LEFT;

  return new Paragraph({
    children: textRuns,
    ...(isHeading ? { heading: HeadingLevel.HEADING_1 } : {}),
    alignment,
    spacing: {
      after: line.avgFontSize >= 14 ? 240 : spacingAfterTWIPs,
      line: 240,
      lineRule: LineRuleType.AUTO,
    },
    ...(indentTWIPs > 0 ? { indent: { left: indentTWIPs } } : {}),
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

// A line is "table-like" if it contains at least one large inter-item gap —
// a gap wider than 3× the average font size. This indicates distinct column
// regions separated by whitespace (as in real tables), rather than normal
// word-spaced flowing text. This approach is document-agnostic: it does not
// rely on column clustering that can be polluted by centered titles or page
// number positions creating false column anchors.
function isTableLikeLine(line: TextLine, _columns: number[], _tolerance: number): boolean {
  if (line.items.length < 2) return false;
  const sorted = [...line.items].sort((a, b) => a.x - b.x);
  const columnGapThreshold = line.avgFontSize * 3;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
    if (gap > columnGapThreshold) return true;
  }
  return false;
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

    // Build cell grid for each row.
    // Strategy: split items into cell groups at column-gap boundaries FIRST,
    // then consolidate runs within each group. This avoids the bug where
    // consolidateLineRuns() merges all items into one run before column
    // assignment, causing everything to land in column 0.
    const cellGrid: CellGrid[] = blockLines.map((line) => {
      const cells: ConsolidatedRun[][] = Array.from({ length: blockColumns.length }, () => []);
      const sorted = [...line.items].sort((a, b) => a.x - b.x);

      // Group items into cell regions using the same gap threshold as isTableLikeLine
      const columnGapThreshold = line.avgFontSize * 3;
      let groupItems: RawTextItem[] = [sorted[0]];

      const flushGroup = () => {
        if (groupItems.length === 0) return;
        const cellLine = buildLine(groupItems);
        const col = assignToColumn(groupItems[0].x, blockColumns, xTolerance);
        if (col >= 0) cells[col].push(...consolidateLineRuns(cellLine));
        groupItems = [];
      };

      for (let j = 1; j < sorted.length; j++) {
        const gap = sorted[j].x - (sorted[j - 1].x + sorted[j - 1].width);
        if (gap > columnGapThreshold) {
          flushGroup();
        }
        groupItems.push(sorted[j]);
      }
      flushGroup(); // flush the last group

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

  // Fast reject: too few items
  if (meaningfulItems.length < 10) return false;

  // Guard against pages that have many items but only header/footer text
  // (e.g. browser-printed PDFs where content is rasterized but header/URL is text).
  // Group into lines; if fewer than 5 distinct lines, treat as image-based.
  const rawItems = meaningfulItems.map(parseRawItem).filter((i): i is RawTextItem => i !== null);
  const lines = groupIntoLines(rawItems);
  return lines.length >= 5;
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

// A logical paragraph extracted by Tesseract, with pixel bbox for spacing computation
interface OcrParagraph {
  text: string;
  y0Px: number;            // top of paragraph in OCR canvas pixels
  y1Px: number;            // bottom of paragraph in OCR canvas pixels
  numLines: number;
  estimatedFontSizePt: number; // derived from average line bbox height
}

interface OcrPageResult {
  confidence: number;
  wordCount: number;
  paragraphs: OcrParagraph[];
}

// Filter browser-generated header/footer lines that appear in web-printed PDFs
function isBrowserHeaderFooter(text: string): boolean {
  const t = text.trim();
  // Date/time + site title: "3/9/26, 8:45 AM ... | SiteName"
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]/.test(t)) return true;
  // URL line
  if (/^https?:\/\//.test(t)) return true;
  // Standalone page counter "1/7" or "Page 1 of 7"
  if (/^\d+\/\d+$/.test(t)) return true;
  if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
  return false;
}

// Detect a standalone page number line: single pure-digit text positioned in
// the right half of the page. These are printed by PDF generators as footers.
// We filter them out before layout reconstruction to prevent them from creating
// phantom column clusters in the table detection pass.
function isPageNumberLine(line: TextLine, pageWidth: number): boolean {
  if (line.items.length > 2) return false;
  const text = line.items.map((i) => i.str).join('').trim();
  return /^\d{1,4}$/.test(text) && line.minX > pageWidth * 0.4;
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
  // PSM 3: fully automatic page segmentation (no OSD) — detects multiple
  // independent text blocks per page, giving better paragraph granularity
  // than PSM 6 ("single uniform block") which merges whole page into one block.
  await worker.setParameters({
    tessedit_pageseg_mode: '3' as unknown,
    preserve_interword_spaces: '1' as unknown,
    user_defined_dpi: dpi as unknown,
  });
  const result = await worker.recognize(imageBlob);
  await worker.terminate();

  const data = result.data;
  const paragraphs: OcrParagraph[] = [];
  let wordCount = 0;

  if (data.blocks) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs) {
        const paraLines: string[] = [];
        let y0 = Infinity, y1 = -Infinity;
        let lineCount = 0;
        const lineHeightsPx: number[] = [];

        for (const line of para.lines) {
          const lineText = line.words
            .map((w: { text: string }) => w.text)
            .join(' ')
            .trim();
          if (!lineText) continue;

          // Filter header/footer per individual line, NOT per whole paragraph.
          // Filtering the joined paragraph text causes entire quiz content to be
          // dropped when Tesseract groups the header + content into one paragraph.
          if (isBrowserHeaderFooter(lineText)) continue;

          paraLines.push(lineText);
          wordCount += line.words.length;
          lineCount++;

          if (line.bbox) {
            y0 = Math.min(y0, line.bbox.y0);
            y1 = Math.max(y1, line.bbox.y1);
            // Collect individual line heights for accurate font-size estimation.
            // Using para bbox / numLines is wrong when para covers a large area
            // (e.g. an entire page grouped as one Tesseract paragraph).
            const lh = line.bbox.y1 - line.bbox.y0;
            if (lh > 0) lineHeightsPx.push(lh);
          }
        }

        const rawText = paraLines.join(' ');
        // Strip inline URLs that Tesseract may have merged into the same line
        // as real content (e.g. footer URL appended to the last answer-key line)
        const text = rawText
          .replace(/\s*https?:\/\/\S+/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (!text) continue;

        // Font size: average line height → pt → divide by 1.2 (standard line-height ratio)
        const avgLineHeightPx =
          lineHeightsPx.length > 0
            ? lineHeightsPx.reduce((a, b) => a + b, 0) / lineHeightsPx.length
            : 0;
        const rawFontSizePt =
          avgLineHeightPx > 0 ? avgLineHeightPx / OCR_SCALE / 1.2 : 11;

        paragraphs.push({
          text,
          y0Px: isFinite(y0) ? y0 : 0,
          y1Px: isFinite(y1) ? y1 : 0,
          numLines: lineCount,
          estimatedFontSizePt: Math.max(7, Math.min(22, Math.round(rawFontSizePt))),
        });
      }
    }
  }

  return {
    confidence: data.confidence || 0,
    wordCount,
    paragraphs: consolidateOcrParagraphs(paragraphs),
  };
}

// ---------------------------------------------------------------------------
// Post-process: consolidate OCR paragraph fragments into coherent blocks
//
// PSM 3 sometimes over-segments:
//   1. Standalone question numbers ("12.") detected as a separate text column
//      from the question body — merge with the following paragraph.
//   2. Continuation fragments: a fragment that begins mid-sentence (lowercase
//      start) AND sits spatially close to the previous paragraph is merged in.
//      "Close" is defined as a y-gap smaller than one average line height —
//      this is purely structural (no content assumptions).
//   3. Normalize font sizes within a page: all body paragraphs should use the
//      most common (mode) font size detected, preventing the 7pt/9pt/12pt
//      scatter that PSM 3 introduces for differently-sized text regions.
// ---------------------------------------------------------------------------
function consolidateOcrParagraphs(paragraphs: OcrParagraph[]): OcrParagraph[] {
  if (paragraphs.length === 0) return paragraphs;

  // Pass 1: merge standalone numbers ("12." or "12") forward into next paragraph
  const pass1: OcrParagraph[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const t = para.text.trim();
    if (/^\d{1,2}\.?\s*$/.test(t) && i + 1 < paragraphs.length) {
      const next = paragraphs[++i];
      pass1.push({
        ...next,
        text: t + ' ' + next.text.trim(),
        y0Px: para.y0Px,
        estimatedFontSizePt: Math.max(para.estimatedFontSizePt, next.estimatedFontSizePt),
      });
    } else {
      pass1.push(para);
    }
  }

  // Pass 2: merge continuation fragments using a spatial y-gap heuristic.
  // A paragraph is a continuation of the previous one when:
  //   (a) it starts with a lowercase letter (sentence continues mid-word/mid-line), AND
  //   (b) the vertical gap between the bottom of the previous paragraph (y1Px)
  //       and the top of this paragraph (y0Px) is less than one estimated line
  //       height — indicating the two are visually contiguous, not separate blocks.
  // This approach is document-agnostic: it relies solely on spatial proximity
  // in the original rendered layout, not on any content format assumption.
  const pass2: OcrParagraph[] = [];
  for (const para of pass1) {
    const t = para.text.trim();
    const startsLowercase = /^[a-z]/.test(t);

    if (startsLowercase && pass2.length > 0) {
      const prev = pass2[pass2.length - 1];
      // Derive a single-line height estimate from the previous paragraph's font size.
      // estimatedFontSizePt was computed from OCR canvas pixels (at OCR_SCALE resolution),
      // so multiplying back by OCR_SCALE gives the pixel height of one line on the canvas.
      // 1.5× accounts for typical line leading (line height > glyph height).
      const approxLineHeightPx = prev.estimatedFontSizePt * OCR_SCALE * 1.5;
      const yGap = para.y0Px - prev.y1Px;

      if (yGap < approxLineHeightPx) {
        // Spatially contiguous — treat as continuation of same paragraph
        pass2[pass2.length - 1] = {
          ...prev,
          text: prev.text.trimEnd() + ' ' + t,
          y1Px: para.y1Px,
        };
        continue;
      }
    }

    pass2.push(para);
  }

  // Pass 3: normalize font size to the mode of content paragraphs
  // (paragraphs with >= 20 chars considered body text)
  const bodyParas = pass2.filter((p) => p.text.length >= 20);
  if (bodyParas.length > 0) {
    // Compute mode font size
    const freq = new Map<number, number>();
    for (const p of bodyParas) {
      freq.set(p.estimatedFontSizePt, (freq.get(p.estimatedFontSizePt) ?? 0) + 1);
    }
    const modeFontSize = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];

    return pass2.map((p) => ({
      ...p,
      // Apply mode only for paragraphs within ±3pt of mode (genuine body text),
      // keep outliers as-is (real headings, footnotes, etc.)
      estimatedFontSizePt:
        Math.abs(p.estimatedFontSizePt - modeFontSize) <= 3
          ? modeFontSize
          : p.estimatedFontSizePt,
    }));
  }

  return pass2;
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
function buildTextPageContent(lines: TextLine[], pageWidth: number = 595): DocElement[] {
  if (lines.length === 0) return [];

  const tables = detectTables(lines);

  // Build a set of line indices consumed by tables
  const tableLineIndices = new Set<number>();
  for (const table of tables) {
    for (const idx of table.lineIndices) tableLineIndices.add(idx);
  }

  // Compute baseX: the leftmost common left-margin position on this page.
  // Strategy: cluster all line.minX values, then pick the leftmost cluster where:
  //   (a) x > 36pt — excludes truly stray elements near the physical page edge,
  //   (b) at least one line starts there — tolerates section headers that appear
  //       only once per page while still filtering elements below the page edge.
  // On most pages the left margin cluster (e.g. x=72) wins because it's leftmost
  // among candidates that satisfy both conditions.
  const allMinX = lines.map((l) => l.minX);
  const avgFontSize = lines.reduce((s, l) => s + l.avgFontSize, 0) / lines.length;
  const xClusters = clusterXPositions(allMinX, avgFontSize * 0.5);
  const baseX =
    xClusters.find(
      (c) =>
        c > 36 &&
        allMinX.some((x) => Math.abs(x - c) <= avgFontSize)
    ) ?? 0;

  // Compute contentRight: the true right margin of this page.
  // Strategy: cluster all line.maxX values, then take the RIGHTMOST cluster that
  // contains at least 2 lines. Using the rightmost (not most-frequent) cluster means
  // pages with many short indented lines don't have their right margin underestimated —
  // the full-width lines (even if fewer) define the actual content boundary.
  const allMaxX = lines
    .filter((_, idx) => !tableLineIndices.has(idx))
    .map((l) => l.maxX);
  const maxXClusters = clusterXPositions(allMaxX, avgFontSize);
  const qualifyingRightClusters = maxXClusters.filter(
    (c) => allMaxX.filter((x) => Math.abs(x - c) <= avgFontSize).length >= 2
  );
  const contentRight = qualifyingRightClusters.length > 0
    ? Math.max(...qualifyingRightClusters)
    : 0;

  // Compute spacingAfter for each non-table line: y-gap to the next line below it,
  // minus the expected single-line height (fontSize × 1.3). Extra gap → larger spacing.
  const nonTableLineInfos = lines
    .map((l, idx) => ({ l, idx }))
    .filter(({ idx }) => !tableLineIndices.has(idx));
  const spacingMap = new Map<number, number>();
  for (let i = 0; i < nonTableLineInfos.length - 1; i++) {
    const curr = nonTableLineInfos[i].l;
    const next = nonTableLineInfos[i + 1].l;
    const lineSpacing = curr.y - next.y;
    const expectedHeight = curr.avgFontSize * 1.3;
    const extraGap = lineSpacing - expectedHeight;
    const spacing = extraGap > 0
      ? Math.round(Math.max(40, Math.min(360, extraGap * 20)))
      : 80;
    spacingMap.set(nonTableLineInfos[i].idx, spacing);
  }

  // Collect positioned elements: paragraphs from non-table lines + tables
  const positioned: PositionedElement[] = [];

  // Paragraphs (lines not in a table)
  for (let i = 0; i < lines.length; i++) {
    if (tableLineIndices.has(i)) continue;
    const spacingAfterTWIPs = spacingMap.get(i) ?? 80;
    positioned.push({
      element: lineToDocxParagraph(lines[i], pageWidth, baseX, spacingAfterTWIPs, contentRight),
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

    const { paragraphs } = ocrResult;
    return paragraphs.map((para, i) => {
      // Font size pre-computed from individual line bboxes in runOcrOnPage
      const fontSizePt = para.estimatedFontSizePt;

      // Spacing after: gap between bottom of this paragraph and top of next
      // Converted from canvas pixels → points → TWIPs (1pt = 20 TWIPs)
      // Clamp: 40 TWIPs min (2pt), 360 TWIPs max (18pt) for realistic document spacing
      const next = paragraphs[i + 1];
      let spacingAfterTWIPs = 120; // default ~6pt
      if (next && para.y1Px > 0 && next.y0Px > para.y1Px) {
        const gapPt = (next.y0Px - para.y1Px) / OCR_SCALE;
        spacingAfterTWIPs = Math.round(Math.max(40, Math.min(360, gapPt * 20)));
      }

      return new Paragraph({
        children: [
          new TextRun({
            text: para.text,
            size: fontSizePt * 2, // half-points
            font: DEFAULT_FONT,
          }),
        ],
        spacing: { after: spacingAfterTWIPs },
      });
    });
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
  let pagesWithText = 0;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const progressBase = 10 + Math.round((pageNum - 1) * progressPerPage);

    onProgress({
      progress: progressBase,
      status: `Processing page ${pageNum} of ${totalPages}...`,
    });

    const page = await pdf.getPage(pageNum);
    const pageViewport = (page as unknown as { getViewport: (o: { scale: number }) => { width: number } }).getViewport({ scale: 1.0 });
    const pageWidth = pageViewport.width;
    const isText = await hasTextContent(page);

    let pageElements: DocElement[];

    if (isText) {
      pagesWithText++;
      // Text-based page: extract text, detect tables, reconstruct layout
      const textContent = await (page as unknown as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent();
      const rawItems = (textContent.items as unknown[])
        .map(parseRawItem)
        .filter((i): i is RawTextItem => i !== null);

      if (rawItems.length === 0) {
        pageElements = [new Paragraph({ children: [] })];
      } else {
        const lines = groupIntoLines(rawItems);
        // Filter standalone page numbers and browser header/footer lines before
        // layout reconstruction. These lines contribute spurious x-positions to
        // column clustering, which can cause flowing text to be misdetected as
        // table rows. Filtering them here mirrors the OCR path's own filtering.
        const filteredLines = lines.filter((l) => {
          const text = l.items.map((i) => i.str).join('');
          return !isBrowserHeaderFooter(text) && !isPageNumberLine(l, pageWidth);
        });
        pageElements = buildTextPageContent(filteredLines, pageWidth);
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
    qualityScore: Math.round(pagesWithText / totalPages * 100),
  };
}
