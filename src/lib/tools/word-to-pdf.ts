// ============================================================================
// Word to PDF Converter — Direct DOCX-to-PDF Rendering
//
// Pipeline:
//   1. JSZip     → unpack DOCX (document.xml, _rels/, media/)
//   2. DOMParser → parse OOXML into a paragraph / run / image model
//   3. Canvas    → crop images per srcRect before embedding
//   4. jsPDF     → render vector text + embedded PNG images directly
//
// No html2canvas — all text is PDF vector text; all images are PNG (FlateDecode).
// ============================================================================

// ---------------------------------------------------------------------------
// Lazy loaders
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _JsPDF: any = null;
async function getJsPDF() {
  if (_JsPDF) return _JsPDF;
  const mod = await import("jspdf");
  _JsPDF = mod.default;
  return _JsPDF;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _JSZip: any = null;
async function getJSZip() {
  if (_JSZip) return _JSZip;
  const mod = await import("jszip");
  _JSZip = mod.default;
  return _JSZip;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProcessingUpdate {
  progress: number;
  status: string;
  currentPage?: number;
  totalPages?: number;
}

export interface WordToPdfResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  qualityScore: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Internal document model
// ---------------------------------------------------------------------------

interface DocxRun {
  kind: "run";
  text: string;
  bold: boolean;
  italic: boolean;
  fontSizePt: number;
  colorHex: string; // "000000" default
}

interface DocxImage {
  kind: "image";
  rId: string;
  widthEmu: number;  // displayed size (from wp:extent)
  heightEmu: number;
  srcRectT: number;  // per-mille crop values (0–100000)
  srcRectB: number;
  srcRectL: number;
  srcRectR: number;
}

interface DocxPageBreak {
  kind: "pageBreak";
}

type DocxItem = DocxRun | DocxImage | DocxPageBreak;

interface DocxParagraph {
  items: DocxItem[];
  alignment: "left" | "center" | "right" | "justify";
  spacingBeforePt: number;
  spacingAfterPt: number;
  lineSpacingMult: number; // multiplier on font size, e.g. 1.15
  indentLeftPt: number;
  indentHangingPt: number; // positive = first-line pulls LEFT; negative = first-line indent right
}

interface DocxData {
  paragraphs: DocxParagraph[];
  imageRels: Record<string, string>;   // rId → "media/image1.png"
  imageBlobs: Record<string, Blob>;    // "media/image1.png" → Blob
  pageWidthPt: number;
  pageHeightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginRightPt: number;
  defaultFontSizePt: number;
}

// ---------------------------------------------------------------------------
// Conversion constants
// ---------------------------------------------------------------------------

const EMU_PER_PT  = 12700; // 914400 EMU/inch ÷ 72 pt/inch
const TWIPS_PER_PT = 20;   // 1440 twips/inch ÷ 72 pt/inch

// OOXML namespaces
const W_NS  = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A_NS  = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/** Returns the first direct child element with matching namespace + localName. */
function firstChild(parent: Element | Document, ns: string, localName: string): Element | null {
  const kids = parent.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i] as Element;
    if (n.nodeType === 1 && n.localName === localName && n.namespaceURI === ns) return n;
  }
  return null;
}

/** Read a w:-namespaced attribute, trying both NS-qualified and prefix-qualified forms. */
function wAttr(el: Element, attr: string): string {
  return el.getAttributeNS(W_NS, attr) ?? el.getAttribute("w:" + attr) ?? "";
}

// ---------------------------------------------------------------------------
// DOCX parser
// ---------------------------------------------------------------------------

async function parseDocx(file: File): Promise<DocxData> {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlParser = new DOMParser();

  // --- document.xml ---
  const docXmlStr = await zip.file("word/document.xml")?.async("string");
  if (!docXmlStr) throw new Error("Invalid DOCX: missing word/document.xml");
  const docXml = xmlParser.parseFromString(docXmlStr, "text/xml");

  // --- image relationships ---
  const relsXmlStr = await zip.file("word/_rels/document.xml.rels")?.async("string");
  const imageRels: Record<string, string> = {};
  if (relsXmlStr) {
    const relsXml = xmlParser.parseFromString(relsXmlStr, "text/xml");
    for (const rel of Array.from(relsXml.getElementsByTagName("Relationship"))) {
      const id     = rel.getAttribute("Id") ?? "";
      const target = rel.getAttribute("Target") ?? "";
      const type   = rel.getAttribute("Type") ?? "";
      if (id && target && type.includes("image")) {
        imageRels[id] = target; // e.g. "media/image1.png"
      }
    }
  }

  // --- load image blobs ---
  const imageBlobs: Record<string, Blob> = {};
  for (const target of Object.values(imageRels)) {
    const entry = zip.file("word/" + target);
    if (entry) {
      const bytes = await entry.async("uint8array");
      const ext  = target.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      imageBlobs[target] = new Blob([bytes], { type: mime });
    }
  }

  // --- page layout from sectPr ---
  let pageWidthPt  = 595.28; // A4 defaults
  let pageHeightPt = 841.89;
  let marginTopPt = 72, marginBottomPt = 72, marginLeftPt = 72, marginRightPt = 72;
  let defaultFontSizePt = 11;

  const docEl = docXml.documentElement; // <w:document>
  const body = firstChild(docEl, W_NS, "body");
  if (body) {
    const sectPr = firstChild(body, W_NS, "sectPr");
    if (sectPr) {
      const pgSz  = firstChild(sectPr, W_NS, "pgSz");
      const pgMar = firstChild(sectPr, W_NS, "pgMar");
      if (pgSz) {
        const w = parseInt(wAttr(pgSz, "w") || "0");
        const h = parseInt(wAttr(pgSz, "h") || "0");
        if (w > 0) pageWidthPt  = w / TWIPS_PER_PT;
        if (h > 0) pageHeightPt = h / TWIPS_PER_PT;
      }
      if (pgMar) {
        const top    = parseInt(wAttr(pgMar, "top")    || "1440");
        const bottom = parseInt(wAttr(pgMar, "bottom") || "1440");
        const left   = parseInt(wAttr(pgMar, "left")   || "1440");
        const right  = parseInt(wAttr(pgMar, "right")  || "1440");
        marginTopPt    = top    / TWIPS_PER_PT;
        marginBottomPt = bottom / TWIPS_PER_PT;
        marginLeftPt   = left   / TWIPS_PER_PT;
        marginRightPt  = right  / TWIPS_PER_PT;
      }
    }
  }

  // --- default font size from styles.xml ---
  const stylesXmlStr = await zip.file("word/styles.xml")?.async("string");
  if (stylesXmlStr) {
    const stylesXml = xmlParser.parseFromString(stylesXmlStr, "text/xml");
    const szEls = stylesXml.getElementsByTagNameNS(W_NS, "sz");
    if (szEls.length > 0) {
      const val = parseInt(wAttr(szEls[0] as Element, "val") || "22");
      if (val > 0) defaultFontSizePt = val / 2;
    }
  }

  // --- parse body paragraphs ---
  const paragraphs: DocxParagraph[] = [];
  if (body) {
    for (const child of Array.from(body.children as HTMLCollectionOf<Element>)) {
      if (child.localName === "p" && child.namespaceURI === W_NS) {
        paragraphs.push(parseParagraph(child as Element, defaultFontSizePt));
      }
      // Tables and other elements skipped
    }
  }

  return {
    paragraphs, imageRels, imageBlobs,
    pageWidthPt, pageHeightPt,
    marginTopPt, marginBottomPt, marginLeftPt, marginRightPt,
    defaultFontSizePt,
  };
}

// Font-specific "single" line spacing multipliers.
// Word calculates "Single" line height from the font's OS/2 metrics
// (usWinAscent + usWinDescent) / unitsPerEm × pointSize.
// Segoe UI has unusually large OS/2 values → ~1.44× at 11pt (empirically measured
// from benchmark PDF: 15.8pt line height / 11pt font = 1.436×).
const FONT_LINE_SPACING: Record<string, number> = {
  "Segoe UI": 1.44,
  "Segoe UI Light": 1.44,
  "Segoe UI Semibold": 1.44,
};
const DEFAULT_LINE_SPACING = 1.15;

/** Look up the appropriate "Single" line spacing for a given font name. */
function getFontLineSpacing(fontName: string): number {
  return FONT_LINE_SPACING[fontName] ?? DEFAULT_LINE_SPACING;
}

function parseParagraph(pEl: Element, defaultFontSizePt: number): DocxParagraph {
  const para: DocxParagraph = {
    items: [],
    alignment: "justify",
    spacingBeforePt: 0,
    spacingAfterPt: 0,
    lineSpacingMult: DEFAULT_LINE_SPACING,
    indentLeftPt: 0,
    indentHangingPt: 0,
  };

  // Paragraph properties
  const pPr = firstChild(pEl, W_NS, "pPr");
  if (pPr) {
    const jc = firstChild(pPr, W_NS, "jc");
    if (jc) {
      const v = wAttr(jc, "val");
      if      (v === "center")                  para.alignment = "center";
      else if (v === "right" || v === "end")    para.alignment = "right";
      else if (v === "left"  || v === "start")  para.alignment = "left";
      else                                       para.alignment = "justify";
    }

    // Read paragraph-mark font name to determine "Single" line spacing
    // (used when no explicit w:spacing w:line is present)
    const pPrRPr = firstChild(pPr, W_NS, "rPr");
    let paraMarkFont = "";
    if (pPrRPr) {
      const rFonts = firstChild(pPrRPr, W_NS, "rFonts");
      if (rFonts) {
        paraMarkFont = rFonts.getAttributeNS(W_NS, "ascii") ?? rFonts.getAttribute("w:ascii") ?? "";
      }
    }
    para.lineSpacingMult = getFontLineSpacing(paraMarkFont);

    const spacing = firstChild(pPr, W_NS, "spacing");
    if (spacing) {
      const before   = parseInt(wAttr(spacing, "before") || "0");
      const after    = parseInt(wAttr(spacing, "after")  || "0");
      const line     = parseInt(wAttr(spacing, "line")   || "0");
      const lineRule = wAttr(spacing, "lineRule");
      if (before >= 0) para.spacingBeforePt = before / TWIPS_PER_PT;
      if (after  >= 0) para.spacingAfterPt  = after  / TWIPS_PER_PT;
      if (line > 0) {
        // Explicit w:line overrides font-derived default
        para.lineSpacingMult = (lineRule === "exact" || lineRule === "atLeast")
          ? (line / TWIPS_PER_PT) / defaultFontSizePt
          : line / 240; // "auto": 240 = 1.0×, 276 = 1.15×
      }
    }
    const ind = firstChild(pPr, W_NS, "ind");
    if (ind) {
      const left      = parseInt(wAttr(ind, "left")      || "0");
      const hanging   = parseInt(wAttr(ind, "hanging")   || "0");
      const firstLine = parseInt(wAttr(ind, "firstLine") || "0");
      if (left > 0)      para.indentLeftPt    = left    / TWIPS_PER_PT;
      if (hanging > 0)   para.indentHangingPt = hanging / TWIPS_PER_PT;
      else if (firstLine > 0) para.indentHangingPt = -(firstLine / TWIPS_PER_PT);
    }
  }

  // Determine once whether this paragraph has ANY explicit column/page break.
  // If yes, lrpb elements are Word rendering hints and must be ignored to avoid
  // double page-breaks (P15/P30/P57/P73 have col_br and lrpb in separate runs).
  const hasExplicitBreak = Array.from(pEl.children).some(child => {
    if (child.localName !== "r" || child.namespaceURI !== W_NS) return false;
    const br = firstChild(child as Element, W_NS, "br");
    if (!br) return false;
    const t = wAttr(br as Element, "type");
    return t === "page" || t === "column";
  });

  // Runs
  for (const child of Array.from(pEl.children)) {
    if (child.localName !== "r" || child.namespaceURI !== W_NS) continue;
    const rEl = child as Element;

    // Explicit column / page break → insert PageBreakItem
    const brEl = firstChild(rEl, W_NS, "br");
    if (brEl) {
      const brType = wAttr(brEl, "type");
      if (brType === "page" || brType === "column") {
        para.items.push({ kind: "pageBreak" });
      }
    }

    // lastRenderedPageBreak — only when paragraph has NO explicit break anywhere.
    // This handles P96 (lrpb-only) while ignoring lrpb in P15/P30/P57/P73
    // which also carry an explicit col_br in a different run.
    const lrpb = firstChild(rEl, W_NS, "lastRenderedPageBreak");
    if (lrpb && !hasExplicitBreak) {
      para.items.push({ kind: "pageBreak" });
    }

    // Drawing (inline image)
    const drawingEl = firstChild(rEl, W_NS, "drawing");
    if (drawingEl) {
      const img = parseDrawing(drawingEl);
      if (img) para.items.push(img);
      continue; // a drawing run has no text
    }

    // Text runs
    const rPr = firstChild(rEl, W_NS, "rPr");
    let bold = false, italic = false;
    let fontSizePt = defaultFontSizePt;
    let colorHex = "000000";

    if (rPr) {
      const bEl = firstChild(rPr, W_NS, "b");
      if (bEl) {
        const v = wAttr(bEl, "val");
        bold = v !== "0" && v !== "false";
      }
      const iEl = firstChild(rPr, W_NS, "i");
      if (iEl) {
        const v = wAttr(iEl, "val");
        italic = v !== "0" && v !== "false";
      }
      const szEl = firstChild(rPr, W_NS, "sz");
      if (szEl) {
        const v = parseInt(wAttr(szEl, "val") || "22");
        if (v > 0) fontSizePt = v / 2;
      }
      const colorEl = firstChild(rPr, W_NS, "color");
      if (colorEl) {
        const v = wAttr(colorEl, "val");
        if (v && v !== "auto") colorHex = v;
      }
    }

    // All w:t children in this run (usually one)
    for (const tEl of Array.from(rEl.children)) {
      if (tEl.localName !== "t" || tEl.namespaceURI !== W_NS) continue;
      const text = tEl.textContent ?? "";
      if (text) {
        para.items.push({ kind: "run", text, bold, italic, fontSizePt, colorHex });
      }
    }
  }

  return para;
}

function parseDrawing(drawingEl: Element): DocxImage | null {
  const container =
    firstChild(drawingEl, WP_NS, "inline") ??
    firstChild(drawingEl, WP_NS, "anchor");
  if (!container) return null;

  const extentEl = firstChild(container, WP_NS, "extent");
  if (!extentEl) return null;

  const cx = parseInt(extentEl.getAttribute("cx") ?? "0");
  const cy = parseInt(extentEl.getAttribute("cy") ?? "0");
  if (cx <= 0 || cy <= 0) return null;

  // a:blip r:embed gives the relationship ID
  const blips = drawingEl.getElementsByTagNameNS(A_NS, "blip");
  if (!blips.length) return null;
  const blipEl = blips[0] as Element;
  const rId = blipEl.getAttributeNS(R_NS, "embed") ?? blipEl.getAttribute("r:embed") ?? "";
  if (!rId) return null;

  // a:srcRect — crop fractions in per-mille (0–100000)
  const srcRects = drawingEl.getElementsByTagNameNS(A_NS, "srcRect");
  let srcRectT = 0, srcRectB = 0, srcRectL = 0, srcRectR = 0;
  if (srcRects.length > 0) {
    const sr = srcRects[0] as Element;
    srcRectT = parseInt(sr.getAttribute("t") ?? "0");
    srcRectB = parseInt(sr.getAttribute("b") ?? "0");
    srcRectL = parseInt(sr.getAttribute("l") ?? "0");
    srcRectR = parseInt(sr.getAttribute("r") ?? "0");
  }

  return { kind: "image", rId, widthEmu: cx, heightEmu: cy, srcRectT, srcRectB, srcRectL, srcRectR };
}

// ---------------------------------------------------------------------------
// Image cropper
// ---------------------------------------------------------------------------

/** Crop key — uniquely identifies a (rId, srcRect) combination. */
function cropKey(img: DocxImage): string {
  return `${img.rId}_${img.srcRectT}_${img.srcRectB}_${img.srcRectL}_${img.srcRectR}`;
}

/** Crop all unique image+srcRect combinations and return data URLs. */
async function cropAllImages(data: DocxData, contentWidthPt: number): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const seen = new Set<string>();

  for (const para of data.paragraphs) {
    for (const item of para.items) {
      if (item.kind !== "image") continue;
      const img = item as DocxImage;
      const key = cropKey(img);
      if (seen.has(key)) continue;
      seen.add(key);

      const target = data.imageRels[img.rId];
      if (!target) continue;
      const blob = data.imageBlobs[target];
      if (!blob) continue;

      // Compute display size — scale down if wider than content area
      let wPt = img.widthEmu / EMU_PER_PT;
      let hPt = img.heightEmu / EMU_PER_PT;
      if (wPt > contentWidthPt) {
        hPt = hPt * (contentWidthPt / wPt);
        wPt = contentWidthPt;
      }
      // Output canvas at 2× display size (≈144 DPI) — JPEG encoding handles compression
      const maxWPx = Math.round(wPt * 2);
      const maxHPx = Math.round(hPt * 2);

      result[key] = await cropImageToDataUrl(blob, img.srcRectT, img.srcRectB, img.srcRectL, img.srcRectR, maxWPx, maxHPx);
    }
  }

  return result;
}

async function cropImageToDataUrl(
  blob: Blob,
  t: number, b: number, l: number, r: number,
  maxWPx: number, maxHPx: number
): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();

  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve();
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = objectUrl;
  });
  URL.revokeObjectURL(objectUrl);

  const nw = img.naturalWidth;
  const nh = img.naturalHeight;

  // srcRect: t=% from top, b=% from bottom, l=% from left, r=% from right (per-mille)
  const cropTop    = (t / 100000) * nh;
  const cropBottom = nh - (b / 100000) * nh;
  const cropLeft   = (l / 100000) * nw;
  const cropRight  = nw - (r / 100000) * nw;

  const cropW = Math.max(1, Math.round(cropRight - cropLeft));
  const cropH = Math.max(1, Math.round(cropBottom - cropTop));

  // Scale down proportionally to maxWPx × maxHPx if source exceeds it
  const scaleW = cropW > maxWPx ? maxWPx / cropW : 1;
  const scaleH = cropH > maxHPx ? maxHPx / cropH : 1;
  const scale  = Math.min(scaleW, scaleH);
  const outW   = Math.max(1, Math.round(cropW * scale));
  const outH   = Math.max(1, Math.round(cropH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d")!;
  // White background (needed for JPEG which has no alpha channel)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(img, cropLeft, cropTop, cropW, cropH, 0, 0, outW, outH);
  // JPEG at quality 0.85 — much smaller than PNG for diagrams/charts
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ---------------------------------------------------------------------------
// Text layout engine
// ---------------------------------------------------------------------------

// Segoe UI (document font) is ~10% wider than Helvetica (PDF font).
// Apply this correction when measuring text for line-breaking so that
// lines wrap at the same positions as the original document, preserving
// page-overflow behaviour (e.g. soal 3 spanning 2 pages).
const FONT_WIDTH_CORRECTION = 1.15;

interface TextToken {
  text: string;
  bold: boolean;
  italic: boolean;
  fontSizePt: number;
  colorHex: string;
  isSpace: boolean;
}

interface LayoutLine {
  tokens: TextToken[];
  isLast: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFont(pdf: any, bold: boolean, italic: boolean, fontSizePt: number): void {
  const style = bold && italic ? "bolditalic" : bold ? "bold" : italic ? "italic" : "normal";
  pdf.setFont("helvetica", style);
  pdf.setFontSize(fontSizePt);
}

/** Actual rendered width — used for cursor positioning in renderLine. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measureWidth(pdf: any, text: string, bold: boolean, italic: boolean, fontSizePt: number): number {
  setFont(pdf, bold, italic, fontSizePt);
  return pdf.getTextWidth(text);
}

/** Layout width — used for line-breaking decisions only.
 *  Applies FONT_WIDTH_CORRECTION to simulate the wider Segoe UI characters
 *  that the document uses, so line-break positions approximate the original. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function layoutWidth(pdf: any, text: string, bold: boolean, italic: boolean, fontSizePt: number): number {
  return measureWidth(pdf, text, bold, italic, fontSizePt) * FONT_WIDTH_CORRECTION;
}

/** Build a flat token stream (words + spaces) from a list of runs. */
function buildTokens(runs: DocxRun[]): TextToken[] {
  const tokens: TextToken[] = [];
  for (const run of runs) {
    let i = 0;
    const s = run.text;
    while (i < s.length) {
      if (s[i] === " " || s[i] === "\t") {
        while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
        tokens.push({ text: " ", bold: run.bold, italic: run.italic, fontSizePt: run.fontSizePt, colorHex: run.colorHex, isSpace: true });
      } else {
        const start = i;
        while (i < s.length && s[i] !== " " && s[i] !== "\t") i++;
        tokens.push({ text: s.slice(start, i), bold: run.bold, italic: run.italic, fontSizePt: run.fontSizePt, colorHex: run.colorHex, isSpace: false });
      }
    }
  }
  return tokens;
}

/** Break tokens into lines that fit within lineWidthPt.
 *  Uses layoutWidth (with FONT_WIDTH_CORRECTION) for break decisions
 *  to approximate Segoe UI wrapping even though we render in Helvetica. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function layoutLines(pdf: any, tokens: TextToken[], lineWidthPt: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
  let current: TextToken[] = [];
  let currentW = 0;

  for (const token of tokens) {
    const tokenW = layoutWidth(pdf, token.text, token.bold, token.italic, token.fontSizePt);

    if (token.isSpace) {
      if (current.length === 0) continue; // skip leading space on a new line
      current.push(token);
      currentW += tokenW;
    } else {
      if (current.length === 0) {
        // First word on line — place it even if wider than lineWidth
        current.push(token);
        currentW = tokenW;
      } else if (currentW + tokenW > lineWidthPt + 0.001) {
        // Doesn't fit — flush, removing trailing spaces
        while (current.length > 0 && current[current.length - 1].isSpace) {
          const p = current.pop()!;
          currentW -= layoutWidth(pdf, p.text, p.bold, p.italic, p.fontSizePt);
        }
        if (current.length > 0) lines.push({ tokens: current, isLast: false });
        current = [token];
        currentW = tokenW;
      } else {
        current.push(token);
        currentW += tokenW;
      }
    }
  }

  // Flush last line
  while (current.length > 0 && current[current.length - 1].isSpace) current.pop();
  if (current.length > 0) lines.push({ tokens: current, isLast: true });

  return lines;
}

/** Render one line of tokens at (x, y). Justifies if alignment="justify" and not the last line. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderLine(
  pdf: any,
  tokens: TextToken[],
  x: number,
  y: number,
  lineWidthPt: number,
  isLast: boolean,
  alignment: DocxParagraph["alignment"]
): void {
  if (tokens.length === 0) return;

  let totalWordW = 0;
  let totalSpaceW = 0;
  let spaceCount = 0;
  for (const t of tokens) {
    const w = measureWidth(pdf, t.text, t.bold, t.italic, t.fontSizePt);
    if (t.isSpace) { totalSpaceW += w; spaceCount++; }
    else            { totalWordW  += w; }
  }
  const totalW = totalWordW + totalSpaceW;

  let startX = x;
  let spaceW = spaceCount > 0 ? totalSpaceW / spaceCount : 0;

  if (alignment === "center") {
    startX = x + (lineWidthPt - totalW) / 2;
  } else if (alignment === "right") {
    startX = x + lineWidthPt - totalW;
  } else if (alignment === "justify" && !isLast && spaceCount > 0) {
    const extra = lineWidthPt - totalWordW;
    spaceW = extra / spaceCount;
  }

  let cx = startX;
  for (const token of tokens) {
    if (token.isSpace) {
      cx += spaceW;
    } else {
      setFont(pdf, token.bold, token.italic, token.fontSizePt);
      const rr = parseInt(token.colorHex.slice(0, 2), 16) || 0;
      const gg = parseInt(token.colorHex.slice(2, 4), 16) || 0;
      const bb = parseInt(token.colorHex.slice(4, 6), 16) || 0;
      pdf.setTextColor(rr, gg, bb);
      pdf.text(token.text, cx, y, { baseline: "top" });
      cx += measureWidth(pdf, token.text, token.bold, token.italic, token.fontSizePt);
    }
  }
  pdf.setTextColor(0, 0, 0);
}

// ---------------------------------------------------------------------------
// PDF render state
// ---------------------------------------------------------------------------

interface RenderState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any;
  y: number;           // current Y (pt from page top)
  pageCount: number;
  pageHeightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  contentWidthPt: number;
}

function newPage(s: RenderState): void {
  s.pdf.addPage("a4", "portrait");
  s.y = s.marginTopPt;
  s.pageCount++;
}

/** If `neededPt` doesn't fit on the current page, advance to a new page. */
function ensureFits(s: RenderState, neededPt: number): void {
  if (s.y + neededPt > s.pageHeightPt - s.marginBottomPt) {
    newPage(s);
  }
}

// ---------------------------------------------------------------------------
// Paragraph renderer
// ---------------------------------------------------------------------------

function renderParagraph(
  para: DocxParagraph,
  s: RenderState,
  croppedImages: Record<string, string>,
  defaultFontSizePt: number
): void {
  // Split items at page-break markers into segments
  const segments: DocxItem[][] = [];
  let seg: DocxItem[] = [];
  for (const item of para.items) {
    if (item.kind === "pageBreak") {
      segments.push(seg);
      seg = [];
    } else {
      seg.push(item);
    }
  }
  segments.push(seg);

  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si];
    const isFirst = si === 0;
    const isLast  = si === segments.length - 1;

    // Page break before this segment (except the very first)
    if (!isFirst) newPage(s);

    // Spacing before (only on first segment, not after a page break)
    if (isFirst) s.y += para.spacingBeforePt;

    let renderedContent = false;

    // --- Render items sequentially ---
    // Collect consecutive runs into batches for joint layout
    let i = 0;
    while (i < segment.length) {
      const item = segment[i];

      if (item.kind === "image") {
        const img = item as DocxImage;
        let wPt = img.widthEmu / EMU_PER_PT;
        let hPt = img.heightEmu / EMU_PER_PT;

        // Scale down proportionally if wider than content area
        if (wPt > s.contentWidthPt) {
          hPt = hPt * (s.contentWidthPt / wPt);
          wPt = s.contentWidthPt;
        }

        ensureFits(s, hPt);

        const dataUrl = croppedImages[cropKey(img)];
        if (dataUrl) {
          try {
            const fmt = dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
            s.pdf.addImage(dataUrl, fmt, s.marginLeftPt, s.y, wPt, hPt);
          } catch {
            // Malformed image — skip
          }
          s.y += hPt;
          renderedContent = true;
        }
        i++;
      } else if (item.kind === "run") {
        // Collect all consecutive runs for joint word-wrap layout
        const runs: DocxRun[] = [];
        while (i < segment.length && segment[i].kind === "run") {
          runs.push(segment[i] as DocxRun);
          i++;
        }

        const tokens = buildTokens(runs);
        // Skip if only whitespace
        if (tokens.every(t => t.isSpace)) continue;

        // Max font size in this run batch → line height
        let maxFontPt = defaultFontSizePt;
        for (const r of runs) maxFontPt = Math.max(maxFontPt, r.fontSizePt);
        const lineH = maxFontPt * para.lineSpacingMult;

        // Left edge and width, adjusted for indent
        const lineX = s.marginLeftPt + para.indentLeftPt;
        const lineW = s.contentWidthPt - para.indentLeftPt;

        const lines = layoutLines(s.pdf, tokens, lineW);

        for (let li = 0; li < lines.length; li++) {
          // First line of the paragraph's first segment: apply hanging indent
          const isFirstLineOfPara = li === 0 && isFirst && !renderedContent;
          const xAdj = isFirstLineOfPara ? lineX - para.indentHangingPt : lineX;
          const wAdj = isFirstLineOfPara ? lineW + para.indentHangingPt : lineW;

          ensureFits(s, lineH);
          renderLine(s.pdf, lines[li].tokens, xAdj, s.y, wAdj, lines[li].isLast, para.alignment);
          s.y += lineH;
          renderedContent = true;
        }
      } else {
        i++;
      }
    }

    // --- Blank-line placeholder for empty / whitespace-only paragraphs ---
    // Only on the last segment (so page breaks don't add phantom blank lines)
    if (!renderedContent && isLast) {
      const lineH = defaultFontSizePt * para.lineSpacingMult;
      ensureFits(s, lineH);
      s.y += lineH;
    }

    // Spacing after (only on last segment)
    if (isLast) s.y += para.spacingAfterPt;
  }
}

// ---------------------------------------------------------------------------
// Quality score
// ---------------------------------------------------------------------------

function computeQualityScore(pageCount: number, imageItems: number, textRuns: number): number {
  let score = 100;
  if (pageCount === 0) score -= 50;
  if (textRuns   === 0) score -= 30;
  if (imageItems === 0) score -= 20;
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function convertWordToPdf(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<WordToPdfResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (!ext || !["docx", "doc"].includes(ext)) {
    throw new Error("Unsupported file format. Please upload a .docx or .doc file.");
  }
  if (ext === "doc") {
    throw new Error(
      "DOC_FORMAT_NOT_SUPPORTED: The legacy .doc format cannot be reliably " +
      "converted in the browser. Please convert to .docx first using Microsoft " +
      "Word or LibreOffice (File → Save As → .docx), then try again."
    );
  }

  try {
    onProgress({ progress: 5,  status: "Reading document..." });
    onProgress({ progress: 15, status: "Loading libraries..." });

    const [JsPDF] = await Promise.all([getJsPDF(), getJSZip()]);

    onProgress({ progress: 25, status: "Parsing document structure..." });
    const docxData = await parseDocx(file);

    const contentWidthPt = docxData.pageWidthPt - docxData.marginLeftPt - docxData.marginRightPt;

    onProgress({ progress: 45, status: "Processing images..." });
    const croppedImages = await cropAllImages(docxData, contentWidthPt);

    onProgress({ progress: 60, status: "Rendering PDF..." });

    const pdf = new JsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    pdf.setTextColor(0, 0, 0);

    const state: RenderState = {
      pdf,
      y: docxData.marginTopPt,
      pageCount: 1,
      pageHeightPt: docxData.pageHeightPt,
      marginTopPt: docxData.marginTopPt,
      marginBottomPt: docxData.marginBottomPt,
      marginLeftPt: docxData.marginLeftPt,
      contentWidthPt,
    };

    let imageItems = 0;
    let textRuns   = 0;
    const total = docxData.paragraphs.length;

    for (let i = 0; i < docxData.paragraphs.length; i++) {
      if (i % 10 === 0) {
        onProgress({
          progress: Math.round(60 + (i / total) * 35),
          status: `Rendering paragraph ${i + 1} of ${total}...`,
        });
      }

      const para = docxData.paragraphs[i];
      for (const item of para.items) {
        if (item.kind === "image") imageItems++;
        if (item.kind === "run" && (item as DocxRun).text.trim()) textRuns++;
      }

      renderParagraph(para, state, croppedImages, docxData.defaultFontSizePt);
    }

    onProgress({ progress: 97, status: "Assembling PDF..." });

    const pdfBlob = pdf.output("blob");
    const previewUrl = URL.createObjectURL(pdfBlob);

    onProgress({ progress: 100, status: "Done!" });

    return {
      blob: pdfBlob,
      previewUrl,
      originalSize: file.size,
      processedSize: pdfBlob.size,
      qualityScore: computeQualityScore(state.pageCount, imageItems, textRuns),
      pageCount: state.pageCount,
    };
  } catch (err) {
    console.error("[word-to-pdf] Conversion failed:", err);
    throw err;
  }
}
