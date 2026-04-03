// ============================================================================
// Excel to PDF Converter — Client-Side
//
// Pipeline:
//   1. ExcelJS        → read .xlsx, extract cells, styles, merges
//   2. Format/Resolve → apply number formats, resolve theme colors
//   3. jspdf-autotable → render styled tables with auto-fit & pagination
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

interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
  rowHeights: number[];
  orientation: "portrait" | "landscape";
  headerRowIndex: number | null;
  colCount: number;
  rowCount: number;
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

  return null;
}

// ---------------------------------------------------------------------------
// Number & date formatting
// ---------------------------------------------------------------------------

function formatNumber(value: number, numFmt: string): string {
  if (!numFmt || numFmt === "General") {
    // Avoid floating-point noise for "whole" numbers stored as float
    if (Number.isInteger(value)) return String(value);
    return String(parseFloat(value.toPrecision(10)));
  }

  // Percentage: 0%, 0.00%, #.##%, etc.
  if (numFmt.includes("%")) {
    const pct = value * 100;
    const decMatch = numFmt.match(/0\.(0+)%/);
    const decimals = decMatch ? decMatch[1].length : 0;
    return `${pct.toFixed(decimals)}%`;
  }

  // Thousands separator: #,##0 or #,##0.00 etc.
  if (numFmt.includes("#,##0") || numFmt.includes("#,###")) {
    const isNeg = value < 0;
    const abs = Math.abs(value);
    const decMatch = numFmt.match(/#,##0\.(0+)/);
    const decimals = decMatch ? decMatch[1].length : 0;
    const fixed = abs.toFixed(decimals);
    const [intPart, decPart] = fixed.split(".");
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let result = decPart ? `${withSep}.${decPart}` : withSep;
    if (isNeg) {
      result = numFmt.includes("(") ? `(${result})` : `-${result}`;
    }
    return result;
  }

  // Fixed decimal: 0.00, 0.0, etc.
  const fixedMatch = numFmt.match(/^0\.(0+)$/);
  if (fixedMatch) return value.toFixed(fixedMatch[1].length);

  // Fallback
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(10)));
}

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, "0");
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
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
    if (result instanceof Date) return formatDate(result);
    return String(result);
  }

  // Rich text → concatenate
  if (typeof value === "object" && Array.isArray(value.richText)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return value.richText.map((rt: any) => rt.text || "").join("");
  }

  if (value instanceof Date) return formatDate(value);
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
// Extract all data from one worksheet
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSheet(ws: any): SheetData | null {
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

      // Slave cell inside a merge — placeholder
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

      // Background
      let fillColor: [number, number, number] | null = null;
      if (fill.type === "pattern" && fill.fgColor) {
        fillColor = resolveColor(fill.fgColor);
      }

      // Text color
      const textColor = resolveColor(font.color);

      // Font style
      const b = !!font.bold, it = !!font.italic;
      const fontStyle: CellData["fontStyle"] =
        b && it ? "bolditalic" : b ? "bold" : it ? "italic" : "normal";

      // Font size
      const fontSize = font.size || 11;

      // Alignment — numbers default to right, text to left
      let halign: CellData["halign"] = "left";
      if (align.horizontal === "center" || align.horizontal === "centerContinuous") {
        halign = "center";
      } else if (align.horizontal === "right") {
        halign = "right";
      } else if (!align.horizontal) {
        // Auto: numbers right, text left
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

      // Borders
      const bT = borderWidth(border.top?.style);
      const bB = borderWidth(border.bottom?.style);
      const bL = borderWidth(border.left?.style);
      const bR = borderWidth(border.right?.style);

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
        borderTop: bT,
        borderBottom: bB,
        borderLeft: bL,
        borderRight: bR,
        borderColorTop: resolveColor(border.top?.color),
        borderColorBottom: resolveColor(border.bottom?.color),
        borderColorLeft: resolveColor(border.left?.color),
        borderColorRight: resolveColor(border.right?.color),
        isMergedSlave: false,
      });
    }
    rows.push(cells);
  }

  // 5. Page orientation from page setup
  const ps = ws.pageSetup || {};
  const orientation: "portrait" | "landscape" =
    ps.orientation === "landscape" ? "landscape" : "portrait";

  // 6. Detect header row — first row (in top 5) with ≥2 background-colored cells
  let headerRowIndex: number | null = null;

  // Try print titles first
  if (ps.printTitlesRow) {
    const pMatch = String(ps.printTitlesRow).match(/(\d+)/);
    if (pMatch) headerRowIndex = parseInt(pMatch[1]) - 1;
  }

  if (headerRowIndex === null) {
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const colored = rows[i].filter(
        (c) => c.fillColor && !c.isMergedSlave
      ).length;
      const withData = rows[i].filter(
        (c) => c.value.trim() !== "" && !c.isMergedSlave
      ).length;
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

  // New page for non-first sheets
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

      // Per-side borders
      const lw = {
        top: c.borderTop > 0 ? c.borderTop * scale : 0,
        bottom: c.borderBottom > 0 ? c.borderBottom * scale : 0,
        left: c.borderLeft > 0 ? c.borderLeft * scale : 0,
        right: c.borderRight > 0 ? c.borderRight * scale : 0,
      };
      if (lw.top || lw.bottom || lw.left || lw.right) {
        s.lineWidth = lw;
        // Use the most prominent border color, fallback black
        s.lineColor =
          c.borderColorBottom ||
          c.borderColorTop ||
          c.borderColorLeft ||
          c.borderColorRight ||
          [0, 0, 0];
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

  if (hIdx !== null && hIdx >= 0 && hIdx < sd.rows.length) {
    const preRows = sd.rows.slice(0, hIdx);
    head = [toRow(sd.rows[hIdx])];
    body = sd.rows.slice(hIdx + 1).map(toRow);

    // Render pre-header rows as a separate mini-table
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

  // ---- Main table ----
  autoTable(doc, {
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
  });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function convertExcelToPdf(
  file: File,
  onProgress: OnProgress
): Promise<ExcelToPdfResult> {
  const originalSize = file.size;

  // 1. Load libraries in parallel
  onProgress({ progress: 5, status: "Loading libraries..." });
  const [JsPDF, autoTable, ExcelJS] = await Promise.all([
    getJsPDF(),
    getAutoTable(),
    getExcelJS(),
  ]);

  // 2. Read Excel file
  onProgress({ progress: 10, status: "Reading Excel file..." });
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const wsCount = wb.worksheets.length;
  if (wsCount === 0) throw new Error("No worksheets found in the Excel file.");

  // 3. Extract data from all sheets
  const sheets: SheetData[] = [];
  for (let i = 0; i < wsCount; i++) {
    const ws = wb.worksheets[i];
    const pct = 15 + Math.round((i / wsCount) * 35);
    onProgress({
      progress: pct,
      status: `Analyzing sheet ${i + 1}/${wsCount}: ${ws.name}...`,
    });

    const data = extractSheet(ws);
    if (data) sheets.push(data);
  }

  if (sheets.length === 0) throw new Error("All worksheets are empty.");

  // 4. Create PDF and render each sheet
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

  // 5. Output
  onProgress({ progress: 98, status: "Generating PDF..." });
  const blob: Blob = doc.output("blob");
  const previewUrl = URL.createObjectURL(blob);
  const pageCount: number = doc.getNumberOfPages();

  const qualityScore = Math.round((rendered / wsCount) * 100);

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
