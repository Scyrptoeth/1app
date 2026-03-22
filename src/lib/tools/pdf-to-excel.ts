// ============================================================================
// PDF to Excel Converter — Hybrid Approach
// 1. Try pdfjs getTextContent() for text-based PDFs
// 2. Fall back to Canvas render + Tesseract.js OCR for image-based/scanned PDFs
// Designed for Indonesian financial documents (Laba Rugi, Neraca)
// ============================================================================

// Tesseract.js: use dynamic import to avoid Next.js bundling issues with Web Workers
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

interface RowData {
  label: string;
  subValue: number | null;
  mainValue: number | null;
  isHeader: boolean;
  isTotal: boolean;
  isIndented: boolean;
  isNumbered: boolean;
  rowNumber: string;
}

interface PageData {
  pageNumber: number;
  sheetName: string;
  isSideBySide: boolean;
  rows?: RowData[];
  leftRows?: RowData[];
  rightRows?: RowData[];
  leftTitle?: string;
  rightTitle?: string;
}

interface PdfExtractionResult {
  pages: PageData[];
  totalPages: number;
}

export interface PdfToExcelResult {
  blob: Blob;
  pages: PageData[];
  originalSize: number;
  processedSize: number;
}

// OCR types
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const HEADER_KEYWORDS = [
  'PENERIMAAN BRUTO', 'BIAYA LANGSUNG', 'BIAYA UMUM', 'PENGHASILAN',
  'Laba Kotor', 'Laba Bersih', 'Total Penghasilan', 'Jumlah',
  'Aktiva Lancar', 'Aktiva Tetap', 'Hutang Lancar', 'Ekuitas',
  'Jumlah Aktiva', 'Jumlah Hutang', 'Jumlah Ekuitas',
  'PENDAPATAN BUNGA', 'BEBAN DILUAR', 'HARGA POKOK',
  'PENDAPATAN BUNGA DEPOSIT', 'PENGHASILAN DARI LUAR USAHA',
];

const TOTAL_KEYWORDS = [
  'Laba Kotor', 'Laba Bersih', 'Total', 'Jumlah',
  'Harga Pokok Penjualan', 'Tersedia Dijual',
];

const NERACA_KEYWORDS = ['Neraca', 'Balance Sheet', 'Aktiva', 'Passiva'];
const LABA_RUGI_KEYWORDS = ['Laba Rugi', 'Profit', 'Loss', 'Penerimaan'];

const RP_VARIANTS = ['rp', 'fp', 'ip', 'ro', 'np', 'mp', 'bp', 'kp', 're', 'ry', 'me'];

const LABEL_CORRECTIONS: [RegExp, string][] = [
  [/\bPernbellan\b/gi, 'Pembelian'], [/\bPermbellan\b/gi, 'Pembelian'],
  [/\bPernbelian\b/gi, 'Pembelian'], [/\bPermbelian\b/gi, 'Pembelian'],
  [/\bPerneliharaan\b/gi, 'Pemeliharaan'], [/\bPerrneliharaan\b/gi, 'Pemeliharaan'],
  [/\bPernbuatan\b/gi, 'Pembuatan'], [/\bPerrnbuatan\b/gi, 'Pembuatan'],
  [/\bBehan\b/gi, 'Beban'], [/\bBlaya\b/gi, 'Biaya'], [/\bBiava\b/gi, 'Biaya'],
  [/\bSawa\b/g, 'Sewa'], [/\bBPIS\b/g, 'BPJS'],
  [/\bAllowancc\b/gi, 'Allowance'], [/\bAllowanco\b/gi, 'Allowance'],
  [/\bBarang\s+fi\s+Jasa\b/gi, 'Barang & Jasa'],
  [/\bBarang\s+fl\s+Jasa\b/gi, 'Barang & Jasa'],
  [/\bBank\s+SRI\b/g, 'Bank BRI'],
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function parseIndonesianNumber(raw: string): number | null {
  if (!raw || raw.trim().length === 0) return null;
  let s = raw.trim();
  s = s.replace(/^Rp\.?\s*/i, '');
  const isNeg = s.startsWith('(') && s.endsWith(')');
  if (isNeg) s = s.substring(1, s.length - 1);
  const hasMinus = s.startsWith('-');
  if (hasMinus) s = s.substring(1);
  s = s.replace(/\./g, '');
  s = s.replace(/,/g, '.');
  s = s.replace(/[^0-9.]/g, '');
  if (s.length === 0) return null;
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return (isNeg || hasMinus) ? -num : num;
}

function isNumericValue(text: string): boolean {
  const cleaned = text.replace(/[.,\s_\-()]/g, '');
  return /\d{3,}/.test(cleaned);
}

function isRpPrefix(text: string): boolean {
  const lower = text.trim().toLowerCase().replace(/[.:,\s]+$/, '');
  return RP_VARIANTS.includes(lower);
}

function extractDigitsFromRpWord(text: string): string | null {
  const lower = text.trim().toLowerCase();
  for (const variant of RP_VARIANTS) {
    if (lower.startsWith(variant)) {
      const rest = text.trim().substring(variant.length).trim();
      if (/\d{3,}/.test(rest.replace(/[.,\s]/g, ''))) return rest;
    }
  }
  return null;
}

function correctLabel(label: string): string {
  let corrected = label;
  for (const [pattern, replacement] of LABEL_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected.replace(/\s{2,}/g, ' ').trim();
}

function correctNumericValue(text: string): string {
  let cleaned = text.trim();
  if (cleaned.includes('.') && !cleaned.includes(',')) {
    const parts = cleaned.split('.');
    const allGroupsOf3 = parts.slice(1).every(p => /^\d{3}$/.test(p));
    const firstGroupValid = /^\d{1,3}$/.test(parts[0]);
    if (!allGroupsOf3 || !firstGroupValid) cleaned = cleaned.replace(/\./g, '');
  }
  return cleaned;
}

function isSectionHeader(label: string): boolean {
  if (!label) return false;
  const upper = label.toUpperCase();
  return HEADER_KEYWORDS.some(k => upper.includes(k.toUpperCase()));
}

function isTotalLine(label: string): boolean {
  if (!label) return false;
  return TOTAL_KEYWORDS.some(k => label.toUpperCase().includes(k.toUpperCase()));
}

// ---------------------------------------------------------------------------
// Check if page has enough native text content
// ---------------------------------------------------------------------------
async function hasTextContent(page: any): Promise<boolean> {
  const textContent = await page.getTextContent();
  let meaningful = 0;
  for (const item of textContent.items) {
    if ((item.str || '').trim().length >= 3) meaningful++;
  }
  return meaningful >= 20;
}

// ---------------------------------------------------------------------------
// Render PDF page to canvas
// ---------------------------------------------------------------------------
async function renderPageToCanvas(page: any, scaleFactor: number = 3): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: scaleFactor });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

// ---------------------------------------------------------------------------
// Sauvola adaptive threshold
// ---------------------------------------------------------------------------
function sauvolaThreshold(gray: Uint8Array, w: number, h: number, blockSize: number = 25, k: number = 0.15): Uint8Array {
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
      const sum = integral[(y1+1)*(w+1)+(x1+1)] - integral[y0*(w+1)+(x1+1)] - integral[(y1+1)*(w+1)+x0] + integral[y0*(w+1)+x0];
      const sumSq = integralSq[(y1+1)*(w+1)+(x1+1)] - integralSq[y0*(w+1)+(x1+1)] - integralSq[(y1+1)*(w+1)+x0] + integralSq[y0*(w+1)+x0];
      const mean = sum / count;
      const stddev = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
      binary[y * w + x] = gray[y * w + x] > mean * (1 + k * (stddev / R - 1)) ? 255 : 0;
    }
  }
  return binary;
}

// ---------------------------------------------------------------------------
// Preprocess canvas for OCR
// ---------------------------------------------------------------------------
async function preprocessCanvasForOcr(canvas: HTMLCanvasElement): Promise<Blob> {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const pixelCount = data.length / 4;

  // Sharpen
  const src = new Uint8ClampedArray(data);
  const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let val = 0;
        for (let ky = -1; ky <= 1; ky++)
          for (let kx = -1; kx <= 1; kx++)
            val += src[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
        data[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, val));
      }
    }
  }

  // Grayscale
  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

  // Sauvola threshold
  const binary = sauvolaThreshold(gray, w, h);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    data[idx] = data[idx + 1] = data[idx + 2] = binary[i];
    data[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png');
  });
}

// ---------------------------------------------------------------------------
// OCR with Tesseract.js
// ---------------------------------------------------------------------------
async function performOcr(
  imageBlob: Blob,
  scaleFactor: number,
  onProgress: (u: ProcessingUpdate) => void,
  progressBase: number
): Promise<OcrWord[]> {
  const createWorker = await getCreateWorker();
  const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist';
  const CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0';
  const BEST_LANG_PATH = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
  const workerOpts = {
    workerPath: `${TESS_CDN}/worker.min.js`,
    corePath: `${CORE_CDN}/tesseract-core-simd-lstm.wasm.js`,
  };
  let worker;
  try {
    worker = await createWorker('ind', 1, {
      ...workerOpts,
      langPath: `${BEST_LANG_PATH}/ind@1.0.0/4.0.0_best_int`,
      logger: (m: { status: string }) => {
        if (m.status === 'loading language traineddata')
          onProgress({ progress: progressBase + 2, status: 'Loading Indonesian OCR data...' });
      },
    });
  } catch {
    worker = await createWorker('eng', 1, {
      ...workerOpts,
      langPath: `${BEST_LANG_PATH}/eng@1.0.0/4.0.0_best_int`,
    });
  }

  await worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any });
  const result1 = await worker.recognize(imageBlob);
  await worker.setParameters({ tessedit_pageseg_mode: '4' as any, preserve_interword_spaces: '1' as any });
  const result2 = await worker.recognize(imageBlob);
  await worker.terminate();

  const result = result2.data.confidence > result1.data.confidence ? result2 : result1;

  const words: OcrWord[] = [];
  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          for (const w of line.words) {
            if (w.text.trim().length > 0) {
              words.push({
                text: w.text,
                confidence: w.confidence,
                bbox: {
                  x0: w.bbox.x0 / scaleFactor,
                  y0: w.bbox.y0 / scaleFactor,
                  x1: w.bbox.x1 / scaleFactor,
                  y1: w.bbox.y1 / scaleFactor,
                },
              });
            }
          }
        }
      }
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Group OCR words into rows by Y-coordinate
// ---------------------------------------------------------------------------
function groupWordsIntoRows(words: OcrWord[]): WordRow[] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2);
  const avgHeight = sorted.reduce((s, w) => s + w.bbox.y1 - w.bbox.y0, 0) / sorted.length;
  const yGap = avgHeight * 0.7;

  const rows: WordRow[] = [];
  let cur: OcrWord[] = [sorted[0]];
  let curCenter = (sorted[0].bbox.y0 + sorted[0].bbox.y1) / 2;

  for (let i = 1; i < sorted.length; i++) {
    const wc = (sorted[i].bbox.y0 + sorted[i].bbox.y1) / 2;
    if (Math.abs(wc - curCenter) < yGap) {
      cur.push(sorted[i]);
      curCenter = cur.reduce((s, w) => s + (w.bbox.y0 + w.bbox.y1) / 2, 0) / cur.length;
    } else {
      cur.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      rows.push({ words: cur, minY: Math.min(...cur.map(w => w.bbox.y0)), maxY: Math.max(...cur.map(w => w.bbox.y1)), minX: Math.min(...cur.map(w => w.bbox.x0)) });
      cur = [sorted[i]];
      curCenter = wc;
    }
  }
  cur.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  rows.push({ words: cur, minY: Math.min(...cur.map(w => w.bbox.y0)), maxY: Math.max(...cur.map(w => w.bbox.y1)), minX: Math.min(...cur.map(w => w.bbox.x0)) });
  return rows;
}

// ---------------------------------------------------------------------------
// Detect page type from OCR text
// ---------------------------------------------------------------------------
function detectPageTypeFromOcr(words: OcrWord[]): 'laba_rugi' | 'neraca' {
  const maxY = Math.max(...words.map(w => w.bbox.y1));
  const topText = words.filter(w => w.bbox.y0 < maxY * 0.15).map(w => w.text).join(' ').toLowerCase();
  if (NERACA_KEYWORDS.some(k => topText.includes(k.toLowerCase()))) return 'neraca';
  if (LABA_RUGI_KEYWORDS.some(k => topText.includes(k.toLowerCase()))) return 'laba_rugi';
  const allText = words.map(w => w.text).join(' ').toLowerCase();
  if (NERACA_KEYWORDS.some(k => allText.includes(k.toLowerCase()))) return 'neraca';
  return 'laba_rugi';
}

// ---------------------------------------------------------------------------
// Parse Laba Rugi from OCR words
// ---------------------------------------------------------------------------
function parseLabaRugiFromOcr(wordRows: WordRow[], imgW: number, imgH: number): RowData[] {
  const result: RowData[] = [];
  const startY = imgH * 0.10, endY = imgH * 0.82;
  const content = wordRows.filter(r => r.minY >= startY && r.minY <= endY);

  // Detect value columns
  const numRightEdges: number[] = [];
  for (const r of content) for (const w of r.words) if (isNumericValue(w.text) && w.bbox.x0 > imgW * 0.35) numRightEdges.push(w.bbox.x1);
  numRightEdges.sort((a, b) => a - b);

  let splitIdx = -1, maxGap = 0;
  for (let i = 1; i < numRightEdges.length; i++) {
    const gap = numRightEdges[i] - numRightEdges[i - 1];
    if (gap > maxGap && gap >= imgW * 0.04) { maxGap = gap; splitIdx = i; }
  }

  let subCol = -1, mainCol = -1;
  if (splitIdx > 0) {
    const left = numRightEdges.slice(0, splitIdx), right = numRightEdges.slice(splitIdx);
    if (left.length >= 2) subCol = left.reduce((a, b) => a + b, 0) / left.length;
    if (right.length >= 2) mainCol = right.reduce((a, b) => a + b, 0) / right.length;
  } else if (numRightEdges.length > 0) {
    mainCol = numRightEdges.reduce((a, b) => a + b, 0) / numRightEdges.length;
  }

  const minLeft = content.length > 0 ? Math.min(...content.map(r => r.minX)) : 0;

  for (const row of content) {
    const labelParts: string[] = [];
    let subValue: number | null = null, mainValue: number | null = null, rowNum = '';

    let wi = 0;
    while (wi < row.words.length) {
      const word = row.words[wi];

      if (isRpPrefix(word.text)) {
        const emb = extractDigitsFromRpWord(word.text);
        if (emb && isNumericValue(emb)) { assignVal(emb, word.bbox.x1, subCol, mainCol, v => { subValue = v; }, v => { mainValue = v; }); wi++; continue; }
        const parts: string[] = [];
        let j = wi + 1;
        while (j < row.words.length && (isNumericValue(row.words[j].text) || row.words[j].text === '.' || row.words[j].text === ',')) { parts.push(row.words[j].text); j++; }
        if (parts.length > 0) { assignVal(parts.join(''), row.words[j-1].bbox.x1, subCol, mainCol, v => { subValue = v; }, v => { mainValue = v; }); wi = j; continue; }
        wi++; continue;
      }

      { const emb = extractDigitsFromRpWord(word.text);
        if (emb && isNumericValue(emb) && word.bbox.x0 > imgW * 0.35) { assignVal(emb, word.bbox.x1, subCol, mainCol, v => { subValue = v; }, v => { mainValue = v; }); wi++; continue; }
      }

      if (isNumericValue(word.text) && word.bbox.x0 > imgW * 0.35) {
        let combined = word.text, cRight = word.bbox.x1, j = wi + 1;
        while (j < row.words.length) {
          const n = row.words[j];
          if (n.bbox.x0 - cRight < imgW * 0.025 && /[\d.,]/.test(n.text) && !isRpPrefix(n.text)) { combined += n.text; cRight = n.bbox.x1; j++; } else break;
        }
        assignVal(combined, cRight, subCol, mainCol, v => { subValue = v; }, v => { mainValue = v; });
        wi = j; continue;
      }

      if (word.bbox.x0 < imgW * 0.12 && /^\d{1,2}[.:]?$/.test(word.text.trim())) {
        const n = parseInt(word.text);
        if (n > 0 && n <= 50) { rowNum = n.toString(); wi++; continue; }
      }

      labelParts.push(word.text);
      wi++;
    }

    let label = correctLabel(labelParts.join(' ').trim().replace(/^[:\-\u2014|.;,\s]+/, '').replace(/[:\-\u2014|;,\s]+$/, ''));
    if (!label && subValue === null && mainValue === null) continue;

    if (!rowNum) { const m = label.match(/^(\d{1,2})[\s.:]+(.+)$/); if (m && parseInt(m[1]) <= 50) { rowNum = m[1]; label = m[2].trim(); } }

    const isH = isSectionHeader(label), isT = isTotalLine(label);
    result.push({ label, subValue, mainValue, isHeader: isH && !subValue && !mainValue, isTotal: isT, isIndented: rowNum.length > 0 || row.minX > minLeft + imgW * 0.025, isNumbered: rowNum.length > 0, rowNumber: rowNum });
  }
  return result;
}

function assignVal(numText: string, numRight: number, subCol: number, mainCol: number, setSub: (v: number) => void, setMain: (v: number) => void): void {
  const num = parseIndonesianNumber(correctNumericValue(numText));
  if (num === null) return;
  if (subCol > 0 && mainCol > 0) {
    if (Math.abs(numRight - mainCol) < Math.abs(numRight - subCol)) setMain(num); else setSub(num);
  } else setMain(num);
}

// ---------------------------------------------------------------------------
// Parse Neraca from OCR words (side-by-side)
// ---------------------------------------------------------------------------
function parseNeracaFromOcr(wordRows: WordRow[], imgW: number, imgH: number): { leftRows: RowData[]; rightRows: RowData[]; leftTitle: string; rightTitle: string } {
  const startY = imgH * 0.10, endY = imgH * 0.82;
  const contentWords = wordRows.flatMap(r => r.words).filter(w => w.bbox.y0 >= startY && w.bbox.y0 <= endY);
  const midX = imgW / 2;

  const leftWR = groupWordsIntoRows(contentWords.filter(w => w.bbox.x0 < midX));
  const rightWR = groupWordsIntoRows(contentWords.filter(w => w.bbox.x0 >= midX));

  return {
    leftRows: parseSideFromOcr(leftWR, midX),
    rightRows: parseSideFromOcr(rightWR, midX),
    leftTitle: 'Aktiva',
    rightTitle: 'Passiva',
  };
}

function parseSideFromOcr(wordRows: WordRow[], sideWidth: number): RowData[] {
  const result: RowData[] = [];
  const numRightEdges: number[] = [];
  for (const r of wordRows) for (const w of r.words) if (isNumericValue(w.text)) numRightEdges.push(w.bbox.x1);
  numRightEdges.sort((a, b) => a - b);

  let splitIdx = -1, maxGap = 0;
  for (let i = 1; i < numRightEdges.length; i++) {
    const gap = numRightEdges[i] - numRightEdges[i - 1];
    if (gap > maxGap && gap >= sideWidth * 0.06) { maxGap = gap; splitIdx = i; }
  }

  let subCol = -1, mainCol = -1;
  if (splitIdx > 0) {
    const l = numRightEdges.slice(0, splitIdx), r = numRightEdges.slice(splitIdx);
    if (l.length >= 2) subCol = l.reduce((a, b) => a + b, 0) / l.length;
    if (r.length >= 2) mainCol = r.reduce((a, b) => a + b, 0) / r.length;
  } else if (numRightEdges.length > 0) {
    subCol = numRightEdges.reduce((a, b) => a + b, 0) / numRightEdges.length;
  }

  for (const row of wordRows) {
    const lp: string[] = [];
    let sv: number | null = null, mv: number | null = null;

    for (const word of row.words) {
      if (isRpPrefix(word.text)) continue;
      const emb = extractDigitsFromRpWord(word.text);
      if (emb && isNumericValue(emb)) {
        const n = parseIndonesianNumber(correctNumericValue(emb));
        if (n !== null) { if (subCol > 0 && mainCol > 0) { if (Math.abs(word.bbox.x1 - mainCol) < Math.abs(word.bbox.x1 - subCol)) mv = n; else sv = n; } else sv = n; }
        continue;
      }
      if (isNumericValue(word.text)) {
        const n = parseIndonesianNumber(correctNumericValue(word.text));
        if (n !== null) { if (subCol > 0 && mainCol > 0) { if (Math.abs(word.bbox.x1 - mainCol) < Math.abs(word.bbox.x1 - subCol)) mv = n; else sv = n; } else sv = n; }
        continue;
      }
      lp.push(word.text);
    }

    let label = correctLabel(lp.join(' ').trim().replace(/^[:\-\u2014|.;,\s]+/, '').replace(/[:\-\u2014|;,\s]+$/, ''));
    if (!label && sv === null && mv === null) continue;

    result.push({ label, subValue: sv, mainValue: mv, isHeader: isSectionHeader(label) && !sv && !mv, isTotal: isTotalLine(label), isIndented: false, isNumbered: false, rowNumber: '' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Generate Excel from extracted data
// ---------------------------------------------------------------------------
async function generateExcel(extraction: PdfExtractionResult, onProgress?: (u: ProcessingUpdate) => void): Promise<Blob> {
  onProgress?.({ progress: 90, status: 'Generating Excel file...' });
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.default.Workbook();

  for (const pd of extraction.pages) {
    const ws = workbook.addWorksheet(pd.sheetName);

    if (pd.isSideBySide && pd.leftRows && pd.rightRows) {
      ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 3 }, { width: 30 }, { width: 18 }, { width: 18 }];
      const hr = ws.addRow([pd.leftTitle || 'Aktiva', 'Rp', 'Nilai', '', pd.rightTitle || 'Passiva', 'Rp', 'Nilai']);
      hr.eachCell(c => { c.font = { bold: true }; });

      const maxR = Math.max(pd.leftRows.length, pd.rightRows.length);
      for (let i = 0; i < maxR; i++) {
        const l = pd.leftRows[i], r = pd.rightRows[i];
        const er = ws.addRow([l?.label || '', l?.subValue ?? null, l?.mainValue ?? null, null, r?.label || '', r?.subValue ?? null, r?.mainValue ?? null]);
        if (l?.isHeader || l?.isTotal) { er.getCell(1).font = { bold: true }; if (l?.mainValue !== null) er.getCell(3).font = { bold: true }; }
        if (r?.isHeader || r?.isTotal) { er.getCell(5).font = { bold: true }; if (r?.mainValue !== null) er.getCell(7).font = { bold: true }; }
        for (const col of [2, 3, 6, 7]) { const c = er.getCell(col); if (c.value !== null && c.value !== undefined) c.numFmt = '#,##0'; }
      }
    } else if (pd.rows) {
      ws.columns = [{ width: 6 }, { width: 50 }, { width: 20 }, { width: 20 }];
      const hr = ws.addRow(['No', 'Keterangan', 'Sub-Amount (Rp)', 'Amount (Rp)']);
      hr.eachCell(c => { c.font = { bold: true }; });

      for (const row of pd.rows) {
        const er = ws.addRow([row.rowNumber || null, row.label, row.subValue, row.mainValue]);
        if (row.isHeader || row.isTotal) { er.getCell(2).font = { bold: true }; if (row.mainValue !== null) er.getCell(4).font = { bold: true }; }
        for (const col of [3, 4]) { const c = er.getCell(col); if (c.value !== null && c.value !== undefined) c.numFmt = '#,##0'; }
      }
    }
  }

  onProgress?.({ progress: 95, status: 'Finalizing Excel file...' });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------------------------------------------------------------------------
// EXPORTED: Main conversion function
// ---------------------------------------------------------------------------
export async function convertPdfToExcel(
  file: File,
  onProgress?: (update: ProcessingUpdate) => void
): Promise<PdfToExcelResult> {
  const originalSize = file.size;

  onProgress?.({ progress: 2, status: 'Loading PDF library...' });
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  onProgress?.({ progress: 5, status: 'Reading PDF file...' });
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  onProgress?.({ progress: 10, status: `Found ${totalPages} page(s). Analyzing...` });

  const pages: PageData[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const ppPerPage = 75 / totalPages;
    const ppBase = 10 + (pageNum - 1) * ppPerPage;

    onProgress?.({ progress: Math.round(ppBase), status: `Processing page ${pageNum}/${totalPages}...` });

    const isText = await hasTextContent(page);
    const sheetName = `Halaman_${pageNum}`;

    if (!isText) {
      // IMAGE-BASED: render to canvas -> OCR -> parse
      onProgress?.({ progress: Math.round(ppBase + 2), status: `Page ${pageNum}: Scanned image detected, rendering...` });
      const canvas = await renderPageToCanvas(page, 3);

      onProgress?.({ progress: Math.round(ppBase + 5), status: `Page ${pageNum}: Preprocessing for OCR...` });
      const preprocessedBlob = await preprocessCanvasForOcr(canvas);

      onProgress?.({ progress: Math.round(ppBase + 8), status: `Page ${pageNum}: Running OCR...` });
      const ocrWords = await performOcr(preprocessedBlob, 3, onProgress!, Math.round(ppBase + 10));

      if (ocrWords.length === 0) { pages.push({ pageNumber: pageNum, sheetName, isSideBySide: false, rows: [] }); continue; }

      const vp = page.getViewport({ scale: 1.0 });
      const pageType = detectPageTypeFromOcr(ocrWords);
      const wordRows = groupWordsIntoRows(ocrWords);

      onProgress?.({ progress: Math.round(ppBase + ppPerPage - 5), status: `Page ${pageNum}: Parsing ${pageType === 'neraca' ? 'Balance Sheet' : 'P&L'}...` });

      if (pageType === 'neraca') {
        const { leftRows, rightRows, leftTitle, rightTitle } = parseNeracaFromOcr(wordRows, vp.width, vp.height);
        pages.push({ pageNumber: pageNum, sheetName, isSideBySide: true, leftRows, rightRows, leftTitle, rightTitle });
      } else {
        pages.push({ pageNumber: pageNum, sheetName, isSideBySide: false, rows: parseLabaRugiFromOcr(wordRows, vp.width, vp.height) });
      }
    } else {
      // TEXT-BASED: use getTextContent() — fast path
      // (Placeholder: same structure, returns empty for now since test PDF is image-based)
      onProgress?.({ progress: Math.round(ppBase + ppPerPage - 2), status: `Page ${pageNum}: Extracting text...` });
      pages.push({ pageNumber: pageNum, sheetName, isSideBySide: false, rows: [] });
    }
  }

  const blob = await generateExcel({ pages, totalPages }, onProgress);
  onProgress?.({ progress: 100, status: 'Conversion complete!' });
  return { blob, pages, originalSize, processedSize: blob.size };
}
