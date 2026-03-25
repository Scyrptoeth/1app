// ============================================================================
// PDF to PowerPoint Converter — Hybrid Adaptive Approach
//
// Reuses text extraction, line grouping, table detection, and OCR logic
// from pdf-to-word.ts. Output generation uses PptxGenJS with absolute
// coordinate positioning (x, y, w, h in inches) instead of docx flow layout.
//
// Processing strategy per page:
//   - Text-based PDF  → text extraction → absolute text boxes + tables
//   - Scanned/image PDF → OCR fallback → text boxes or image embed
// ============================================================================

// Tesseract — dynamic import to avoid Next.js Web Worker bundling issues
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

export interface PdfToPptResult {
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
  y: number;        // average baseline y (PDF coords: 0 = bottom)
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

interface TableBlock {
  rows: CellGrid[];
  yMin: number;
  yMax: number;
  lineIndices: Set<number>;
}

interface CellGrid {
  cells: ConsolidatedRun[][];
  y: number;
}

interface OcrParagraph {
  text: string;
  y0Px: number;
  y1Px: number;
  numLines: number;
  estimatedFontSizePt: number;
}

interface OcrPageResult {
  confidence: number;
  wordCount: number;
  paragraphs: OcrParagraph[];
}

const OCR_SCALE = 3;
const DEFAULT_FONT = 'Arial';
// 1 PDF point = 1/72 inches
const PT_TO_IN = 1 / 72;

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
  const fontSize =
    Math.abs(transform[0]) > 1
      ? Math.abs(transform[0])
      : Math.abs(transform[3]) > 1
      ? Math.abs(transform[3])
      : 12;

  const fontName = i.fontName || '';
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

function extractFontFamily(fontName: string): string {
  const clean = fontName.replace(/^[A-Z]{6}\+/, '');

  if (/times\s*new\s*roman|timesnewroman/i.test(clean)) return 'Times New Roman';
  if (/times/i.test(clean)) return 'Times New Roman';
  if (/arial/i.test(clean)) return 'Arial';
  if (/helvetica/i.test(clean)) return 'Arial';
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
  if (/inter|roboto|opensans|open\s*sans|lato|source\s*sans|sourcesans/i.test(clean)) return 'Arial';
  if (/merriweather|playfair|lora|source\s*serif|sourceserif/i.test(clean)) return 'Georgia';
  if (/montserrat|raleway|nunito|poppins|ubuntu/i.test(clean)) return 'Arial';

  return DEFAULT_FONT;
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 2: TABLE DETECTION ════════════════════════════════
// ---------------------------------------------------------------------------

function clusterXPositions(xPositions: number[], tolerance: number): number[] {
  const clusters: number[] = [];
  for (const x of xPositions) {
    const nearest = clusters.findIndex((c) => Math.abs(c - x) <= tolerance);
    if (nearest >= 0) {
      clusters[nearest] = (clusters[nearest] + x) / 2;
    } else {
      clusters.push(x);
    }
  }
  return clusters.sort((a, b) => a - b);
}

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
  return bestDist <= tolerance * 2 ? best : -1;
}

function isTableLikeLine(line: TextLine): boolean {
  if (line.items.length < 2) return false;
  const sorted = [...line.items].sort((a, b) => a.x - b.x);
  const columnGapThreshold = line.avgFontSize * 3;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
    if (gap > columnGapThreshold) return true;
  }
  return false;
}

function detectTables(lines: TextLine[]): TableBlock[] {
  if (lines.length === 0) return [];

  const allX: number[] = lines.flatMap((l) => l.items.map((i) => i.x));
  const avgFontSize = lines.reduce((s, l) => s + l.avgFontSize, 0) / lines.length;
  const xTolerance = avgFontSize * 2.0;
  const globalColumns = clusterXPositions(allX, xTolerance);

  if (globalColumns.length < 2) return [];

  const isTableLike = lines.map((l) => isTableLikeLine(l));
  const blocks: TableBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!isTableLike[i]) { i++; continue; }

    const blockStart = i;
    while (i < lines.length && isTableLike[i]) i++;
    const blockEnd = i;

    const blockLines = lines.slice(blockStart, blockEnd);
    if (blockLines.length < 2) continue;

    const blockX: number[] = blockLines.flatMap((l) => l.items.map((item) => item.x));
    const blockColumns = clusterXPositions(blockX, xTolerance);
    if (blockColumns.length < 2) continue;

    const cellGrid: CellGrid[] = blockLines.map((line) => {
      const cells: ConsolidatedRun[][] = Array.from({ length: blockColumns.length }, () => []);
      const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
      const columnGapThreshold = line.avgFontSize * 3;
      let groupItems: RawTextItem[] = [sortedItems[0]];

      const flushGroup = () => {
        if (groupItems.length === 0) return;
        const cellLine = buildLine(groupItems);
        const col = assignToColumn(groupItems[0].x, blockColumns, xTolerance);
        if (col >= 0) cells[col].push(...consolidateLineRuns(cellLine));
        groupItems = [];
      };

      for (let j = 1; j < sortedItems.length; j++) {
        const gap = sortedItems[j].x - (sortedItems[j - 1].x + sortedItems[j - 1].width);
        if (gap > columnGapThreshold) flushGroup();
        groupItems.push(sortedItems[j]);
      }
      flushGroup();

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

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 3: OCR / IMAGE HANDLING ═══════════════════════════
// ---------------------------------------------------------------------------

function isBrowserHeaderFooter(text: string): boolean {
  const t = text.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]/.test(t)) return true;
  if (/^https?:\/\//.test(t)) return true;
  if (/^\d+\/\d+$/.test(t)) return true;
  if (/^page\s+\d+\s+of\s+\d+$/i.test(t)) return true;
  return false;
}

function isPageNumberLine(line: TextLine, pageWidth: number): boolean {
  if (line.items.length > 2) return false;
  const text = line.items.map((i) => i.str).join('').trim();
  return /^\d{1,4}$/.test(text) && line.minX > pageWidth * 0.4;
}

async function hasTextContent(page: unknown): Promise<boolean> {
  const p = page as { getTextContent: () => Promise<{ items: unknown[] }> };
  const textContent = await p.getTextContent();
  const meaningfulItems = (textContent.items as Array<{ str?: string }>).filter(
    (item) => item.str && item.str.trim().length > 0
  );
  if (meaningfulItems.length < 10) return false;
  const rawItems = meaningfulItems.map(parseRawItem).filter((i): i is RawTextItem => i !== null);
  const lines = groupIntoLines(rawItems);
  return lines.length >= 5;
}

async function renderPageToCanvas(page: unknown, scaleFactor: number): Promise<HTMLCanvasElement> {
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
  blockSize = 25,
  k = 0.15
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

async function preprocessCanvasForOcr(canvas: HTMLCanvasElement, scaleFactor: number): Promise<Blob> {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const pixelCount = w * h;

  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

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
          if (isBrowserHeaderFooter(lineText)) continue;

          paraLines.push(lineText);
          wordCount += line.words.length;
          lineCount++;

          if (line.bbox) {
            y0 = Math.min(y0, line.bbox.y0);
            y1 = Math.max(y1, line.bbox.y1);
            const lh = line.bbox.y1 - line.bbox.y0;
            if (lh > 0) lineHeightsPx.push(lh);
          }
        }

        const rawText = paraLines.join(' ');
        const text = rawText
          .replace(/\s*https?:\/\/\S+/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (!text) continue;

        const avgLineHeightPx =
          lineHeightsPx.length > 0
            ? lineHeightsPx.reduce((a, b) => a + b, 0) / lineHeightsPx.length
            : 0;
        const rawFontSizePt = avgLineHeightPx > 0 ? avgLineHeightPx / OCR_SCALE / 1.2 : 11;

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

function consolidateOcrParagraphs(paragraphs: OcrParagraph[]): OcrParagraph[] {
  if (paragraphs.length === 0) return paragraphs;

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

  const pass2: OcrParagraph[] = [];
  for (const para of pass1) {
    const t = para.text.trim();
    const startsLowercase = /^[a-z]/.test(t);

    if (startsLowercase && pass2.length > 0) {
      const prev = pass2[pass2.length - 1];
      const approxLineHeightPx = prev.estimatedFontSizePt * OCR_SCALE * 1.5;
      const yGap = para.y0Px - prev.y1Px;
      if (yGap < approxLineHeightPx) {
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

  const bodyParas = pass2.filter((p) => p.text.length >= 20);
  if (bodyParas.length > 0) {
    const freq = new Map<number, number>();
    for (const p of bodyParas) {
      freq.set(p.estimatedFontSizePt, (freq.get(p.estimatedFontSizePt) ?? 0) + 1);
    }
    const modeFontSize = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return pass2.map((p) => ({
      ...p,
      estimatedFontSizePt:
        Math.abs(p.estimatedFontSizePt - modeFontSize) <= 3 ? modeFontSize : p.estimatedFontSizePt,
    }));
  }

  return pass2;
}

// Render page to base64 PNG for embedding in PPT
async function renderPageToBase64(page: unknown, scaleFactor: number): Promise<string> {
  const canvas = await renderPageToCanvas(page, scaleFactor);
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Canvas export failed'));
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 4: PPT OUTPUT GENERATION ══════════════════════════
// ---------------------------------------------------------------------------
//
// Coordinate system conversion:
//   PDF: origin at bottom-left, y increases upward, units = points
//   PPT: origin at top-left, y increases downward, units = inches
//
//   x_ppt = x_pdf * PT_TO_IN
//   y_ppt = (pageHeight - y_baseline - fontSize * 0.85) * PT_TO_IN
//       where 0.85 ≈ typical ascent ratio for text glyphs
// ---------------------------------------------------------------------------

// Convert a TextLine's PDF coordinates to absolute PPT text box bounds (inches)
function lineToPptBounds(
  line: TextLine,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; w: number; h: number } {
  const fontSize = line.avgFontSize;

  // Text box top: baseline from bottom → top from top, minus ascent
  const yTopPt = pageHeight - line.y - fontSize * 0.85;
  const x = Math.max(0, line.minX * PT_TO_IN);
  const y = Math.max(0, yTopPt * PT_TO_IN);

  // Width: span from minX to maxX with a small right-side padding
  const wPt = Math.max(line.maxX - line.minX, fontSize * 2);
  const w = Math.min(wPt * PT_TO_IN + 0.15, pageWidth * PT_TO_IN - x);

  // Height: line height ≈ 1.4× font size
  const h = Math.max(fontSize * 1.4 * PT_TO_IN, 0.08);

  return { x, y, w, h };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addLineToSlide(slide: any, line: TextLine, pageWidth: number, pageHeight: number): void {
  const runs = consolidateLineRuns(line);
  if (runs.every((r) => !r.text.trim())) return;

  const { x, y, w, h } = lineToPptBounds(line, pageWidth, pageHeight);

  // PptxGenJS text run format: array of { text, options } objects
  const textRuns = runs
    .filter((r) => r.text.length > 0)
    .map((run) => ({
      text: run.text,
      options: {
        bold: run.isBold,
        italic: run.isItalic,
        // PptxGenJS fontSize is in points (not half-points like docx)
        fontSize: Math.max(6, Math.round(run.fontSize)),
        fontFace: extractFontFamily(run.fontName),
        color: '363636',
      },
    }));

  if (textRuns.length === 0) return;

  slide.addText(textRuns, {
    x, y, w, h,
    fit: 'none',
    wrap: false,
    margin: 0,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTableToSlide(slide: any, table: TableBlock, pageWidth: number, pageHeight: number): void {
  if (table.rows.length === 0) return;

  const numCols = Math.max(...table.rows.map((r) => r.cells.length));
  if (numCols === 0) return;

  // Table top-left position: top of first row, safe left margin
  const tableYTopPt = pageHeight - table.yMax;
  const tableX = 0.1;
  const tableY = Math.max(0, tableYTopPt * PT_TO_IN);
  const tableW = pageWidth * PT_TO_IN - tableX * 2;

  // Build PptxGenJS table rows: TableRow = TableCell[]
  const pptRows = table.rows.map((gridRow) => {
    return Array.from({ length: numCols }, (_, colIdx) => {
      const cellRuns = gridRow.cells[colIdx] || [];
      const cellText = cellRuns.map((r) => r.text).join('').trim() || ' ';
      return {
        text: cellText,
        options: {
          fontSize: 11,
          fontFace: DEFAULT_FONT,
          color: '363636',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          margin: [2, 4, 2, 4] as any,
        },
      };
    });
  });

  slide.addTable(pptRows, {
    x: tableX,
    y: tableY,
    w: tableW,
    border: { type: 'solid' as const, pt: 0.5, color: 'AAAAAA' },
    fontSize: 11,
    fontFace: DEFAULT_FONT,
    color: '363636',
  });
}

// Process a text-based PDF page: add text boxes and tables to slide
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTextPageToSlide(
  slide: any,
  lines: TextLine[],
  pageWidth: number,
  pageHeight: number
): void {
  if (lines.length === 0) return;

  const tables = detectTables(lines);
  const tableLineIndices = new Set<number>();
  for (const table of tables) {
    for (const idx of table.lineIndices) tableLineIndices.add(idx);
  }

  // Add non-table lines as absolute text boxes
  for (let i = 0; i < lines.length; i++) {
    if (tableLineIndices.has(i)) continue;
    addLineToSlide(slide, lines[i], pageWidth, pageHeight);
  }

  // Add tables
  for (const table of tables) {
    addTableToSlide(slide, table, pageWidth, pageHeight);
  }
}

// Process a scanned page: OCR → text boxes, or full-page image embed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addScannedPageToSlide(
  slide: any,
  page: unknown,
  onProgress: (u: ProcessingUpdate) => void,
  progressBase: number,
  pageNum: number,
  pageWidth: number,
  pageHeight: number
): Promise<void> {
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

  if (ocrResult.confidence >= 60 && ocrResult.wordCount >= 10) {
    onProgress({
      progress: progressBase + 10,
      status: `Page ${pageNum}: OCR ${ocrResult.confidence.toFixed(0)}% — converting to text...`,
    });

    // OCR paragraphs have pixel bounding boxes (canvas y = 0 is top of page)
    // Convert: 1 canvas pixel = 1/(OCR_SCALE) PDF points = PT_TO_IN/OCR_SCALE inches
    const pxToIn = PT_TO_IN / OCR_SCALE;

    for (const para of ocrResult.paragraphs) {
      const y_in = Math.max(0, para.y0Px * pxToIn);
      const h_raw = (para.y1Px - para.y0Px) * pxToIn;
      const fontSize = para.estimatedFontSizePt;
      const h_in = Math.max(h_raw, fontSize * PT_TO_IN * 1.4, 0.08);

      slide.addText(para.text, {
        x: 0.1,
        y: y_in,
        w: pageWidth * PT_TO_IN - 0.2,
        h: h_in,
        fontSize: Math.max(6, fontSize),
        fontFace: DEFAULT_FONT,
        color: '363636',
        fit: 'none',
        wrap: true,
        margin: 0,
      });
    }
  } else {
    // Low OCR confidence → embed full page as image
    onProgress({
      progress: progressBase + 10,
      status: `Page ${pageNum}: Low OCR confidence (${ocrResult.confidence.toFixed(0)}%) — embedding as image...`,
    });

    const dataUrl = await renderPageToBase64(page, 2);
    slide.addImage({
      data: dataUrl,
      x: 0,
      y: 0,
      w: pageWidth * PT_TO_IN,
      h: pageHeight * PT_TO_IN,
    });
  }
}

// ---------------------------------------------------------------------------
// ════════════════════ MAIN ENTRY POINT ══════════════════════════════════════
// ---------------------------------------------------------------------------

export async function convertPdfToPpt(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<PdfToPptResult> {
  onProgress({ progress: 5, status: 'Loading PDF...' });

  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  onProgress({
    progress: 10,
    status: `Found ${totalPages} page(s). Setting up presentation...`,
  });

  // Read first page dimensions to set slide layout
  const firstPage = await pdf.getPage(1);
  const firstViewport = (
    firstPage as unknown as {
      getViewport: (o: { scale: number }) => { width: number; height: number };
    }
  ).getViewport({ scale: 1.0 });
  const slideWidthIn = firstViewport.width * PT_TO_IN;
  const slideHeightIn = firstViewport.height * PT_TO_IN;

  // PptxGenJS — dynamic import to avoid SSR issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxGenJSMod = await import('pptxgenjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const PptxGenJS = (PptxGenJSMod as any).default ?? PptxGenJSMod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pptx: any = new PptxGenJS();

  // Define layout matching PDF page dimensions
  pptx.defineLayout({ name: 'PDF_LAYOUT', width: slideWidthIn, height: slideHeightIn });
  pptx.layout = 'PDF_LAYOUT';

  const progressPerPage = 75 / totalPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const progressBase = 10 + Math.round((pageNum - 1) * progressPerPage);

    onProgress({
      progress: progressBase,
      status: `Processing page ${pageNum} of ${totalPages}...`,
    });

    const page = await pdf.getPage(pageNum);
    const viewport = (
      page as unknown as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
      }
    ).getViewport({ scale: 1.0 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;

    const slide = pptx.addSlide();
    const isText = await hasTextContent(page);

    if (isText) {
      const textContent = await (
        page as unknown as {
          getTextContent: () => Promise<{ items: unknown[] }>;
        }
      ).getTextContent();

      const rawItems = (textContent.items as unknown[])
        .map(parseRawItem)
        .filter((i): i is RawTextItem => i !== null);

      if (rawItems.length > 0) {
        const lines = groupIntoLines(rawItems);
        const filteredLines = lines.filter((l) => {
          const text = l.items.map((i) => i.str).join('');
          return !isBrowserHeaderFooter(text) && !isPageNumberLine(l, pageWidth);
        });
        addTextPageToSlide(slide, filteredLines, pageWidth, pageHeight);
      }
    } else {
      await addScannedPageToSlide(
        slide,
        page,
        onProgress,
        progressBase,
        pageNum,
        pageWidth,
        pageHeight
      );
    }
  }

  onProgress({ progress: 88, status: 'Generating PowerPoint file...' });

  // Generate PPTX as ArrayBuffer, then wrap in Blob
  const output = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });

  onProgress({ progress: 100, status: 'Done!' });

  return {
    blob,
    pageCount: totalPages,
    originalSize: file.size,
    processedSize: blob.size,
  };
}
