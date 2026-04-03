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
let _JSZip: any = null;
async function getJSZip() {
  if (_JSZip) return _JSZip;
  const mod = await import("jszip");
  _JSZip = mod.default;
  return _JSZip;
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

interface ParsedChart {
  type: "bar" | "line" | "pie" | "scatter" | "area" | "doughnut";
  title: string;
  categories: string[];
  series: { name: string; values: number[]; color: string }[];
}

interface ChartOnSheet {
  chart: ParsedChart;
  tlRow: number;
  tlCol: number;
  brRow: number;
  brCol: number;
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

// Default Excel chart series colors (Office theme accents)
const CHART_COLORS = [
  "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47",
  "#264478", "#9B4D1E", "#636363", "#997300", "#3A6EA5", "#4D8132",
];

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
// Chart extraction from xlsx (OpenXML)
// ---------------------------------------------------------------------------

// XML helper: get child element by local name
function xmlChild(el: Element, localName: string): Element | null {
  for (let i = 0; i < el.children.length; i++) {
    const ch = el.children[i];
    if (ch.localName === localName) return ch;
  }
  return null;
}

function xmlChildren(el: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i].localName === localName) result.push(el.children[i]);
  }
  return result;
}

function xmlAttr(el: Element, name: string): string {
  return el.getAttribute(name) || el.getAttribute(`val`) || "";
}

function xmlText(el: Element, path: string[]): string {
  let cur: Element | null = el;
  for (const p of path) {
    if (!cur) return "";
    cur = xmlChild(cur, p);
  }
  return cur?.textContent?.trim() || "";
}

function parseChartXml(xmlStr: string): ParsedChart | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlStr, "text/xml");
  const chartSpace = doc.documentElement;
  const chart = xmlChild(chartSpace, "chart");
  if (!chart) return null;

  // Title
  let title = "";
  const titleEl = xmlChild(chart, "title");
  if (titleEl) {
    const txBody = titleEl.querySelector("*|txBody, *|rich");
    if (txBody) {
      title = txBody.textContent?.trim() || "";
    } else {
      // Try strRef
      title = xmlText(titleEl, ["tx", "strRef", "strCache", "pt"]);
    }
  }

  // Plot area
  const plotArea = xmlChild(chart, "plotArea");
  if (!plotArea) return null;

  // Detect chart type — first matching element in plotArea
  type CType = ParsedChart["type"];
  const typeMap: Record<string, CType> = {
    barChart: "bar", bar3DChart: "bar",
    lineChart: "line", line3DChart: "line",
    pieChart: "pie", pie3DChart: "pie",
    scatterChart: "scatter",
    areaChart: "area", area3DChart: "area",
    doughnutChart: "doughnut",
    radarChart: "line",
  };

  let chartType: CType = "bar";
  let chartEl: Element | null = null;

  for (const [tag, type] of Object.entries(typeMap)) {
    chartEl = xmlChild(plotArea, tag);
    if (chartEl) {
      chartType = type;
      // Check bar direction
      if (tag.startsWith("bar")) {
        const dir = xmlChild(chartEl, "barDir");
        if (dir?.getAttribute("val") === "bar") chartType = "bar";
        else chartType = "bar"; // column = bar rendered vertically
      }
      break;
    }
  }

  if (!chartEl) return null;

  // Parse series
  const serElements = xmlChildren(chartEl, "ser");
  const series: ParsedChart["series"] = [];
  let categories: string[] = [];

  for (let si = 0; si < serElements.length; si++) {
    const ser = serElements[si];

    // Series name
    let name = `Series ${si + 1}`;
    const tx = xmlChild(ser, "tx");
    if (tx) {
      const strCache = tx.querySelector("*|strCache");
      if (strCache) {
        const pt = xmlChild(strCache, "pt");
        if (pt) name = xmlChild(pt, "v")?.textContent || name;
      }
    }

    // Categories (from first series only)
    if (categories.length === 0) {
      const cat = xmlChild(ser, "cat");
      if (cat) {
        const cache = cat.querySelector("*|strCache") || cat.querySelector("*|numCache");
        if (cache) {
          const pts = xmlChildren(cache, "pt");
          categories = pts.map((pt) => xmlChild(pt, "v")?.textContent || "").filter(Boolean);
        }
      }
    }

    // Values
    const val = xmlChild(ser, "val") || xmlChild(ser, "yVal");
    const values: number[] = [];
    if (val) {
      const numCache = val.querySelector("*|numCache");
      if (numCache) {
        const pts = xmlChildren(numCache, "pt");
        // Sort by idx attribute
        const sorted = pts.slice().sort((a, b) => {
          return parseInt(a.getAttribute("idx") || "0") - parseInt(b.getAttribute("idx") || "0");
        });
        for (const pt of sorted) {
          const v = xmlChild(pt, "v")?.textContent;
          values.push(v ? parseFloat(v) : 0);
        }
      }
    }

    // Color — look for solidFill in spPr
    let color = CHART_COLORS[si % CHART_COLORS.length];
    const spPr = xmlChild(ser, "spPr");
    if (spPr) {
      const fill = spPr.querySelector("*|solidFill *|srgbClr");
      if (fill) {
        const clr = fill.getAttribute("val");
        if (clr) color = `#${clr}`;
      }
    }

    series.push({ name, values, color });
  }

  // Ensure categories array length matches values
  if (categories.length === 0 && series.length > 0) {
    categories = series[0].values.map((_, i) => String(i + 1));
  }

  return { type: chartType, title, categories, series };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractChartsFromXlsx(buf: ArrayBuffer): Promise<Map<number, ChartOnSheet[]>> {
  const result = new Map<number, ChartOnSheet[]>();
  let JSZip;
  try {
    JSZip = await getJSZip();
  } catch {
    return result;
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return result;
  }

  // 1. Map sheet files → drawing files via worksheet rels
  const sheetToDrawing = new Map<number, string>(); // sheetNum → drawingFile
  for (let sn = 1; sn <= 100; sn++) {
    const relsPath = `xl/worksheets/_rels/sheet${sn}.xml.rels`;
    const relsFile = zip.file(relsPath);
    if (!relsFile) continue;
    const relsXml = await relsFile.async("text");
    const parser = new DOMParser();
    const doc = parser.parseFromString(relsXml, "text/xml");
    const rels = doc.querySelectorAll("Relationship");
    for (let i = 0; i < rels.length; i++) {
      const type = rels[i].getAttribute("Type") || "";
      if (type.includes("/drawing")) {
        const target = rels[i].getAttribute("Target") || "";
        // target is like "../drawings/drawing13.xml"
        const match = target.match(/drawing(\d+)\.xml/);
        if (match) sheetToDrawing.set(sn, `drawing${match[1]}`);
      }
    }
  }

  // 2. For each drawing with charts, parse chart positions
  for (const [sheetNum, drawingName] of sheetToDrawing) {
    const drawingPath = `xl/drawings/${drawingName}.xml`;
    const drawingFile = zip.file(drawingPath);
    if (!drawingFile) continue;

    // Parse drawing rels to map rId → chart filename
    const drawRelsPath = `xl/drawings/_rels/${drawingName}.xml.rels`;
    const drawRelsFile = zip.file(drawRelsPath);
    if (!drawRelsFile) continue;

    const relsXml = await drawRelsFile.async("text");
    const relsDoc = new DOMParser().parseFromString(relsXml, "text/xml");
    const ridToChart = new Map<string, string>();
    const rels = relsDoc.querySelectorAll("Relationship");
    for (let i = 0; i < rels.length; i++) {
      const type = rels[i].getAttribute("Type") || "";
      if (type.includes("/chart")) {
        const rId = rels[i].getAttribute("Id") || "";
        const target = rels[i].getAttribute("Target") || "";
        ridToChart.set(rId, target.replace("../charts/", "").replace("../", ""));
      }
    }

    if (ridToChart.size === 0) continue;

    // Parse drawing XML for chart anchors
    const drawXml = await drawingFile.async("text");
    const drawDoc = new DOMParser().parseFromString(drawXml, "text/xml");

    // Find twoCellAnchor elements containing graphicFrame with chart
    const anchors = drawDoc.querySelectorAll("*|twoCellAnchor");
    const charts: ChartOnSheet[] = [];

    for (let a = 0; a < anchors.length; a++) {
      const anchor = anchors[a];
      // Look for chart reference
      const graphicData = anchor.querySelector("*|graphicData");
      if (!graphicData) continue;
      const uri = graphicData.getAttribute("uri") || "";
      if (!uri.includes("chart")) continue;

      // Get rId from the chart element inside graphicData
      const chartRef = graphicData.querySelector("*|chart");
      if (!chartRef) continue;
      const rId = chartRef.getAttribute("r:id") || chartRef.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"
      ) || "";
      const chartFile = ridToChart.get(rId);
      if (!chartFile) continue;

      // Get position
      const from = anchor.querySelector("*|from");
      const to = anchor.querySelector("*|to");
      if (!from || !to) continue;

      const tlCol = parseInt(from.querySelector("*|col")?.textContent || "0");
      const tlRow = parseInt(from.querySelector("*|row")?.textContent || "0");
      const brCol = parseInt(to.querySelector("*|col")?.textContent || "0");
      const brRow = parseInt(to.querySelector("*|row")?.textContent || "0");

      // Parse chart XML
      const chartPath = `xl/charts/${chartFile}`;
      const chartZipFile = zip.file(chartPath);
      if (!chartZipFile) continue;

      const chartXml = await chartZipFile.async("text");
      const parsed = parseChartXml(chartXml);
      if (!parsed || parsed.series.length === 0) continue;

      charts.push({ chart: parsed, tlRow, tlCol, brRow, brCol });
    }

    if (charts.length > 0) {
      result.set(sheetNum, charts);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Canvas chart renderer
// ---------------------------------------------------------------------------

function renderChartToDataUrl(chart: ParsedChart, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  // Layout
  const titleH = chart.title ? 28 : 5;
  const legendH = Math.min(30, chart.series.length * 15 + 10);
  const pad = { top: 8 + titleH, right: 15, bottom: 30 + legendH, left: 65 };

  // Title
  if (chart.title) {
    ctx.fillStyle = "#333333";
    ctx.font = "bold 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(chart.title, w / 2, 18, w - 20);
  }

  const px = pad.left, py = pad.top;
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  if (chart.type === "pie" || chart.type === "doughnut") {
    drawPieChart(ctx, chart, px, py, pw, ph);
  } else {
    drawAxisChart(ctx, chart, px, py, pw, ph);
  }

  // Legend
  drawLegend(ctx, chart.series, 10, h - legendH + 5, w - 20, legendH);

  return canvas.toDataURL("image/png");
}

function drawAxisChart(
  ctx: CanvasRenderingContext2D,
  chart: ParsedChart,
  x: number, y: number, w: number, h: number
) {
  const { categories, series, type } = chart;
  if (series.length === 0) return;

  // Value range
  let minV = 0, maxV = 0;
  for (const s of series) for (const v of s.values) {
    if (v > maxV) maxV = v;
    if (v < minV) minV = v;
  }
  if (minV > 0) minV = 0;
  const range = maxV - minV || 1;

  // Y-axis gridlines + labels
  const steps = 5;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= steps; i++) {
    const yy = y + h - (i / steps) * h;
    ctx.strokeStyle = "#E8E8E8";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + w, yy);
    ctx.stroke();

    const val = minV + (i / steps) * range;
    ctx.fillStyle = "#888";
    ctx.font = "8px Arial, sans-serif";
    ctx.fillText(fmtAxisVal(val), x - 4, yy);
  }

  // Axes
  ctx.strokeStyle = "#CCC";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();

  const catCount = categories.length || 1;

  if (type === "bar") {
    // Bar / column chart
    const catW = w / catCount;
    const serCount = series.length;
    const barW = (catW * 0.7) / serCount;
    const off = catW * 0.15;

    for (let c = 0; c < catCount; c++) {
      for (let s = 0; s < serCount; s++) {
        const val = series[s].values[c] ?? 0;
        const barH = ((val - minV) / range) * h;
        const bx = x + c * catW + off + s * barW;
        const baseY = y + h - ((0 - minV) / range) * h;
        const by = val >= 0 ? baseY - barH + ((0 - minV) / range) * h : baseY;
        const bh = Math.abs(barH - ((0 - minV) / range) * h);

        ctx.fillStyle = series[s].color;
        ctx.fillRect(bx, y + h - ((Math.max(val, 0) - minV) / range) * h, barW - 1, (Math.abs(val) / range) * h);
      }
      // Category label
      ctx.fillStyle = "#666";
      ctx.font = "8px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = categories[c] || "";
      ctx.fillText(label.length > 10 ? label.slice(0, 10) + "…" : label, x + c * catW + catW / 2, y + h + 3);
    }
  } else if (type === "line" || type === "area") {
    const catW = w / Math.max(catCount - 1, 1);

    for (let s = 0; s < series.length; s++) {
      const vals = series[s].values;
      ctx.strokeStyle = series[s].color;
      ctx.fillStyle = series[s].color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let c = 0; c < vals.length; c++) {
        const cx = x + c * catW;
        const cy = y + h - ((vals[c] - minV) / range) * h;
        if (c === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();

      // Area fill
      if (type === "area") {
        ctx.lineTo(x + (vals.length - 1) * catW, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // Markers
      for (let c = 0; c < vals.length; c++) {
        const cx = x + c * catW;
        const cy = y + h - ((vals[c] - minV) / range) * h;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // X labels
    for (let c = 0; c < catCount; c++) {
      const cx = x + c * catW;
      ctx.fillStyle = "#666";
      ctx.font = "8px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = categories[c] || "";
      ctx.fillText(label.length > 10 ? label.slice(0, 10) + "…" : label, cx, y + h + 3);
    }
  } else if (type === "scatter") {
    // Scatter: use first series values as X, second as Y (or index as X)
    for (let s = 0; s < series.length; s++) {
      ctx.fillStyle = series[s].color;
      for (let c = 0; c < series[s].values.length; c++) {
        const vx = x + (c / Math.max(series[s].values.length - 1, 1)) * w;
        const vy = y + h - ((series[s].values[c] - minV) / range) * h;
        ctx.beginPath();
        ctx.arc(vx, vy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawPieChart(
  ctx: CanvasRenderingContext2D,
  chart: ParsedChart,
  x: number, y: number, w: number, h: number
) {
  const values = chart.series[0]?.values || [];
  const total = values.reduce((a, b) => a + Math.abs(b), 0) || 1;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2 - 5;
  const innerR = chart.type === "doughnut" ? r * 0.5 : 0;

  let startAngle = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const slice = (Math.abs(values[i]) / total) * Math.PI * 2;
    const color = chart.series[0]?.color
      ? (i === 0 ? chart.series[0].color : CHART_COLORS[i % CHART_COLORS.length])
      : CHART_COLORS[i % CHART_COLORS.length];

    // If each value is a separate "series" in pie
    const clr = chart.series.length > 1
      ? chart.series[i]?.color || CHART_COLORS[i % CHART_COLORS.length]
      : CHART_COLORS[i % CHART_COLORS.length];

    ctx.fillStyle = clr;
    ctx.beginPath();
    ctx.moveTo(cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle));
    ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    if (innerR > 0) {
      ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true);
    } else {
      ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.fill();

    // Label
    const midAngle = startAngle + slice / 2;
    const labelR = r * 0.7;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);
    const pct = ((Math.abs(values[i]) / total) * 100).toFixed(0);
    if (parseFloat(pct) >= 3) {
      ctx.fillStyle = "#FFF";
      ctx.font = "bold 9px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${pct}%`, lx, ly);
    }

    startAngle += slice;
  }
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  series: ParsedChart["series"],
  x: number, y: number, w: number, _h: number
) {
  ctx.font = "8px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cx = x;
  for (let i = 0; i < series.length; i++) {
    const label = series[i].name;
    const boxW = 10;
    const textW = ctx.measureText(label).width;
    if (cx + boxW + textW + 15 > x + w) {
      // Would overflow — skip remaining
      break;
    }
    ctx.fillStyle = series[i].color;
    ctx.fillRect(cx, y, boxW, boxW);
    ctx.fillStyle = "#555";
    ctx.fillText(label, cx + boxW + 3, y + boxW / 2);
    cx += boxW + textW + 15;
  }
}

function fmtAxisVal(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e12) return (v / 1e12).toFixed(1) + "T";
  if (abs >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return (v / 1e3).toFixed(1) + "K";
  if (abs === 0) return "0";
  if (abs < 1) return v.toFixed(2);
  return v.toFixed(0);
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

    // Extract charts from the xlsx zip in parallel with sheet processing
    onProgress({ progress: 12, status: "Extracting charts..." });
    let chartMap = new Map<number, ChartOnSheet[]>();
    try {
      chartMap = await extractChartsFromXlsx(buf);
    } catch {
      // Chart extraction failed — continue without charts
    }

    for (let i = 0; i < wsCount; i++) {
      const ws = wb.worksheets[i];
      const pct = 15 + Math.round((i / wsCount) * 35);
      onProgress({
        progress: pct,
        status: `Analyzing sheet ${i + 1}/${wsCount}: ${ws.name}...`,
      });

      const data = extractSheet(ws, wb);
      if (data) {
        // Inject chart images for this sheet (sheetNum is 1-indexed)
        const sheetCharts = chartMap.get(i + 1);
        if (sheetCharts && sheetCharts.length > 0) {
          for (const sc of sheetCharts) {
            try {
              const chartW = Math.max(400, (sc.brCol - sc.tlCol) * 60);
              const chartH = Math.max(300, (sc.brRow - sc.tlRow) * 20);
              const dataUrl = renderChartToDataUrl(sc.chart, chartW, chartH);
              data.images.push({
                dataUrl,
                format: "PNG",
                tlRow: sc.tlRow,
                tlCol: sc.tlCol,
                brRow: sc.brRow,
                brCol: sc.brCol,
              });
            } catch {
              // Individual chart render failed — skip
            }
          }
        }
        sheets.push(data);
      }
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
