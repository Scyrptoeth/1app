// ============================================================================
// PDF to PowerPoint Converter — Hybrid Adaptive Approach (v2)
//
// Strategy: background image layer + text box overlay (matches ilovepdf approach)
//   - Pages with embedded images → render page as JPEG background +
//     overlay editable text boxes (text is available AND visually faithful)
//   - Pure text pages → absolute text boxes only (clean, editable)
//   - Truly scanned pages (0 text items) → OCR fallback or image embed
//
// Improvements over v1:
//   - Color extraction via getOperatorList() (tracks fill color state per line y)
//   - Font family via TextContent.styles.fontFamily
//   - Image detection via paintImageXObject OPS (code 85)
//   - Background JPEG rendering for image-heavy pages (smaller file size)
//   - hasTextContent threshold lowered to 2 items (handles sparse presentation slides)
//   - Table detection requires ≥3 rows (reduce false positives)
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
  fontFamily: string;   // resolved CSS family from TextContent.styles
  isBold: boolean;
  isItalic: boolean;
  width: number;
  color: string;        // hex without '#', e.g. '363636'
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
  fontFamily: string;
  color: string;
}

// A paragraph block groups adjacent lines that belong to the same visual paragraph.
// Adjacent lines are merged when they share similar fontSize, x-position, and have
// a normal line spacing gap (< 1.5× line height). Each block becomes one text box.
interface ParagraphBlock {
  lines: TextLine[];
  refX: number;   // minX of first line — reference for x-alignment checks
  minX: number;   // min of all lines' minX (for text box left edge)
  maxX: number;   // max of all lines' maxX (for text box width)
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

// Result from a single operator-list analysis pass
interface PageAnalysis {
  hasImages: boolean;
  // Map: rounded y-position (PDF coords) → dominant fill color hex
  colorMap: Map<string, string>;
}

const OCR_SCALE = 3;
const DEFAULT_FONT = 'Arial';
const DEFAULT_COLOR = '363636';
// 1 PDF point = 1/72 inches
const PT_TO_IN = 1 / 72;

// pdfjs OPS codes (verified from pdfjs-dist v4)
const OPS_SET_FILL_RGB    = 59;  // setFillRGBColor: args=[r,g,b] in [0,1]
const OPS_SET_FILL_GRAY   = 57;  // setFillGray: args=[gray] in [0,1]
const OPS_SET_FILL_CMYK   = 61;  // setFillCMYKColor: args=[c,m,y,k] in [0,1]
const OPS_SET_TEXT_MATRIX = 42;  // setTextMatrix: args=[a,b,c,d,e,f]
const OPS_MOVE_TEXT       = 40;  // moveText: args=[tx,ty] relative movement
const OPS_MOVE_TEXT_LEAD  = 41;  // setLeadingMoveText: args=[tx,ty]
const OPS_BEGIN_TEXT      = 31;  // beginText: resets text matrix
const OPS_SHOW_TEXT       = 44;  // showText
const OPS_SHOW_SPACED     = 45;  // showSpacedText
const OPS_NEXT_LINE_SHOW  = 46;  // nextLineShowText
const OPS_NEXT_LINE_SET   = 47;  // nextLineSetSpacingShowText
const OPS_END_TEXT        = 32;  // endText: closes text block (ET)
const OPS_PAINT_IMAGE     = 85;  // paintImageXObject
const OPS_PAINT_INLINE    = 86;  // paintInlineImageXObject
const OPS_PAINT_IMG_RPT   = 88;  // paintImageXObjectRepeat

// ---------------------------------------------------------------------------
// ═══════════════════ COLOR & IMAGE ANALYSIS (OperatorList) ══════════════════
// ---------------------------------------------------------------------------

function toHex2(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
  // args from pdfjs are normalized [0,1]
  return `${toHex2(r * 255)}${toHex2(g * 255)}${toHex2(b * 255)}`;
}

function grayToHex(g: number): string {
  const h = toHex2(g * 255);
  return `${h}${h}${h}`;
}

function cmykToHex(c: number, m: number, y: number, k: number): string {
  const r = (1 - c) * (1 - k);
  const g = (1 - m) * (1 - k);
  const b = (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

// Analyze page operator list to extract:
//   1. Whether the page contains any embedded images
//   2. A map of PDF y-positions → dominant fill color (for text color assignment)
//
// Color tracking: we maintain a mini text-matrix state machine to know the y
// position when each showText operation fires. Each y position maps to the last
// fill color set before that y position's text was painted.
async function analyzePageOperators(page: unknown): Promise<PageAnalysis> {
  const p = page as {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  };

  const opList = await p.getOperatorList();
  const { fnArray, argsArray } = opList;

  let hasImages = false;
  let currentColor = DEFAULT_COLOR;
  const colorMap = new Map<string, string>();

  // Text matrix state (tracks current text position for color mapping)
  let tmX = 0, tmY = 0;
  let tlmX = 0, tlmY = 0; // text line matrix

  // Only record colors when inside a BT/ET text block.
  // Background shapes (drawn outside BT) use the same fill operators but must
  // not pollute the text color map — otherwise white background fills overwrite
  // the actual text color at those y positions.
  let inTextBlock = false;

  const IMAGE_OPS = new Set([OPS_PAINT_IMAGE, OPS_PAINT_INLINE, OPS_PAINT_IMG_RPT]);
  const SHOW_OPS = new Set([OPS_SHOW_TEXT, OPS_SHOW_SPACED, OPS_NEXT_LINE_SHOW, OPS_NEXT_LINE_SET]);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as number[];

    if (IMAGE_OPS.has(fn)) {
      hasImages = true;
      continue;
    }

    switch (fn) {
      case OPS_SET_FILL_RGB:
        currentColor = rgbToHex(args[0], args[1], args[2]);
        break;
      case OPS_SET_FILL_GRAY:
        currentColor = grayToHex(args[0]);
        break;
      case OPS_SET_FILL_CMYK:
        currentColor = cmykToHex(args[0], args[1], args[2], args[3]);
        break;
      case OPS_BEGIN_TEXT:
        inTextBlock = true;
        tmX = 0; tmY = 0; tlmX = 0; tlmY = 0;
        break;
      case OPS_END_TEXT:
        inTextBlock = false;
        break;
      case OPS_SET_TEXT_MATRIX:
        // [a, b, c, d, e, f] — e=x, f=y (translation components)
        tmX = args[4]; tmY = args[5];
        tlmX = args[4]; tlmY = args[5];
        break;
      case OPS_MOVE_TEXT:
      case OPS_MOVE_TEXT_LEAD:
        // Relative move: adds to text line matrix
        tlmX += args[0]; tlmY += args[1];
        tmX = tlmX; tmY = tlmY;
        break;
    }

    if (SHOW_OPS.has(fn) && inTextBlock) {
      // Map this y position to the current fill color.
      // Use rounded integer key for fuzzy matching (+/-5pt tolerance applied at lookup).
      const yKey = Math.round(tmY).toString();
      colorMap.set(yKey, currentColor);
    }
  }

  return { hasImages, colorMap };
}

// Look up color for a text item's y-position with ±5pt tolerance
function lookupColor(y: number, colorMap: Map<string, string>): string {
  const yRound = Math.round(y);
  for (let delta = 0; delta <= 5; delta++) {
    const c = colorMap.get((yRound + delta).toString())
           ?? colorMap.get((yRound - delta).toString());
    if (c) return c;
  }
  return DEFAULT_COLOR;
}

// ---------------------------------------------------------------------------
// ═══════════════════ FONT FAMILY RESOLUTION ══════════════════════════════════
// ---------------------------------------------------------------------------

// Build fontName → resolved CSS family map from TextContent.styles
function buildFontFamilyMap(styles: Record<string, { fontFamily: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [fontName, style] of Object.entries(styles)) {
    map.set(fontName, style.fontFamily || '');
  }
  return map;
}

// Resolve the best-available font family for a text item.
// Priority: (1) pdfjs-resolved fontFamily if it looks like a real name
//           (2) extractFontFamily heuristic from the raw PDF fontName string
function resolveFontFamily(fontName: string, fontFamilyMap: Map<string, string>): string {
  const cssFontFamily = fontFamilyMap.get(fontName) ?? '';
  // Accept if it looks like a proper font name (not generic CSS keyword)
  if (
    cssFontFamily &&
    !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|Arial|Helvetica)$/i.test(cssFontFamily.trim())
  ) {
    // Strip anything after a comma (CSS fallback chain), take first font only
    return cssFontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
  }
  return extractFontFamily(fontName);
}

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 1: TEXT EXTRACTION ════════════════════════════════
// ---------------------------------------------------------------------------

function parseRawItem(
  item: unknown,
  colorMap: Map<string, string>,
  fontFamilyMap: Map<string, string>
): RawTextItem | null {
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
    fontFamily: resolveFontFamily(fontName, fontFamilyMap),
    isBold: /bold|heavy|black|demi/i.test(normalizedFont),
    isItalic: /italic|oblique|slant/i.test(normalizedFont),
    width: i.width || 0,
    color: lookupColor(y, colorMap),
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

// Merge adjacent items into consolidated runs.
// A new run starts when bold/italic/fontSize/fontFamily/color changes.
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
      last.fontFamily === item.fontFamily &&
      last.color === item.color
    ) {
      last.text += text;
    } else {
      runs.push({
        text,
        isBold: item.isBold,
        isItalic: item.isItalic,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        color: item.color,
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
  if (/ebrima/i.test(clean)) return 'Ebrima';
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
// ═══════════════════ TASK 2: PARAGRAPH CONSOLIDATION ════════════════════════
// ---------------------------------------------------------------------------
// Group adjacent lines into paragraph blocks so that multiple lines of the
// same paragraph become one text box instead of N separate boxes.
//
// Merge conditions (all must hold):
//   • fontSize within ±2pt of the block's reference (first) line
//   • minX within ±0.3in (±21.6pt) of the block's reference line
//   • baseline y-gap < 1.5× expected line height (fontSize × 1.2)
//   • gap must be positive (i.e., lines must be below each other, not above)
//
// Lines coming from groupIntoLines() are already in top-to-bottom order
// (descending PDF y-coordinate), so we process them in sequence.

function groupLinesIntoParagraphs(lines: TextLine[]): ParagraphBlock[] {
  if (lines.length === 0) return [];

  const blocks: ParagraphBlock[] = [];

  for (const line of lines) {
    if (blocks.length === 0) {
      blocks.push({ lines: [line], refX: line.minX, minX: line.minX, maxX: line.maxX });
      continue;
    }

    const block = blocks[blocks.length - 1];
    const refLine = block.lines[0];
    const lastLine = block.lines[block.lines.length - 1];

    const refFontSize = refLine.avgFontSize;
    const fontSizeMatch = Math.abs(line.avgFontSize - refFontSize) <= 2;
    const xAligned = Math.abs(line.minX - block.refX) <= 21.6; // ±0.3in in pt

    // Baseline gap (lastLine.y > line.y in PDF coords: last is above current)
    const yGap = lastLine.y - line.y;
    const expectedLineHeight = refFontSize * 1.2;
    const yGapOk = yGap > 0 && yGap <= expectedLineHeight * 1.5;

    if (fontSizeMatch && xAligned && yGapOk) {
      block.lines.push(line);
      block.minX = Math.min(block.minX, line.minX);
      block.maxX = Math.max(block.maxX, line.maxX);
    } else {
      blocks.push({ lines: [line], refX: line.minX, minX: line.minX, maxX: line.maxX });
    }
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

// Render page as JPEG base64 data URL (smaller file size than PNG for photos/backgrounds)
async function renderPageToJpegDataUrl(page: unknown, scaleFactor: number): Promise<string> {
  const canvas = await renderPageToCanvas(page, scaleFactor);
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas JPEG export failed'));
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      0.82  // 82% quality: good fidelity with significant size savings vs PNG
    );
  });
}

// Render page as PNG base64 data URL (for scanned pages where lossless matters)
async function renderPageToPngDataUrl(page: unknown, scaleFactor: number): Promise<string> {
  const canvas = await renderPageToCanvas(page, scaleFactor);
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Canvas PNG export failed'));
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      },
      'image/png'
    );
  });
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
        const text = rawText.replace(/\s*https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();
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

// ---------------------------------------------------------------------------
// ═══════════════════ TASK 4: PPT OUTPUT GENERATION ══════════════════════════
// ---------------------------------------------------------------------------
//
// Coordinate system:
//   PDF: origin at bottom-left, y increases upward, units = points
//   PPT: origin at top-left, y increases downward, units = inches
//
//   x_ppt = x_pdf * PT_TO_IN
//   y_ppt = (pageHeight - baseline - ascent) * PT_TO_IN
//         ≈ (pageHeight - y - fontSize * 0.85) * PT_TO_IN
// ---------------------------------------------------------------------------

// Render a ParagraphBlock as a single text box.
// Multi-line blocks use breakLine:true between lines so all lines share one box.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addParagraphBlockToSlide(
  slide: any,
  block: ParagraphBlock,
  pageWidth: number,
  pageHeight: number
): void {
  const firstLine = block.lines[0];
  const lastLine = block.lines[block.lines.length - 1];
  const firstFontSize = firstLine.avgFontSize;
  const lastFontSize = lastLine.avgFontSize;

  // Convert PDF coordinates (bottom-left origin) → PPT inches (top-left origin)
  const yTopPt = pageHeight - firstLine.y - firstFontSize * 0.85;
  const yBotPt = pageHeight - lastLine.y + lastFontSize * 0.15;

  const x = Math.max(0, block.minX * PT_TO_IN);
  const y = Math.max(0, yTopPt * PT_TO_IN);
  const wPt = Math.max(block.maxX - block.minX, firstFontSize * 2);
  const w = Math.min(wPt * PT_TO_IN + 0.15, pageWidth * PT_TO_IN - x);
  const hRaw = (yBotPt - yTopPt) * PT_TO_IN;
  const h = Math.max(hRaw, firstFontSize * 1.4 * PT_TO_IN, 0.08);

  // Build text run array — paragraph breaks between lines via breakLine:true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textRuns: Array<{ text: string; options: Record<string, any> }> = [];

  for (let lineIdx = 0; lineIdx < block.lines.length; lineIdx++) {
    const line = block.lines[lineIdx];
    const runs = consolidateLineRuns(line);
    if (runs.every((r) => !r.text.trim())) continue;

    const isLastLine = lineIdx === block.lines.length - 1;

    for (let runIdx = 0; runIdx < runs.length; runIdx++) {
      const run = runs[runIdx];
      if (!run.text) continue;
      const isLastRun = runIdx === runs.length - 1;

      textRuns.push({
        text: run.text,
        options: {
          bold: run.isBold,
          italic: run.isItalic,
          fontSize: Math.max(6, Math.round(run.fontSize)),
          fontFace: run.fontFamily || DEFAULT_FONT,
          color: run.color || DEFAULT_COLOR,
          // Add a paragraph break after the last run of each line (except the last line)
          breakLine: isLastRun && !isLastLine,
        },
      });
    }
  }

  if (textRuns.length === 0) return;

  slide.addText(textRuns, {
    x, y, w, h,
    fit: 'none',
    wrap: true,
    margin: 0,
  });
}

// Add all text boxes for a text-based page.
// Lines are consolidated into paragraph blocks before rendering to reduce
// the number of text boxes and improve readability of the output.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTextPageToSlide(
  slide: any,
  lines: TextLine[],
  pageWidth: number,
  pageHeight: number
): void {
  if (lines.length === 0) return;

  const blocks = groupLinesIntoParagraphs(lines);
  for (const block of blocks) {
    addParagraphBlockToSlide(slide, block, pageWidth, pageHeight);
  }
}

// Fallback for truly scanned pages (no text items at all and no background images)
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

    // Convert canvas pixel bounding boxes to PPT inches
    // 1 px = 1/OCR_SCALE PDF points = PT_TO_IN/OCR_SCALE inches
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
        color: DEFAULT_COLOR,
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

    const dataUrl = await renderPageToPngDataUrl(page, 2);
    slide.addImage({
      data: dataUrl,
      x: 0, y: 0,
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

  // Read first page dimensions to define slide layout
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

    // Parallelize operator list analysis + text extraction for speed
    const [pageAnalysis, textContent] = await Promise.all([
      analyzePageOperators(page),
      (page as unknown as {
        getTextContent: () => Promise<{ items: unknown[]; styles: Record<string, { fontFamily: string }> }>;
      }).getTextContent(),
    ]);

    const slide = pptx.addSlide();

    const fontFamilyMap = buildFontFamilyMap(textContent.styles);

    // Parse text items with color + font resolution
    const rawItems = (textContent.items as unknown[])
      .map((item) => parseRawItem(item, pageAnalysis.colorMap, fontFamilyMap))
      .filter((i): i is RawTextItem => i !== null);

    const meaningfulItemCount = rawItems.length;

    // ── Step 1: Background image ────────────────────────────────────────────
    // Render full page as JPEG background when embedded images are present.
    // This preserves visual fidelity of shapes, gradients, decorative elements
    // that cannot be reconstructed from text extraction alone.
    if (pageAnalysis.hasImages) {
      onProgress({
        progress: progressBase,
        status: `Page ${pageNum}: Rendering background image...`,
      });
      const bgDataUrl = await renderPageToJpegDataUrl(page, 1.5);
      slide.addImage({
        data: bgDataUrl,
        x: 0, y: 0,
        w: pageWidth * PT_TO_IN,
        h: pageHeight * PT_TO_IN,
      });
    }

    // ── Step 2: Text boxes ──────────────────────────────────────────────────
    // Extract text whenever ANY text items exist (threshold = 2 to avoid
    // false triggers on stray punctuation, but low enough to catch sparse
    // presentation slides that have 3-8 text elements per page).
    if (meaningfulItemCount >= 2) {
      const lines = groupIntoLines(rawItems);
      const filteredLines = lines.filter((l) => {
        const text = l.items.map((i) => i.str).join('');
        return !isBrowserHeaderFooter(text) && !isPageNumberLine(l, pageWidth);
      });
      addTextPageToSlide(slide, filteredLines, pageWidth, pageHeight);
    } else if (!pageAnalysis.hasImages) {
      // Truly unreadable page (no text, no images) → OCR fallback
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
    // Note: if hasImages=true but meaningfulItemCount < 2, we still have the
    // background image — the slide looks correct even without text boxes.
  }

  onProgress({ progress: 88, status: 'Generating PowerPoint file...' });

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
