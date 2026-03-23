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
  rawTable?: string[][];  // generic text-based table (variable columns per row)
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

// ---------------------------------------------------------------------------
// Structural regex corrections — pattern-based noise removal that does not
// depend on knowing the document content. These handle systematic OCR layout
// artifacts that cannot be caught by single-word edit-distance correction.
// ---------------------------------------------------------------------------
const LABEL_CORRECTIONS: [RegExp, string][] = [
  // Trailing "Rp" or ".Rp" captured from value column
  [/\s*[.,]?\s*Rp\s*$/gi, ''],
  // Leading symbol noise ($, !, #, etc.)
  [/^[!$#@&*]+\s*/g, ''],
  // OCR false word boundary: "word.Word" → "word Word" (e.g. "Hutang.PPh")
  [/([a-z])\.([A-Z])/g, '$1 $2'],
  // Ampersand OCR'd as "fi" or "fl" as a standalone word
  [/\b(fi|fl)\b/g, '&'],
  // Comma between adjacent words (word,Word → word Word)
  [/([a-zA-Z]),([A-Z])/g, '$1 $2'],
  // Trailing colon + 1-3 uppercase chars (e.g. "BRI: RB" noise at end of label)
  [/:\s*[A-Z]{1,3}\s*$/g, ''],
  // Hyphen before Indonesian conjunctions/prepositions (OCR split noise)
  [/([a-zA-Z])-(dan|atau|dengan|dari|ke|di)\b/g, '$1 $2'],
];

// ---------------------------------------------------------------------------
// Indonesian financial vocabulary — canonical display forms (lowercase → display)
// Used by the OCR spell corrector to fix character-level misreads generically.
// Edit distance ≤ threshold → return canonical form; ambiguous → keep original.
// ---------------------------------------------------------------------------
const ID_FINANCIAL_VOCAB = new Map<string, string>([
  // Balance sheet structure
  ['aktiva', 'Aktiva'], ['passiva', 'Passiva'], ['neraca', 'Neraca'],
  ['laporan', 'Laporan'], ['ekuitas', 'Ekuitas'], ['modal', 'Modal'],
  // P&L structure
  ['laba', 'Laba'], ['rugi', 'Rugi'], ['penerimaan', 'Penerimaan'],
  ['pendapatan', 'Pendapatan'], ['penghasilan', 'Penghasilan'],
  ['penjualan', 'Penjualan'], ['bruto', 'Bruto'], ['neto', 'Neto'],
  ['bersih', 'Bersih'], ['kotor', 'Kotor'], ['usaha', 'Usaha'],
  // Subtotals
  ['jumlah', 'Jumlah'], ['total', 'Total'], ['harga', 'Harga'],
  ['pokok', 'Pokok'], ['tersedia', 'Tersedia'], ['dijual', 'Dijual'],
  // Asset terms
  ['kas', 'Kas'], ['bank', 'Bank'], ['piutang', 'Piutang'],
  ['persediaan', 'Persediaan'], ['deposito', 'Deposito'],
  ['bangunan', 'Bangunan'], ['kendaraan', 'Kendaraan'],
  ['inventaris', 'Inventaris'], ['tanah', 'Tanah'],
  ['pembayaran', 'Pembayaran'], ['dimuka', 'Dimuka'],
  ['kompensasi', 'Kompensasi'],
  // Liability terms
  ['hutang', 'Hutang'], ['utang', 'Utang'], ['pinjaman', 'Pinjaman'],
  ['kewajiban', 'Kewajiban'], ['jangka', 'Jangka'],
  ['panjang', 'Panjang'], ['pendek', 'Pendek'], ['lancar', 'Lancar'],
  // Expense / cost category
  ['biaya', 'Biaya'], ['beban', 'Beban'],
  ['pembelian', 'Pembelian'], ['pembuatan', 'Pembuatan'],
  ['pemeliharaan', 'Pemeliharaan'], ['penyusutan', 'Penyusutan'],
  ['pengiriman', 'Pengiriman'], ['pengurusan', 'Pengurusan'],
  ['perjalanan', 'Perjalanan'], ['perlengkapan', 'Perlengkapan'],
  ['pengeluaran', 'Pengeluaran'],
  // Expense types
  ['gaji', 'Gaji'], ['upah', 'Upah'], ['listrik', 'Listrik'],
  ['telepon', 'Telepon'], ['internet', 'Internet'],
  ['sewa', 'Sewa'], ['asuransi', 'Asuransi'], ['materai', 'Materai'],
  ['pajak', 'Pajak'], ['provisi', 'Provisi'], ['iklan', 'Iklan'],
  ['referensi', 'Referensi'], ['keamanan', 'Keamanan'], ['denda', 'Denda'],
  ['allowance', 'Allowance'], ['sumbangan', 'Sumbangan'],
  ['abonemen', 'Abonemen'], ['notaris', 'Notaris'], ['rks', 'RKS'],
  ['jaminan', 'Jaminan'],
  // Tax & regulatory
  ['pasal', 'Pasal'], ['lebih', 'Lebih'], ['bayar', 'Bayar'],
  // Business operations
  ['dagang', 'Dagang'], ['jasa', 'Jasa'], ['barang', 'Barang'],
  ['operasional', 'Operasional'], ['administrasi', 'Administrasi'],
  ['transportasi', 'Transportasi'], ['profesional', 'Profesional'],
  ['rapat', 'Rapat'], ['dokumen', 'Dokumen'],
  // People & org units
  ['pegawai', 'Pegawai'], ['karyawan', 'Karyawan'],
  ['kantor', 'Kantor'], ['makan', 'Makan'], ['lapangan', 'Lapangan'],
  // Qualifiers / modifiers
  ['awal', 'Awal'], ['akhir', 'Akhir'], ['tetap', 'Tetap'],
  ['sebelumnya', 'Sebelumnya'], ['disetor', 'Disetor'],
  ['kesehatan', 'Kesehatan'], ['pengiriman', 'Pengiriman'],
  ['bunga', 'Bunga'], ['deposit', 'Deposit'],
  // Function words (needed so they're not falsely spell-corrected)
  ['dan', 'dan'], ['atau', 'atau'], ['dari', 'dari'], ['untuk', 'untuk'],
  ['dengan', 'dengan'], ['pada', 'pada'], ['dalam', 'dalam'],
  ['yang', 'yang'], ['atas', 'atas'], ['diluar', 'Diluar'],
  // Acronyms — stored all-caps/mixed so canonical form is correct
  ['bpjs', 'BPJS'], ['pph', 'PPh'], ['ppn', 'PPN'], ['pbb', 'PBB'],
  ['atk', 'ATK'], ['bri', 'BRI'], ['bni', 'BNI'], ['btn', 'BTN'],
  ['bca', 'BCA'], ['bsi', 'BSI'],
  // Bank names (full)
  ['permata', 'Permata'], ['mandiri', 'Mandiri'], ['danamon', 'Danamon'],
]);

// ---------------------------------------------------------------------------
// Levenshtein edit distance — O(m×n), fast for OCR word lengths (< 20 chars)
// ---------------------------------------------------------------------------
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Single-row DP — O(n) space
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const cur = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = cur;
    }
    row[n] = prev;
  }
  return row[n];
}

// ---------------------------------------------------------------------------
// OCR word spell corrector — vocabulary lookup + edit-distance fallback
//
// Distance thresholds (conservative to avoid false positives):
//   ≤ 3 chars : exact match only (short words have too many edit-distance neighbours)
//   4–5 chars : edit distance ≤ 1
//   6–8 chars : edit distance ≤ 2
//   ≥ 9 chars : edit distance ≤ 3 (long words have fewer accidental neighbours)
// All-caps abbreviations (3–4 chars) get threshold 1 (e.g. "SRI"→"BRI").
// Correction only applied if the closest match is UNAMBIGUOUS (exactly one winner).
// ---------------------------------------------------------------------------
function correctOcrWord(word: string): string {
  if (!word || word.length <= 2) return word;
  if (/^\d+[.,\d]*$/.test(word)) return word; // skip numbers

  const lower = word.toLowerCase();

  // Exact match — return canonical form immediately
  const exact = ID_FINANCIAL_VOCAB.get(lower);
  if (exact) return exact;

  const len = lower.length;
  const isAllCaps = /^[A-Z]{2,4}$/.test(word);
  const maxDist = len <= 3 ? (isAllCaps ? 1 : 0)
    : len <= 5 ? 1
    : len <= 8 ? 2
    : 3;

  if (maxDist === 0) return word;

  let minDist = maxDist + 1;
  const matches: string[] = [];

  for (const [key] of ID_FINANCIAL_VOCAB) {
    if (Math.abs(key.length - len) > maxDist) continue; // fast reject by length
    const d = levenshtein(lower, key);
    if (d < minDist) { minDist = d; matches.length = 0; matches.push(key); }
    else if (d === minDist) { matches.push(key); }
  }

  // Only correct if unambiguous (single closest match)
  if (minDist <= maxDist && matches.length === 1) {
    return ID_FINANCIAL_VOCAB.get(matches[0])!;
  }
  return word; // ambiguous or no close match — keep original
}

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

  const hasDots = s.includes('.');
  const hasCommas = s.includes(',');

  // Determine if comma is a true decimal separator:
  // In Indonesian financial docs, decimals have exactly 1-2 digits after the comma.
  // If digits after the last comma are > 2, the comma is likely a misread dot (OCR noise).
  const commaGroups = s.split(',');
  const lastCommaGroup = commaGroups[commaGroups.length - 1];
  const commaIsDecimal = commaGroups.length === 2 && /^\d{1,2}$/.test(lastCommaGroup.replace(/[^0-9]/g, ''));

  if (hasDots && hasCommas && commaIsDecimal) {
    // Standard Indonesian: dots = thousands, last comma = decimal
    // e.g. "14.674.164,58" → 14674164.58
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // All dots and commas are thousands separators (or OCR noise) — strip them all
    // e.g. "14.674.164.585" → 14674164585
    // e.g. ".14.674,164.580" (OCR misread dot as comma) → 14674164580
    // e.g. "14674,16458" (OCR dropped thousands dots) → 1467416458
    s = s.replace(/[.,]/g, '');
  }

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

  // Step 1: Structural regex corrections (layout/punctuation artifacts)
  for (const [pattern, replacement] of LABEL_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  corrected = corrected.replace(/\s{2,}/g, ' ').trim();

  // Step 2: Word-level OCR spell correction using vocabulary + edit distance.
  // Each token is corrected independently; unknown words (not in vocab, no close
  // match) are passed through unchanged so correct words are never corrupted.
  corrected = corrected.split(/\s+/).map(w => correctOcrWord(w)).join(' ');

  // Step 3: Auto-capitalize words not caught by vocabulary (vocab already returns
  // correct casing for known words; this handles anything that slipped through).
  const ID_PARTICLES = new Set(['dan', 'atau', 'dari', 'untuk', 'dengan', 'pada', 'dalam',
    'atas', 'bawah', 'antara', 'oleh', 'serta', 'beserta', 'yang', 'ini', 'itu', 'juga',
    'saja', 'pula', 'lagi', 'sudah', 'akan', 'telah', 'adalah', 'yaitu', 'yakni']);
  corrected = corrected.replace(/\b([a-z])([a-zA-Z]{3,})\b/g, (_, first, rest) => {
    const word = first + rest;
    if (ID_PARTICLES.has(word.toLowerCase())) return word;
    return first.toUpperCase() + rest;
  });

  // Step 4: Strip spurious dot after short abbreviation token (e.g. "Adm. " → "Adm ")
  corrected = corrected.replace(/\b([A-Z][a-z]{1,3})\.\s/g, '$1 ');

  // Step 5: Normalize OCR-noise hyphens between different words → space.
  // Keeps reduplication (Lain-Lain) and alphanumeric hyphens (Covid-19, PPh-21).
  corrected = corrected.replace(/\b([a-zA-Z]{2,})-([a-zA-Z]{2,})\b/g, (match, a, b) => {
    if (a.toLowerCase() === b.toLowerCase()) return match;
    return `${a} ${b}`;
  });

  return corrected.trim();
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
// Extract generic table from text-based PDF page
// Groups text items into rows by y-coordinate, then separates cells by x-gap.
// Works for any columnar PDF without requiring knowledge of document structure.
// ---------------------------------------------------------------------------
async function extractTextTable(page: any): Promise<string[][]> {
  const textContent = await page.getTextContent();

  const items: Array<{ text: string; x: number; y: number }> = [];
  for (const item of textContent.items) {
    const text = (item.str || '').trim();
    if (text) items.push({ text, x: item.transform[4], y: item.transform[5] });
  }
  if (items.length === 0) return [];

  // Exclude top/bottom 3% (page header/footer)
  const yVals = items.map(i => i.y);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const margin = (yMax - yMin) * 0.03;
  const content = items.filter(i => i.y > yMin + margin && i.y < yMax - margin);

  // Group items into y-row bands first (needed for column detection step)
  const preBands: Array<{ y: number; items: typeof content }> = [];
  for (const item of content) {
    const b = preBands.find(b => Math.abs(b.y - item.y) <= 5);
    if (b) b.items.push(item);
    else preBands.push({ y: item.y, items: [item] });
  }

  // Detect column x-boundaries.
  // Strategy 1: find a header row (contains ≥2 year-like tokens or "Uraian"/"No"/"Description").
  // Use header item x-positions directly as column anchors — most accurate.
  // Strategy 2: fall back to numeric-row x-gap detection.
  const yearRe = /^(19|20)\d{2}$/;
  const headerRe = /^(uraian|no|description|keterangan|catatan|note)$/i;
  const headerBand = preBands.find(band =>
    band.items.filter(i => yearRe.test(i.text.trim())).length >= 2 ||
    (band.items.some(i => headerRe.test(i.text.trim())) && band.items.length >= 3)
  );

  let xBreaks: number[];
  if (headerBand) {
    const hx = headerBand.items.map(i => i.x).sort((a, b) => a - b);
    xBreaks = [];
    for (let i = 1; i < hx.length; i++) {
      if (hx[i] - hx[i - 1] > 10) xBreaks.push((hx[i] + hx[i - 1]) / 2);
    }
  } else {
    // Fall back: use x-gaps from numeric rows
    const numericRe = /^[\d.,]+$/;
    const tableRows = preBands.filter(band =>
      band.items.some(item => numericRe.test(item.text.replace(/\s/g, '')))
    );
    const sourceItems = tableRows.length >= 3 ? tableRows.flatMap(b => b.items) : content;
    const BUCKET = 5;
    const xSorted = sourceItems.map(i => Math.round(i.x / BUCKET) * BUCKET).sort((a, b) => a - b);
    xBreaks = [];
    const COL_GAP = 30;
    let prev = xSorted[0];
    for (let i = 1; i < xSorted.length; i++) {
      if (xSorted[i] - prev > COL_GAP) xBreaks.push((xSorted[i] + prev) / 2);
      prev = xSorted[i];
    }
  }

  // Reuse preBands for row iteration — sort top-to-bottom
  preBands.sort((a, b) => b.y - a.y);
  const bands = preBands;

  const numCols = xBreaks.length + 1;
  const table: string[][] = [];

  for (const band of bands) {
    band.items.sort((a, b) => a.x - b.x);
    const cells = new Array<string>(numCols).fill('');
    for (const item of band.items) {
      // Assign to column based on nearest x-break boundary
      let col = 0;
      for (let i = 0; i < xBreaks.length; i++) {
        if (item.x > xBreaks[i]) col = i + 1;
        else break;
      }
      cells[col] = cells[col] ? cells[col] + ' ' + item.text : item.text;
    }
    if (cells.some(c => c.trim())) table.push(cells);
  }

  return table;
}

// ---------------------------------------------------------------------------
// Render PDF page to canvas
// ---------------------------------------------------------------------------
// Scale factor for PDF-to-canvas rendering.
// PDF.js base = 72 DPI. Scale 4 → 288 DPI (near Tesseract optimal of 300 DPI).
// Higher = better OCR accuracy, slightly slower processing.
const OCR_SCALE = 4;

async function renderPageToCanvas(page: any, scaleFactor: number = OCR_SCALE): Promise<HTMLCanvasElement> {
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
// Pipeline:
//   1. Grayscale (BT.601) — work on single channel for all subsequent ops
//   2. Contrast normalization — histogram [1%..99%] percentile stretch to [0..255]
//      normalizes uneven scan exposure without clipping real ink strokes
//   3. Unsharp mask (gentle, ×1.0) — enhances character edges while suppressing
//      low-contrast scan artifacts that would otherwise be OCR'd as phantom text
//   4. Sauvola adaptive binarization — block size scales with scaleFactor so
//      neighbourhood ≈ 1 char-width at any DPI
// ---------------------------------------------------------------------------
async function preprocessCanvasForOcr(canvas: HTMLCanvasElement, scaleFactor: number = OCR_SCALE): Promise<Blob> {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const pixelCount = w * h;

  // --- Step 1: Grayscale (BT.601 luma) ---
  const gray = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    gray[i] = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }

  // --- Step 2: Contrast normalization via histogram percentile stretch ---
  // O(N + 256) — much faster than sort() for large images
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
    gray[i] = Math.round(Math.max(0, Math.min(255, (gray[i] - p1) / cRange * 255)));
  }

  // --- Step 3: Unsharp mask (strength 1.0) ---
  // Blur with 3×3 box filter, then output = original + 1.0 × (original − blurred)
  // Strength 1.0 is gentler than the previous 1.5: preserves thin character
  // strokes while still suppressing low-contrast scan artifacts.
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

  // --- Step 4: Sauvola adaptive binarization ---
  // Block size ≈ 1 character-width: baseline 25px at 3× (216 DPI), scales up
  const blockSize = Math.round(25 * scaleFactor / 3);
  const binary = sauvolaThreshold(sharpened, w, h, blockSize, 0.15);

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

  // user_defined_dpi: PDF.js renders at scale×72 DPI. Telling Tesseract the real
  // DPI lets it calibrate internal character-size expectations correctly.
  const dpi = String(Math.round(scaleFactor * 72));
  await worker.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1' as any, user_defined_dpi: dpi as any });
  const result1 = await worker.recognize(imageBlob);
  await worker.setParameters({ tessedit_pageseg_mode: '4' as any, preserve_interword_spaces: '1' as any, user_defined_dpi: dpi as any });
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
  const startY = imgH * 0.10, endY = imgH * 0.78;
  const allContent = wordRows.filter(r => r.minY >= startY && r.minY <= endY);

  // Skip company header rows — only start output from first recognized section header
  // (e.g. PENERIMAAN BRUTO, BIAYA LANGSUNG, etc.)
  let firstSectionIdx = 0;
  for (let i = 0; i < allContent.length; i++) {
    const rowText = allContent[i].words.map(w => w.text).join(' ');
    if (HEADER_KEYWORDS.some(k => rowText.toUpperCase().includes(k.toUpperCase()))) {
      firstSectionIdx = i;
      break;
    }
  }
  const content = allContent.slice(firstSectionIdx);

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

      // Row numbers appear at left margin as 1-2 digits, optionally followed by
      // punctuation or a single OCR-noise letter (e.g. "24" misread as "2A").
      // Extract only the leading digit(s) to be robust against character confusion.
      if (word.bbox.x0 < imgW * 0.12 && /^\d{1,2}[A-Za-z.:]?$/.test(word.text.trim())) {
        const digits = word.text.match(/^(\d+)/);
        const n = digits ? parseInt(digits[1]) : 0;
        if (n > 0 && n <= 50) { rowNum = n.toString(); wi++; continue; }
      }

      labelParts.push(word.text);
      wi++;
    }

    let label = correctLabel(labelParts.join(' ').trim().replace(/^[\u0022\u0027\u201A-\u201F:\-\u2014|.;,\s]+/, '').replace(/[\u0022\u0027\u201A-\u201F.!":\-\u2014|;,\s]+$/, ''));
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
// Merge orphan numeric continuation rows (OCR splits large numbers across lines)
// ---------------------------------------------------------------------------
function mergeOrphanNumbers(rows: RowData[]): void {
  for (let i = rows.length - 1; i >= 1; i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    const curVal = cur.mainValue ?? cur.subValue;
    // Current row: no label, value has ≤ 3 digits (continuation fragment like "363")
    if (cur.label || curVal === null) continue;
    if (Math.abs(curVal).toString().length > 3) continue;
    // Previous row: must have a label and a value with ≥ 6 digits (truncated large number)
    if (!prev.label) continue;
    const prevMainLen = prev.mainValue !== null ? Math.abs(prev.mainValue).toString().length : 0;
    const prevSubLen = prev.subValue !== null ? Math.abs(prev.subValue).toString().length : 0;
    if (prevMainLen >= 6) {
      const combined = parseFloat(Math.abs(prev.mainValue!).toString() + Math.abs(curVal).toString());
      if (!isNaN(combined)) { prev.mainValue = prev.mainValue! < 0 ? -combined : combined; rows.splice(i, 1); }
    } else if (prevSubLen >= 6) {
      const combined = parseFloat(Math.abs(prev.subValue!).toString() + Math.abs(curVal).toString());
      if (!isNaN(combined)) { prev.subValue = prev.subValue! < 0 ? -combined : combined; rows.splice(i, 1); }
    }
  }
}

// ---------------------------------------------------------------------------
// Parse Neraca from OCR words (side-by-side)
// ---------------------------------------------------------------------------
function parseNeracaFromOcr(wordRows: WordRow[], imgW: number, imgH: number): { leftRows: RowData[]; rightRows: RowData[]; leftTitle: string; rightTitle: string } {
  // startY at 30% to skip company letterhead (address, logo, NERACA title) at the top of Neraca pages
  const startY = imgH * 0.30, endY = imgH * 0.82;
  const contentWords = wordRows.flatMap(r => r.words).filter(w => w.bbox.y0 >= startY && w.bbox.y0 <= endY);
  // Use 48% as midX: right-column label words (e.g. "Hutang", "Jangka") OCR-bbox at ~48-50%
  // go into RIGHT bucket. 50%+ was too high — those words fell to LEFT then got stripped.
  const midX = imgW * 0.48;

  const leftWR = groupWordsIntoRows(contentWords.filter(w => w.bbox.x0 < midX));
  const rightWR = groupWordsIntoRows(contentWords.filter(w => w.bbox.x0 >= midX));

  const leftRows = parseSideFromOcr(leftWR, midX);
  const rightRows = parseSideFromOcr(rightWR, midX);

  // Post-process: strip any residual Passiva keywords from left labels (safety net for OCR bleed)
  for (const row of leftRows) {
    if (!row.label) continue;
    row.label = row.label.replace(/\s+Hutang\b.*/i, '').trim();
    row.label = row.label.replace(/\s+Dn\s+C\b.*/i, '').trim();
    row.label = row.label.replace(/\s+[|D]\.\s*Ek\w*.*/i, '').trim();
    row.label = row.label.replace(/\s+Jumlah\s+(?:Hutang|Ekuitas|Passiva)\b.*/i, '').trim();
    row.label = row.label.replace(/\s+Laba\s+Tahun\b.*/i, '').trim();
    row.label = row.label.replace(/[.:\-\u2014|;,\s]+$/, '').trim();
  }

  // Post-process: rows whose label starts with "Akum" represent accumulated depreciation
  // (Akumulasi Penyusutan). In double-entry accounting this is a contra-asset: it offsets
  // the gross asset value and must always be negative on the balance sheet. OCR frequently
  // extracts the raw absolute number from the PDF, so we negate it here if positive.
  for (const row of leftRows) {
    if (!row.label) continue;
    if (/^akum/i.test(row.label)) {
      if (row.mainValue !== null && row.mainValue > 0) row.mainValue = -row.mainValue;
      if (row.subValue !== null && row.subValue > 0) row.subValue = -row.subValue;
    }
  }

  // Post-process: merge OCR-split numbers where a large value was broken across OCR text lines
  // e.g. "30444563" on one row + orphan "363" on next → 30444563363
  mergeOrphanNumbers(leftRows);
  mergeOrphanNumbers(rightRows);

  // Post-process: Passiva individual items should go to subValue, totals to mainValue.
  // parseSideFromOcr defaults to mainValue when single column; fix by label-based reclassification.
  for (const row of rightRows) {
    if (row.mainValue !== null && row.subValue === null && row.label) {
      const isTotal = /\bjumlah\b|\btotal\b/i.test(row.label);
      if (!isTotal) {
        row.subValue = row.mainValue;
        row.mainValue = null;
      }
    }
  }

  return {
    leftRows,
    rightRows,
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
    // Single column: assign to mainCol so values end up in mainValue (not subValue)
    mainCol = numRightEdges.reduce((a, b) => a + b, 0) / numRightEdges.length;
  }

  for (const row of wordRows) {
    const lp: string[] = [];
    let sv: number | null = null, mv: number | null = null;
    let wi = 0;

    while (wi < row.words.length) {
      const word = row.words[wi];
      if (isRpPrefix(word.text)) { wi++; continue; }
      const emb = extractDigitsFromRpWord(word.text);
      if (emb && isNumericValue(emb)) {
        const n = parseIndonesianNumber(correctNumericValue(emb));
        if (n !== null) {
          if (subCol > 0 && mainCol > 0) {
            if (Math.abs(word.bbox.x1 - mainCol) < Math.abs(word.bbox.x1 - subCol)) mv = n; else sv = n;
          } else mv = n;
        }
        wi++; continue;
      }
      if (isNumericValue(word.text)) {
        // Combine consecutive number tokens — handles OCR splitting "1.423.637" + ".783"
        let combined = word.text, cRight = word.bbox.x1, j = wi + 1;
        while (j < row.words.length) {
          const next = row.words[j];
          if (next.bbox.x0 - cRight < sideWidth * 0.05 && /[\d.,]/.test(next.text) && !isRpPrefix(next.text)) {
            combined += next.text; cRight = next.bbox.x1; j++;
          } else break;
        }
        const n = parseIndonesianNumber(correctNumericValue(combined));
        if (n !== null) {
          if (subCol > 0 && mainCol > 0) {
            if (Math.abs(cRight - mainCol) < Math.abs(cRight - subCol)) mv = n; else sv = n;
          } else mv = n;
        }
        wi = j; continue;
      }
      lp.push(word.text);
      wi++;
    }

    let label = correctLabel(lp.join(' ').trim().replace(/^[\u0022\u0027\u201A-\u201F:\-\u2014|.;,\s]+/, '').replace(/[\u0022\u0027\u201A-\u201F.:\-\u2014|;,\s]+$/, ''));
    // Strip trailing OCR noise ONLY on header/label-only rows (no values).
    // Run in a loop because "Dn C" needs two passes: strip "C" first, then "Dn".
    if (sv === null && mv === null) {
      let prev;
      do {
        prev = label;
        label = label.replace(/\s+\d{1,2}\s*$/, '').trim();       // trailing digit noise
        label = label.replace(/\s+[A-Za-z]{1,2}\s*$/, '').trim(); // trailing 1-2 letter stub
      } while (label !== prev);
    }
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
    } else if (pd.rawTable && pd.rawTable.length > 0) {
      // Generic text-based table — variable columns, output as-is
      const numCols = Math.max(...pd.rawTable.map(r => r.length));
      ws.columns = Array.from({ length: numCols }, () => ({ width: 25 }));
      for (const row of pd.rawTable) {
        // Pad row to numCols
        const cells: (string | number | null)[] = row.slice(0, numCols);
        while (cells.length < numCols) cells.push(null);
        // Try to convert numeric strings to numbers
        const typed = cells.map(c => {
          if (!c) return null;
          // Indonesian number format: dots as thousands sep, comma as decimal
          const clean = String(c).replace(/\./g, '').replace(',', '.');
          const n = Number(clean);
          return !isNaN(n) && clean.trim() !== '' ? n : c;
        });
        ws.addRow(typed);
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
      const canvas = await renderPageToCanvas(page, OCR_SCALE);

      onProgress?.({ progress: Math.round(ppBase + 5), status: `Page ${pageNum}: Preprocessing for OCR...` });
      const preprocessedBlob = await preprocessCanvasForOcr(canvas, OCR_SCALE);

      onProgress?.({ progress: Math.round(ppBase + 8), status: `Page ${pageNum}: Running OCR...` });
      const ocrWords = await performOcr(preprocessedBlob, OCR_SCALE, onProgress!, Math.round(ppBase + 10));

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
      onProgress?.({ progress: Math.round(ppBase + ppPerPage - 2), status: `Page ${pageNum}: Extracting text...` });
      const rawTable = await extractTextTable(page);
      pages.push({ pageNumber: pageNum, sheetName, isSideBySide: false, rawTable });
    }
  }

  const blob = await generateExcel({ pages, totalPages }, onProgress);
  onProgress?.({ progress: 100, status: 'Conversion complete!' });
  return { blob, pages, originalSize, processedSize: blob.size };
}
