// ============================================================================
// Excel to PDF Converter — Client-Side
//
// Pipeline:
//   1. ExcelJS (.xlsx) or SheetJS (.xls) → read file
//   2. Extract cells, styles, merges, images
//   3. Format values, resolve theme colors
//   4. jspdf-autotable → render styled tables with auto-fit & pagination
//   5. Overlay embedded images via didDrawCell hook
//
// Output: vector-text PDF (searchable, selectable, printable)
// ============================================================================

// ---------------------------------------------------------------------------
// Lazy loaders — all heavy libs loaded on-demand
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _jsPDF: any = null;
async function getJsPDF() {
  if (_jsPDF) return _jsPDF;
  const mod = await import("jspdf");
  _jsPDF = mod.default;
  return _jsPDF;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _autoTable: any = null;
async function getAutoTable() {
  if (_autoTable) return _autoTable;
  const mod = await import("jspdf-autotable");
  _autoTable = mod.default;
  return _autoTable;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ExcelJS: any = null;
async function getExcelJS() {
  if (_ExcelJS) return _ExcelJS;
  const mod = await import("exceljs");
  _ExcelJS = mod.default || mod;
  return _ExcelJS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _XLSX: any = null;
async function getXLSX() {
  if (_XLSX) return _XLSX;
  const mod = await import("xlsx");
  _XLSX = mod;
  return _XLSX;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProcessingUpdate {
  progress: number; // 0-100
  status: string;
}

export interface ExcelToPdfResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  qualityScore: number;
  pageCount: number;
  sheetCount: number;
}

type OnProgress = (update: ProcessingUpdate) => void;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CellData {
  value: string;
  colSpan: number;
  rowSpan: number;
  fillColor: [number, number, number] | null;
  textColor: [number, number, number] | null;
  fontStyle: "normal" | "bold" | "italic" | "bolditalic";
  fontSize: number;
  halign: "left" | "center" | "right";
  valign: "top" | "middle" | "bottom";
  borderTop: number;
  borderBottom: number;
  borderLeft: number;
  borderRight: number;
  borderColorTop: [number, number, number] | null;
  borderColorBottom: [number, number, number] | null;
  borderColorLeft: [number, number, number] | null;
  borderColorRight: [number, number, number] | null;
  isMergedSlave: boolean;
}

interface EmbeddedImage {
  dataUrl: string;     // base64 data URL for jsPDF
  format: string;      // 'PNG' | 'JPEG'
  tlRow: number;       // top-left row (0-indexed)
  tlCol: number;       // top-left col (0-indexed)
  brRow: number;       // bottom-right row (0-indexed)
  brCol: number;       // bottom-right col (0-indexed)
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
  rowHeights: number[];
  orientation: "portrait" | "landscape";
  headerRowIndex: number | null;
  colCount: number;
  rowCount: number;
  images: EmbeddedImage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default Office theme colors (ExcelJS mapping: 0=lt1, 1=dk1)
const DEFAULT_THEME_COLORS: string[] = [
  "FFFFFF", // 0: lt1 (white)
  "000000", // 1: dk1 (black)
  "44546A", // 2: dk2
  "E7E6E6", // 3: lt2
  "4472C4", // 4: accent1 (blue)
  "ED7D31", // 5: accent2 (orange)
  "A5A5A5", // 6: accent3 (gray)
  "FFC000", // 7: accent4 (gold)
  "5B9BD5", // 8: accent5 (light blue)
  "70AD47", // 9: accent6 (green)
];

const INDEXED_COLORS: Record<number, string> = {
  0: "000000", 1: "FFFFFF", 2: "FF0000", 3: "00FF00",
  4: "0000FF", 5: "FFFF00", 6: "FF00FF", 7: "00FFFF",
  8: "000000", 9: "FFFFFF", 10: "FF0000", 11: "00FF00",
  12: "0000FF", 13: "FFFF00", 14: "FF00FF", 15: "00FFFF",
  16: "800000", 17: "008000", 18: "000080", 19: "808000",
  20: "800080", 21: "008080", 22: "C0C0C0", 23: "808080",
  64: "000000",
};

const ERROR_STRINGS: Record<number, string> = {
  0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!",
  0x17: "#REF!", 0x1D: "#NAME?", 0x24: "#NUM!",
  0x2A: "#N/A", 0x2B: "#GETTING_DATA",
};

const PAGE = {
  A4_W: 595.28,
  A4_H: 841.89,
  MARGIN: 36,         // ~12.7mm each side
  MIN_FONT: 5,
  DEFAULT_FONT: 9,
  DEFAULT_ROW_H: 15,
  EXCEL_CHAR_PT: 5.7, // 1 Excel character unit ≈ 5.7pt
};

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

function applyTint(base: number, tint: number): number {
  if (tint > 0) return Math.min(255, Math.round(base + (255 - base) * tint));
  if (tint < 0) return Math.max(0, Math.round(base * (1 + tint)));
  return base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveColor(color: any): [number, number, number] | null {
  if (!color) return null;

  // ARGB string (e.g., 'FFF4B084' — AARRGGBB)
  if (color.argb && typeof color.argb === "string") {
    const hex = color.argb.length === 8 ? color.argb.substring(2) : color.argb;
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) return hexToRgb(hex);
  }

  // Theme color + optional tint
  if (color.theme !== undefined && color.theme !== null) {
    const themeHex = DEFAULT_THEME_COLORS[color.theme];
    if (themeHex) {
      const [r, g, b] = hexToRgb(themeHex);
      const t = color.tint || 0;
      return [applyTint(r, t), applyTint(g, t), applyTint(b, t)];
    }
  }

  // Indexed color (legacy)
  if (color.indexed !== undefined && INDEXED_COLORS[color.indexed]) {
    return hexToRgb(INDEXED_COLORS[color.indexed]);
  }

  // Direct RGB string (e.g., 'FF0000' — from SheetJS)
  if (color.rgb && typeof color.rgb === "string" && /^[0-9A-Fa-f]{6}$/.test(color.rgb)) {
    return hexToRgb(color.rgb);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function imgExtToFormat(ext: string): string {
  const e = ext.toLowerCase().replace(".", "");
  if (e === "jpg" || e === "jpeg") return "JPEG";
  if (e === "png") return "PNG";
  if (e === "gif") return "GIF";
  return "PNG"; // fallback
}

// ---------------------------------------------------------------------------
// Number & date formatting (comprehensive)
// ---------------------------------------------------------------------------

function formatNumber(value: number, numFmt: string): string {
  if (!numFmt || numFmt === "General") {
    if (Number.isInteger(value)) return String(value);
    return String(parseFloat(value.toPrecision(10)));
  }

  // Handle multi-section formats: positive;negative;zero;text
  // Use the appropriate section based on value sign
  const sections = numFmt.split(";");
  let fmt = sections[0]; // positive/default
  if (value < 0 && sections.length >= 2) {
    fmt = sections[1];
    value = Math.abs(value); // section handles the sign
  } else if (value === 0 && sections.length >= 3) {
    fmt = sections[2];
  }

  // Strip color codes: [Red], [Blue], [Color15], etc.
  fmt = fmt.replace(/\[(?:Red|Blue|Green|Yellow|Magenta|Cyan|White|Black|Color\d+)\]/gi, "");

  // Strip condition brackets: [>100], [<=0], etc.
  fmt = fmt.replace(/\[(?:>|<|>=|<=|=|<>)\d+(?:\.\d+)?\]/g, "");

  // Percentage: 0%, 0.00%, etc.
  if (fmt.includes("%")) {
    const pct = value * 100;
    const decMatch = fmt.match(/0\.(0+)%/);
    const decimals = decMatch ? decMatch[1].length : 0;
    return `${pct.toFixed(decimals)}%`;
  }

  // Scientific notation: 0.00E+00
  if (/[eE][+-]/.test(fmt)) {
    const decMatch = fmt.match(/0\.(0+)[eE]/);
    const decimals = decMatch ? decMatch[1].length : 2;
    return value.toExponential(decimals).toUpperCase();
  }

  // Currency/accounting with symbol: $#,##0.00 or [$Rp-421]#,##0
  const currencyMatch = fmt.match(/(\$|£|€|¥|Rp|IDR|USD|[\$][^\]]*]?)/);
  const currencySymbol = currencyMatch ? currencyMatch[1].replace(/[\[\]$]/g, "").trim() || "$" : "";

  // Thousands separator: #,##0 or variants
  if (fmt.includes("#,##0") || fmt.includes("#,###") || fmt.includes("0,0")) {
    const isNeg = value < 0;
    const abs = Math.abs(value);
    const decMatch = fmt.match(/0\.(0+)/);
    const decimals = decMatch ? decMatch[1].length : 0;
    const fixed = abs.toFixed(decimals);
    const [intPart, decPart] = fixed.split(".");
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let result = decPart ? `${withSep}.${decPart}` : withSep;

    // Wrap in parentheses or minus for negatives
    if (isNeg) {
      result = fmt.includes("(") || fmt.includes(")") ? `(${result})` : `-${result}`;
    }

    // Add currency symbol
    if (currencySymbol) {
      // Check if symbol goes before or after: format "$#" vs "#$"
      const symIdx = fmt.indexOf(currencySymbol.charAt(0));
      const hashIdx = fmt.indexOf("#");
      const zeroIdx = fmt.indexOf("0");
      const numIdx = Math.min(hashIdx >= 0 ? hashIdx : 999, zeroIdx >= 0 ? zeroIdx : 999);
      if (symIdx < numIdx) {
        result = `${currencySymbol}${result}`;
      } else {
        result = `${result} ${currencySymbol}`;
      }
    }

    return result;
  }

  // Fraction: # ?/? or # ??/??
  if (fmt.includes("?/")) {
    const whole = Math.floor(Math.abs(value));
    const frac = Math.abs(value) - whole;
    if (frac === 0) return String(value < 0 ? -whole : whole);
    // Simple fraction approximation
    const denom = fmt.includes("??/") ? 100 : 10;
    const num = Math.round(frac * denom);
    const sign = value < 0 ? "-" : "";
    return whole > 0 ? `${sign}${whole} ${num}/${denom}` : `${sign}${num}/${denom}`;
  }

  // Fixed decimal: 0.00, 0.0, etc.
  const fixedMatch = fmt.match(/^0\.(0+)$/);
  if (fixedMatch) return value.toFixed(fixedMatch[1].length);

  // Plain 0 format
  if (fmt.trim() === "0") return Math.round(value).toString();

  // Fallback
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(10)));
}

function formatDate(date: Date, numFmt?: string): string {
  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  const dd = String(day).padStart(2, "0");
  const mm = String(month + 1).padStart(2, "0");
  const yy = String(year).slice(-2);
  const yyyy = String(year);
  const months3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (!numFmt) return `${mm}/${dd}/${yyyy}`;

  const f = numFmt.toLowerCase();

  // yyyy-mm-dd
  if (f.includes("yyyy") && f.includes("mm") && f.includes("dd") && f.includes("-")) {
    return `${yyyy}-${mm}-${dd}`;
  }
  // dd/mm/yyyy
  if (f.startsWith("d") && f.includes("/")) {
    return `${dd}/${mm}/${yyyy}`;
  }
  // d-mmm-yy or dd-mmm-yy
  if (f.includes("mmm") && f.includes("-")) {
    return `${day}-${months3[month]}-${yy}`;
  }
  // mmm-yy
  if (f.includes("mmm") && !f.includes("d")) {
    return `${months3[month]}-${yy}`;
  }
  // m/d/yy or m/d/yyyy
  if (f.includes("m") && f.includes("d") && f.includes("/")) {
    return f.includes("yyyy") ? `${month + 1}/${day}/${yyyy}` : `${month + 1}/${day}/${yy}`;
  }

  // Default
  return `${mm}/${dd}/${yyyy}`;
}

// ---------------------------------------------------------------------------
// Cell value extraction — handles all ExcelJS value types
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getCellText(cell: any): string {
  const value = cell.value;
  const numFmt: string = cell.numFmt || cell.style?.numFmt || "General";

  if (value === null || value === undefined) return "";

  // Error value
  if (typeof value === "object" && value.error !== undefined) {
    const code = typeof value.error === "number" ? value.error : 0x07;
    return ERROR_STRINGS[code] || "#ERROR!";
  }

  // Formula → use result
  if (typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    const result = value.result;
    if (result === null || result === undefined) return "";
    if (typeof result === "object" && result.error !== undefined) {
      const code = typeof result.error === "number" ? result.error : 0x07;
      return ERROR_STRINGS[code] || "#ERROR!";
    }
    if (typeof result === "number") return formatNumber(result, numFmt);
    if (result instanceof Date) return formatDate(result, numFmt);
    return String(result);
  }

  // Rich text → concatenate
  if (typeof value === "object" && Array.isArray(value.richText)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return value.richText.map((rt: any) => rt.text || "").join("");
  }

  if (value instanceof Date) return formatDate(value, numFmt);
  if (typeof value === "number") return formatNumber(value, numFmt);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

// ---------------------------------------------------------------------------
// Border helper
// ---------------------------------------------------------------------------

function borderWidth(style: string | undefined): number {
  switch (style) {
    case "thin": return 0.4;
    case "medium": return 0.8;
    case "thick": return 1.5;
    case "hair": return 0.15;
    case "dotted": case "dashed": case "dashDot": case "dashDotDot": return 0.4;
    case "mediumDashed": case "mediumDashDot": case "mediumDashDotDot": return 0.8;
    case "double": return 0.8;
    case "slantDashDot": return 0.8;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Column letter → number: "A"→1, "Z"→26, "AA"→27
// ---------------------------------------------------------------------------

function colToNum(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Extract data from one ExcelJS worksheet (.xlsx)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSheet(ws: any, wb: any): SheetData | null {
  // 1. Find used range
  let maxRow = 0;
  let maxCol = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.eachRow({ includeEmpty: false }, (row: any, rn: number) => {
    if (rn > maxRow) maxRow = rn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    row.eachCell({ includeEmpty: false }, (_c: any, cn: number) => {
      if (cn > maxCol) maxCol = cn;
    });
  });

  // Extend range for merges
  const merges: string[] = ws.model?.merges || [];
  for (const m of merges) {
    const mt = m.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (mt) {
      maxRow = Math.max(maxRow, parseInt(mt[4]));
      maxCol = Math.max(maxCol, colToNum(mt[3]));
    }
  }

  if (maxRow === 0 || maxCol === 0) return null;

  // 2. Build merge map
  const mergeMap = new Map<
    string,
    { master: boolean; rowSpan: number; colSpan: number }
  >();

  for (const m of merges) {
    const mt = m.match(/([A-Z]+)(\d+):([A-Z]+)(\d+)/);
    if (!mt) continue;
    const sc = colToNum(mt[1]), sr = parseInt(mt[2]);
    const ec = colToNum(mt[3]), er = parseInt(mt[4]);
    const rs = er - sr + 1, cs = ec - sc + 1;

    mergeMap.set(`${sr},${sc}`, { master: true, rowSpan: rs, colSpan: cs });
    for (let r = sr; r <= er; r++) {
      for (let c = sc; c <= ec; c++) {
        if (r === sr && c === sc) continue;
        mergeMap.set(`${r},${c}`, { master: false, rowSpan: 0, colSpan: 0 });
      }
    }
  }

  // 3. Column widths
  const colWidths: number[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const col = ws.getColumn(c);
    const w = col.width ?? 8.43;
    colWidths.push(w * PAGE.EXCEL_CHAR_PT);
  }

  // 4. Extract every row
  const rows: CellData[][] = [];
  const rowHeights: number[] = [];

  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    rowHeights.push((row.height || PAGE.DEFAULT_ROW_H) * 0.75);

    const cells: CellData[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const mi = mergeMap.get(`${r},${c}`);

      if (mi && !mi.master) {
        cells.push(emptyCellData(true));
        continue;
      }

      const cell = row.getCell(c);
      const st = cell.style || {};
      const font = st.font || {};
      const fill = st.fill || {};
      const border = st.border || {};
      const align = st.alignment || {};

      let fillColor: [number, number, number] | null = null;
      if (fill.type === "pattern" && fill.fgColor) {
        fillColor = resolveColor(fill.fgColor);
      }

      const textColor = resolveColor(font.color);

      const b = !!font.bold, it = !!font.italic;
      const fontStyle: CellData["fontStyle"] =
        b && it ? "bolditalic" : b ? "bold" : it ? "italic" : "normal";

      const fontSize = font.size || 11;

      let halign: CellData["halign"] = "left";
      if (align.horizontal === "center" || align.horizontal === "centerContinuous") {
        halign = "center";
      } else if (align.horizontal === "right") {
        halign = "right";
      } else if (!align.horizontal) {
        const v = cell.value;
        if (
          typeof v === "number" ||
          (typeof v === "object" && v && "result" in v && typeof v.result === "number")
        ) {
          halign = "right";
        }
      }

      let valign: CellData["valign"] = "middle";
      if (align.vertical === "top") valign = "top";
      else if (align.vertical === "bottom") valign = "bottom";

      cells.push({
        value: getCellText(cell),
        colSpan: mi?.colSpan || 1,
        rowSpan: mi?.rowSpan || 1,
        fillColor,
        textColor,
        fontStyle,
        fontSize,
        halign,
        valign,
        borderTop: borderWidth(border.top?.style),
        borderBottom: borderWidth(border.bottom?.style),
        borderLeft: borderWidth(border.left?.style),
        borderRight: borderWidth(border.right?.style),
        borderColorTop: resolveColor(border.top?.color),
        borderColorBottom: resolveColor(border.bottom?.color),
        borderColorLeft: resolveColor(border.left?.color),
        borderColorRight: resolveColor(border.right?.color),
        isMergedSlave: false,
      });
    }
    rows.push(cells);
  }

  // 5. Extract embedded images
  const images: EmbeddedImage[] = [];
  try {
    const wsImages = ws.getImages?.() || [];
    for (const img of wsImages) {
      const imgData = wb.getImage?.(img.imageId);
      if (!imgData?.buffer) continue;

      const ext = imgExtToFormat(imgData.extension || "png");
      const b64 = bufferToBase64(imgData.buffer);
      const dataUrl = `data:image/${ext.toLowerCase()};base64,${b64}`;

      const range = img.range || {};
      const tl = range.tl || {};
      const br = range.br || {};

      images.push({
        dataUrl,
        format: ext,
        tlRow: tl.nativeRow ?? tl.row ?? 0,
        tlCol: tl.nativeCol ?? tl.col ?? 0,
        brRow: br.nativeRow ?? br.row ?? (tl.nativeRow ?? tl.row ?? 0) + 5,
        brCol: br.nativeCol ?? br.col ?? (tl.nativeCol ?? tl.col ?? 0) + 3,
      });
    }
  } catch {
    // Image extraction failed — continue without images
  }

  // 6. Page orientation
  const ps = ws.pageSetup || {};
  const orientation: "portrait" | "landscape" =
    ps.orientation === "landscape" ? "landscape" : "portrait";

  // 7. Detect header row
  let headerRowIndex: number | null = null;

  if (ps.printTitlesRow) {
    const pMatch = String(ps.printTitlesRow).match(/(\d+)/);
    if (pMatch) headerRowIndex = parseInt(pMatch[1]) - 1;
  }

  if (headerRowIndex === null) {
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const colored = rows[i].filter((c) => c.fillColor && !c.isMergedSlave).length;
      const withData = rows[i].filter((c) => c.value.trim() !== "" && !c.isMergedSlave).length;
      if (colored >= 2 && withData >= 2) {
        headerRowIndex = i;
        break;
      }
    }
  }

  return {
    name: ws.name || "Sheet",
    rows,
    colWidths,
    rowHeights,
    orientation,
    headerRowIndex,
    colCount: maxCol,
    rowCount: maxRow,
    images,
  };
}

// ---------------------------------------------------------------------------
// Extract data from one SheetJS worksheet (.xls legacy)
// SheetJS community edition: values + formatted text, limited styles
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSheetFromXls(sheetName: string, sheet: any, XLSX: any): SheetData | null {
  const ref = sheet["!ref"];
  if (!ref) return null;

  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1; // 1-indexed
  const maxCol = range.e.c + 1;

  if (maxRow === 0 || maxCol === 0) return null;

  // Merge map from SheetJS
  const mergeMap = new Map<
    string,
    { master: boolean; rowSpan: number; colSpan: number }
  >();

  const xlsMerges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = sheet["!merges"] || [];
  for (const m of xlsMerges) {
    const sr = m.s.r + 1, sc = m.s.c + 1;
    const er = m.e.r + 1, ec = m.e.c + 1;
    mergeMap.set(`${sr},${sc}`, { master: true, rowSpan: er - sr + 1, colSpan: ec - sc + 1 });
    for (let r = sr; r <= er; r++) {
      for (let c = sc; c <= ec; c++) {
        if (r === sr && c === sc) continue;
        mergeMap.set(`${r},${c}`, { master: false, rowSpan: 0, colSpan: 0 });
      }
    }
  }

  // Column widths from SheetJS
  const colWidths: number[] = [];
  const colInfo: Array<{ wch?: number; wpx?: number }> = sheet["!cols"] || [];
  for (let c = 0; c < maxCol; c++) {
    const ci = colInfo[c];
    const w = ci?.wch ?? ci?.wpx ? (ci.wpx! * 0.75) : 8.43 * PAGE.EXCEL_CHAR_PT;
    colWidths.push(ci?.wch ? ci.wch * PAGE.EXCEL_CHAR_PT : w);
  }

  // Row heights
  const rowHeights: number[] = [];
  const rowInfo: Array<{ hpt?: number; hpx?: number }> = sheet["!rows"] || [];

  // Extract rows
  const rows: CellData[][] = [];

  for (let r = 0; r < maxRow; r++) {
    const ri = rowInfo[r];
    rowHeights.push(ri?.hpt ?? ri?.hpx ? (ri.hpx! * 0.75) : PAGE.DEFAULT_ROW_H * 0.75);

    const cells: CellData[] = [];
    for (let c = 0; c < maxCol; c++) {
      const mi = mergeMap.get(`${r + 1},${c + 1}`);

      if (mi && !mi.master) {
        cells.push(emptyCellData(true));
        continue;
      }

      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];

      if (!cell) {
        const cd = emptyCellData(false);
        cd.colSpan = mi?.colSpan || 1;
        cd.rowSpan = mi?.rowSpan || 1;
        cells.push(cd);
        continue;
      }

      // Use formatted text (cell.w) if available, else raw value
      let value = "";
      if (cell.w !== undefined) {
        value = cell.w;
      } else if (cell.v !== undefined) {
        value = String(cell.v);
      }

      // Detect number alignment
      const isNumber = cell.t === "n";
      const halign: CellData["halign"] = isNumber ? "right" : "left";

      cells.push({
        value,
        colSpan: mi?.colSpan || 1,
        rowSpan: mi?.rowSpan || 1,
        fillColor: null,      // SheetJS community: no style support
        textColor: null,
        fontStyle: "normal",
        fontSize: 11,
        halign,
        valign: "middle",
        borderTop: 0,
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        borderColorTop: null,
        borderColorBottom: null,
        borderColorLeft: null,
        borderColorRight: null,
        isMergedSlave: false,
      });
    }
    rows.push(cells);
  }

  // Detect header row
  let headerRowIndex: number | null = null;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const withData = rows[i].filter((c) => c.value.trim() !== "" && !c.isMergedSlave).length;
    // For XLS without styles, use first row with ≥3 non-empty cells as header
    if (withData >= 3 && i === 0) {
      headerRowIndex = 0;
      break;
    }
  }

  return {
    name: sheetName,
    rows,
    colWidths,
    rowHeights,
    orientation: "portrait",
    headerRowIndex,
    colCount: maxCol,
    rowCount: maxRow,
    images: [],
  };
}

function emptyCellData(slave: boolean): CellData {
  return {
    value: "",
    colSpan: 1,
    rowSpan: 1,
    fillColor: null,
    textColor: null,
    fontStyle: "normal",
    fontSize: PAGE.DEFAULT_FONT,
    halign: "left",
    valign: "middle",
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    borderRight: 0,
    borderColorTop: null,
    borderColorBottom: null,
    borderColorLeft: null,
    borderColorRight: null,
    isMergedSlave: slave,
  };
}

// ---------------------------------------------------------------------------
// Render one sheet to the jsPDF document
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderSheet(doc: any, autoTable: any, sd: SheetData, first: boolean): void {
  const landscape = sd.orientation === "landscape";
  const pageW = landscape ? PAGE.A4_H : PAGE.A4_W;
  const availW = pageW - PAGE.MARGIN * 2;

  if (!first) {
    doc.addPage("a4", landscape ? "landscape" : "portrait");
  }

  // Scale factor — shrink-only
  const totalW = sd.colWidths.reduce((a, b) => a + b, 0);
  const scale = Math.min(1.0, availW / totalW);
  const baseFontPt = Math.max(PAGE.MIN_FONT, Math.round(PAGE.DEFAULT_FONT * scale));
  const colW = sd.colWidths.map((w) => Math.max(6, w * scale));

  // ---- Convert CellData row → autotable row format ----
  const toRow = (row: CellData[]) =>
    row.map((c) => {
      if (c.isMergedSlave) return "";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s: any = {
        fontSize: Math.max(PAGE.MIN_FONT, Math.round(c.fontSize * scale * 0.82)),
        fontStyle: c.fontStyle,
        halign: c.halign,
        valign: c.valign,
        cellPadding: { top: 1.5, right: 2.5, bottom: 1.5, left: 2.5 },
        overflow: "linebreak" as const,
      };

      const lw = {
        top: c.borderTop > 0 ? c.borderTop * scale : 0,
        bottom: c.borderBottom > 0 ? c.borderBottom * scale : 0,
        left: c.borderLeft > 0 ? c.borderLeft * scale : 0,
        right: c.borderRight > 0 ? c.borderRight * scale : 0,
      };
      if (lw.top || lw.bottom || lw.left || lw.right) {
        s.lineWidth = lw;
        s.lineColor =
          c.borderColorBottom || c.borderColorTop ||
          c.borderColorLeft || c.borderColorRight || [0, 0, 0];
      } else {
        s.lineWidth = 0;
      }

      if (c.fillColor) s.fillColor = c.fillColor;
      if (c.textColor) s.textColor = c.textColor;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry: any = { content: c.value, styles: s };
      if (c.colSpan > 1) entry.colSpan = c.colSpan;
      if (c.rowSpan > 1) entry.rowSpan = c.rowSpan;
      return entry;
    });

  // ---- Split rows: pre-header / header / body ----
  const hIdx = sd.headerRowIndex;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let head: any[][] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any[][];
  let startY = PAGE.MARGIN;
  let bodyStartOrigRow = 0; // original row index where body starts

  if (hIdx !== null && hIdx >= 0 && hIdx < sd.rows.length) {
    const preRows = sd.rows.slice(0, hIdx);
    head = [toRow(sd.rows[hIdx])];
    body = sd.rows.slice(hIdx + 1).map(toRow);
    bodyStartOrigRow = hIdx + 1;

    if (preRows.length > 0) {
      autoTable(doc, {
        body: preRows.map(toRow),
        startY,
        theme: "plain",
        showHead: "never" as const,
        tableWidth: "wrap" as const,
        margin: { left: PAGE.MARGIN, right: PAGE.MARGIN },
        styles: {
          fontSize: baseFontPt,
          cellPadding: { top: 1, right: 2.5, bottom: 1, left: 2.5 },
          lineWidth: 0,
          overflow: "linebreak" as const,
        },
        columnStyles: Object.fromEntries(
          colW.map((w, i) => [String(i), { cellWidth: w }])
        ),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      startY = (doc as any).lastAutoTable?.finalY ?? startY + preRows.length * 14;
    }
  } else {
    body = sd.rows.map(toRow);
  }

  // ---- Image overlay via didDrawCell ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const didDrawCell = sd.images.length > 0 ? (data: any) => {
    if (data.section !== "body") return;

    const origRow = bodyStartOrigRow + data.row.index;
    const origCol = data.column.index;

    for (const img of sd.images) {
      if (img.tlRow === origRow && img.tlCol === origCol) {
        // Calculate image width from spanned columns
        let imgW = 0;
        for (let c = img.tlCol; c <= img.brCol && c < colW.length; c++) {
          imgW += colW[c];
        }
        // Calculate image height from spanned rows
        let imgH = 0;
        for (let r = img.tlRow; r <= img.brRow && r < sd.rowHeights.length; r++) {
          imgH += sd.rowHeights[r] * scale;
        }
        // Clamp to reasonable bounds
        imgW = Math.min(imgW, data.cell.width * 3);
        imgH = Math.min(imgH, 300);

        if (imgW > 0 && imgH > 0) {
          try {
            doc.addImage(
              img.dataUrl,
              img.format,
              data.cell.x + 2,
              data.cell.y + 2,
              imgW - 4,
              imgH - 4
            );
          } catch {
            // Image embed failed — skip silently
          }
        }
      }
    }
  } : undefined;

  // ---- Main table ----
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: any = {
    head,
    body,
    startY,
    theme: "plain",
    showHead: head ? ("everyPage" as const) : ("never" as const),
    tableWidth: "wrap" as const,
    margin: {
      left: PAGE.MARGIN,
      right: PAGE.MARGIN,
      top: PAGE.MARGIN,
      bottom: PAGE.MARGIN,
    },
    styles: {
      fontSize: baseFontPt,
      cellPadding: { top: 1.5, right: 2.5, bottom: 1.5, left: 2.5 },
      lineWidth: 0,
      overflow: "linebreak" as const,
    },
    headStyles: {
      fontStyle: "bold" as const,
    },
    columnStyles: Object.fromEntries(
      colW.map((w, i) => [String(i), { cellWidth: w }])
    ),
    pageBreak: "auto" as const,
    rowPageBreak: "avoid" as const,
  };

  if (didDrawCell) opts.didDrawCell = didDrawCell;

  autoTable(doc, opts);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function convertExcelToPdf(
  file: File,
  onProgress: OnProgress
): Promise<ExcelToPdfResult> {
  const originalSize = file.size;
  const isXls = /\.xls$/i.test(file.name) && !/\.xlsx$/i.test(file.name);

  // 1. Load libraries
  onProgress({ progress: 5, status: "Loading libraries..." });

  const loadPromises: Promise<unknown>[] = [getJsPDF(), getAutoTable()];
  if (isXls) {
    loadPromises.push(getXLSX());
  } else {
    loadPromises.push(getExcelJS());
  }

  const [JsPDF, autoTable, lib] = await Promise.all(loadPromises);

  // 2. Read file
  onProgress({ progress: 10, status: "Reading Excel file..." });
  const buf = await file.arrayBuffer();

  let sheets: SheetData[] = [];

  if (isXls) {
    // ---- .xls path via SheetJS ----
    const XLSX = lib;
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetNames: string[] = wb.SheetNames || [];

    if (sheetNames.length === 0) throw new Error("No worksheets found in the .xls file.");

    for (let i = 0; i < sheetNames.length; i++) {
      const pct = 15 + Math.round((i / sheetNames.length) * 35);
      onProgress({
        progress: pct,
        status: `Analyzing sheet ${i + 1}/${sheetNames.length}: ${sheetNames[i]}...`,
      });

      const sheet = wb.Sheets[sheetNames[i]];
      const data = extractSheetFromXls(sheetNames[i], sheet, XLSX);
      if (data) sheets.push(data);
    }
  } else {
    // ---- .xlsx path via ExcelJS ----
    const ExcelJS = lib;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const wsCount = wb.worksheets.length;
    if (wsCount === 0) throw new Error("No worksheets found in the Excel file.");

    for (let i = 0; i < wsCount; i++) {
      const ws = wb.worksheets[i];
      const pct = 15 + Math.round((i / wsCount) * 35);
      onProgress({
        progress: pct,
        status: `Analyzing sheet ${i + 1}/${wsCount}: ${ws.name}...`,
      });

      const data = extractSheet(ws, wb);
      if (data) sheets.push(data);
    }
  }

  if (sheets.length === 0) throw new Error("All worksheets are empty.");

  // 3. Create PDF and render each sheet
  const doc = new JsPDF({
    orientation: sheets[0].orientation,
    unit: "pt",
    format: "a4",
  });

  let rendered = 0;
  for (let i = 0; i < sheets.length; i++) {
    const pct = 55 + Math.round((i / sheets.length) * 40);
    onProgress({
      progress: pct,
      status: `Rendering sheet ${i + 1}/${sheets.length}: ${sheets[i].name}...`,
    });
    renderSheet(doc, autoTable, sheets[i], i === 0);
    rendered++;
  }

  // 4. Output
  onProgress({ progress: 98, status: "Generating PDF..." });
  const blob: Blob = doc.output("blob");
  const previewUrl = URL.createObjectURL(blob);
  const pageCount: number = doc.getNumberOfPages();

  // Quality score: 100% for xlsx (full styles), 70% base for xls (data only)
  const totalSheets = isXls
    ? sheets.length // from SheetJS
    : sheets.length; // from ExcelJS
  const baseScore = isXls ? 70 : 100;
  const qualityScore = Math.round(baseScore * (rendered / Math.max(1, totalSheets)));

  onProgress({ progress: 100, status: "Done!" });

  return {
    blob,
    previewUrl,
    originalSize,
    processedSize: blob.size,
    qualityScore,
    pageCount,
    sheetCount: rendered,
  };
}
