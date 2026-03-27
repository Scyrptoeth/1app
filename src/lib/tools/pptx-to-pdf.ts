// ============================================================================
// PowerPoint to PDF Converter — Direct PPTX-to-PDF Rendering
//
// Pipeline:
//   1. JSZip      → unpack PPTX (slide XMLs, _rels/, media/)
//   2. DOMParser  → parse OOXML slide XML into rendering elements
//   3. jsPDF      → render shapes, images, and text directly as PDF vectors
//
// No html2canvas — text is PDF vector text; images are embedded JPEG/PNG.
// Slide dimensions are read dynamically from presentation.xml sldSz.
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
  currentSlide?: number;
  totalSlides?: number;
}

export interface PptxToPdfResult {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  slideCount: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ImageEntry {
  data: string; // base64 data URL
  format: "JPEG" | "PNG";
  width: number;
  height: number;
}

interface GroupTransform {
  offX: number; // pts — group's position on parent
  offY: number;
  scaleX: number; // scale factor applied to child coordinates
  scaleY: number;
  chOffX: number; // pts — child coordinate system origin
  chOffY: number;
}

interface PlaceholderDef {
  x: number; // pts
  y: number;
  cx: number;
  cy: number;
  // Optional font defaults from layout/master lstStyle (may be absent if no lstStyle)
  fontSizePt?: number;
  bold?: boolean;
  colorHex?: string;
  fontName?: string;
}

// Map from placeholder type or index string → default position
type PlaceholderMap = Map<string, PlaceholderDef>;

// Font defaults inherited from txBody lstStyle / layout / master
interface FontDefaults {
  sizePt: number;
  bold: boolean;
  colorHex: string;
  fontName: string;
}

// A single token (word or whitespace) for word-wrap purposes
interface WrapToken {
  text: string;
  run: TextRun;
  width: number; // pre-measured width in pts
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMU_PER_PT = 12700;

// OOXML namespaces
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emu(val: string | null | undefined, fallback = 0): number {
  const n = parseInt(val ?? "0", 10);
  return (isNaN(n) ? fallback : n) / EMU_PER_PT;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").padEnd(6, "0");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mapFont(typeface: string): string {
  const lc = typeface.toLowerCase();
  if (lc.includes("courier") || lc.includes("mono")) return "courier";
  if (lc.includes("times") || lc === "georgia") return "times";
  return "helvetica"; // Calibri, Ebrima, Arial, etc.
}

/** Find the first direct child element by localName (namespace-agnostic). */
function child(parent: Element | null, localName: string): Element | null {
  if (!parent) return null;
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].localName === localName) return parent.children[i];
  }
  return null;
}

/** All direct children with matching localName. */
function children(parent: Element | null, localName: string): Element[] {
  if (!parent) return [];
  const result: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].localName === localName) result.push(parent.children[i]);
  }
  return result;
}

/** Get a named attribute without worrying about XML prefixes. */
function attr(el: Element | null, name: string): string {
  if (!el) return "";
  return (
    el.getAttributeNS(A_NS, name) ??
    el.getAttributeNS(R_NS, name) ??
    el.getAttributeNS(P_NS, name) ??
    el.getAttribute(name) ??
    el.getAttribute("a:" + name) ??
    el.getAttribute("r:" + name) ??
    el.getAttribute("p:" + name) ??
    ""
  );
}

/** Parse the xfrm element → {x, y, cx, cy} all in pts. */
function parseXfrm(xfrm: Element | null): { x: number; y: number; cx: number; cy: number } {
  if (!xfrm) return { x: 0, y: 0, cx: 0, cy: 0 };
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  return {
    x: emu(attr(off, "x")),
    y: emu(attr(off, "y")),
    cx: emu(attr(ext, "cx")),
    cy: emu(attr(ext, "cy")),
  };
}

/**
 * Parse placeholder positions (and font defaults) from a slide master or layout XML document.
 * Returns a map from placeholder key ("title", "body", "idx:N") → PlaceholderDef.
 * Shapes without xfrm (common in layouts) are included if they carry font data.
 */
function parsePlaceholderPositions(xmlDoc: Document): PlaceholderMap {
  const map: PlaceholderMap = new Map();
  const spArr = Array.from(
    xmlDoc.getElementsByTagNameNS(P_NS, "sp").length > 0
      ? xmlDoc.getElementsByTagNameNS(P_NS, "sp")
      : xmlDoc.getElementsByTagName("p:sp")
  ) as Element[];

  for (const sp of spArr) {
    const nvSpPr = child(sp, "nvSpPr");
    const nvPr = child(nvSpPr, "nvPr");
    if (!nvPr) continue;
    const ph = child(nvPr, "ph");
    if (!ph) continue;

    const phType = ph.getAttribute("type") ?? "body";
    const phIdx = ph.getAttribute("idx") ?? "0";
    const spPr = child(sp, "spPr");
    const xfrm = child(spPr, "xfrm");

    const def: PlaceholderDef = { x: 0, y: 0, cx: 0, cy: 0 };

    if (xfrm) {
      const pos = parseXfrm(xfrm);
      if (pos.cx > 0 || pos.cy > 0) {
        def.x = pos.x;
        def.y = pos.y;
        def.cx = pos.cx;
        def.cy = pos.cy;
      }
    }

    // Extract font defaults from txBody lstStyle (even when no xfrm)
    const txBody = child(sp, "txBody");
    const lstStyle = child(txBody, "lstStyle");
    const lvl1pPr = child(lstStyle, "lvl1pPr");
    const defRPr = child(lvl1pPr, "defRPr");
    if (defRPr) {
      const sz = defRPr.getAttribute("sz");
      if (sz) def.fontSizePt = parseInt(sz, 10) / 100;
      const b = defRPr.getAttribute("b");
      if (b === "1" || b === "true") def.bold = true;
      const color = getSolidFillColor(defRPr);
      if (color) def.colorHex = color;
      const latin = child(defRPr, "latin");
      const typeface = latin?.getAttribute("typeface");
      if (typeface) def.fontName = mapFont(typeface);
    }

    // Include if has position or font data
    if (def.cx > 0 || def.fontSizePt !== undefined) {
      map.set(phType, def);
      map.set(`idx:${phIdx}`, def);
    }
  }

  return map;
}

/**
 * Merge master and layout placeholder maps.
 * Position: use layout's if layout has explicit non-zero cx/cy, else keep master's.
 * Font: layout overrides master (layout defines the actual font spec for ph type).
 */
function mergePlaceholderMaps(master: PlaceholderMap, layout: PlaceholderMap): PlaceholderMap {
  const merged = new Map(master);
  for (const [k, layoutDef] of layout) {
    const masterDef = merged.get(k);
    if (!masterDef) {
      merged.set(k, layoutDef);
    } else {
      merged.set(k, {
        // Position: layout wins if it has an explicit non-zero size, else master
        x: layoutDef.cx > 0 ? layoutDef.x : masterDef.x,
        y: layoutDef.cx > 0 ? layoutDef.y : masterDef.y,
        cx: layoutDef.cx > 0 ? layoutDef.cx : masterDef.cx,
        cy: layoutDef.cy > 0 ? layoutDef.cy : masterDef.cy,
        // Font: layout overrides master when present
        fontSizePt: layoutDef.fontSizePt ?? masterDef.fontSizePt,
        bold: layoutDef.bold ?? masterDef.bold,
        colorHex: layoutDef.colorHex ?? masterDef.colorHex,
        fontName: layoutDef.fontName ?? masterDef.fontName,
      });
    }
  }
  return merged;
}

/** Parse group transform — returns the GroupTransform for children coordinate mapping. */
function parseGroupTransform(grpSpPr: Element | null): GroupTransform {
  const xfrm = child(grpSpPr, "xfrm");
  if (!xfrm) return { offX: 0, offY: 0, scaleX: 1, scaleY: 1, chOffX: 0, chOffY: 0 };

  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  const chOff = child(xfrm, "chOff");
  const chExt = child(xfrm, "chExt");

  const offX = emu(attr(off, "x"));
  const offY = emu(attr(off, "y"));
  const extCx = emu(attr(ext, "cx"));
  const extCy = emu(attr(ext, "cy"));
  const chOffX = emu(attr(chOff, "x"));
  const chOffY = emu(attr(chOff, "y"));
  const chExtCx = emu(attr(chExt, "cx")) || extCx || 1;
  const chExtCy = emu(attr(chExt, "cy")) || extCy || 1;

  return {
    offX,
    offY,
    scaleX: extCx / chExtCx,
    scaleY: extCy / chExtCy,
    chOffX,
    chOffY,
  };
}

/**
 * Apply all stacked group transforms to a child coordinate in pts.
 * Each element in the stack is applied from innermost to outermost.
 */
function applyGroupStack(
  x: number,
  y: number,
  stack: GroupTransform[]
): { x: number; y: number } {
  let px = x;
  let py = y;
  for (const g of stack) {
    px = g.offX + (px - g.chOffX) * g.scaleX;
    py = g.offY + (py - g.chOffY) * g.scaleY;
  }
  return { x: px, y: py };
}

function applyGroupStackSize(
  cx: number,
  cy: number,
  stack: GroupTransform[]
): { cx: number; cy: number } {
  let pcx = cx;
  let pcy = cy;
  for (const g of stack) {
    pcx = pcx * g.scaleX;
    pcy = pcy * g.scaleY;
  }
  return { cx: pcx, cy: pcy };
}

/** Load image as base64 data URL and detect dimensions. */
async function loadImage(bytes: Uint8Array, ext: string): Promise<ImageEntry> {
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  const format: "JPEG" | "PNG" = mime === "image/jpeg" ? "JPEG" : "PNG";

  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  const data = `data:${mime};base64,${b64}`;

  const dims = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = data;
  });

  return { data, format, width: dims.width, height: dims.height };
}

// ---------------------------------------------------------------------------
// Color extraction
// ---------------------------------------------------------------------------

function getSolidFillColor(el: Element | null): string | null {
  if (!el) return null;
  const sf = child(el, "solidFill");
  if (!sf) return null;
  const srgb = child(sf, "srgbClr");
  if (srgb) return srgb.getAttribute("val") ?? null;
  const sysClr = child(sf, "sysClr");
  if (sysClr) return sysClr.getAttribute("lastClr") ?? sysClr.getAttribute("val") ?? null;
  const schemeClr = child(sf, "schemeClr");
  if (schemeClr) {
    const scheme = schemeClr.getAttribute("val") ?? "";
    const schemeMap: Record<string, string> = {
      dk1: "000000", lt1: "FFFFFF", dk2: "1F497D", lt2: "EEECE1",
      accent1: "4F81BD", accent2: "C0504D", accent3: "9BBB59",
      accent4: "8064A2", accent5: "4BACC6", accent6: "F79646",
      bg1: "FFFFFF", bg2: "EEECE1", tx1: "000000", tx2: "1F497D",
    };
    return schemeMap[scheme] ?? "000000";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderRect(doc: any, x: number, y: number, w: number, h: number, fillColor: string | null, strokeColor: string | null, lineWidthPt: number) {
  if (w <= 0 || h <= 0) return;
  const hasFill = !!fillColor;
  const hasStroke = !!strokeColor && lineWidthPt > 0;
  if (!hasFill && !hasStroke) return;

  if (hasFill) {
    const [r, g, b] = parseHex(fillColor!);
    doc.setFillColor(r, g, b);
  }
  if (hasStroke) {
    const [r, g, b] = parseHex(strokeColor!);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(lineWidthPt);
  }

  const style = hasFill && hasStroke ? "FD" : hasFill ? "F" : "S";
  doc.rect(x, y, w, h, style);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderEllipse(doc: any, x: number, y: number, w: number, h: number, fillColor: string | null, strokeColor: string | null, lineWidthPt: number) {
  if (w <= 0 || h <= 0) return;
  const hasFill = !!fillColor;
  const hasStroke = !!strokeColor && lineWidthPt > 0;
  if (!hasFill && !hasStroke) return;

  if (hasFill) {
    const [r, g, b] = parseHex(fillColor!);
    doc.setFillColor(r, g, b);
  }
  if (hasStroke) {
    const [r, g, b] = parseHex(strokeColor!);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(lineWidthPt);
  }

  const style = hasFill && hasStroke ? "FD" : hasFill ? "F" : "S";
  doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, style);
}

interface PathCmd {
  type: "M" | "L" | "C" | "Z";
  pts: number[]; // [x, y, ...] in shape local pts
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderCustomPath(doc: any, cmds: PathCmd[], shapeX: number, shapeY: number, pathW: number, pathH: number, shapeW: number, shapeH: number, fillColor: string | null, strokeColor: string | null, lineWidthPt: number) {
  if (cmds.length === 0) return;
  const hasFill = !!fillColor;
  const hasStroke = !!strokeColor && lineWidthPt > 0;
  if (!hasFill && !hasStroke) return;

  const sx = pathW > 0 ? shapeW / pathW : 1;
  const sy = pathH > 0 ? shapeH / pathH : 1;

  if (hasFill) {
    const [r, g, b] = parseHex(fillColor!);
    doc.setFillColor(r, g, b);
  }
  if (hasStroke) {
    const [r, g, b] = parseHex(strokeColor!);
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(lineWidthPt);
  }

  let hasClose = false;
  for (const cmd of cmds) {
    if (cmd.type === "M") {
      doc.moveTo(shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy);
    } else if (cmd.type === "L") {
      doc.lineTo(shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy);
    } else if (cmd.type === "C") {
      doc.curveTo(
        shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy,
        shapeX + cmd.pts[2] * sx, shapeY + cmd.pts[3] * sy,
        shapeX + cmd.pts[4] * sx, shapeY + cmd.pts[5] * sy
      );
    } else if (cmd.type === "Z") {
      hasClose = true;
      doc.close(); // PDF 'h' operator — doc.closePath() is Canvas context only
      if (hasFill && hasStroke) doc.fillStroke();
      else if (hasFill) doc.fill();
      else doc.stroke();
    }
  }

  // Open paths (no close) — only stroke
  if (!hasClose && hasStroke) {
    doc.stroke();
  }
}

/** Parse custGeom pathLst into path commands (per-path). */
function parseCustGeomPaths(custGeom: Element): Array<{ w: number; h: number; cmds: PathCmd[] }> {
  const result: Array<{ w: number; h: number; cmds: PathCmd[] }> = [];
  const pathLst = child(custGeom, "pathLst");
  if (!pathLst) return result;

  for (const path of children(pathLst, "path")) {
    const w = parseFloat(path.getAttribute("w") ?? "0");
    const h = parseFloat(path.getAttribute("h") ?? "0");
    const cmds: PathCmd[] = [];

    for (let i = 0; i < path.children.length; i++) {
      const cmd = path.children[i];
      const localName = cmd.localName;

      if (localName === "moveTo") {
        const pt = child(cmd, "pt");
        if (pt) cmds.push({ type: "M", pts: [parseFloat(attr(pt, "x") || "0"), parseFloat(attr(pt, "y") || "0")] });
      } else if (localName === "lnTo") {
        const pt = child(cmd, "pt");
        if (pt) cmds.push({ type: "L", pts: [parseFloat(attr(pt, "x") || "0"), parseFloat(attr(pt, "y") || "0")] });
      } else if (localName === "cubicBezTo") {
        const pts = children(cmd, "pt");
        if (pts.length >= 3) {
          cmds.push({
            type: "C",
            pts: [
              parseFloat(attr(pts[0], "x") || "0"), parseFloat(attr(pts[0], "y") || "0"),
              parseFloat(attr(pts[1], "x") || "0"), parseFloat(attr(pts[1], "y") || "0"),
              parseFloat(attr(pts[2], "x") || "0"), parseFloat(attr(pts[2], "y") || "0"),
            ],
          });
        }
      } else if (localName === "close") {
        cmds.push({ type: "Z", pts: [] });
      }
    }
    result.push({ w, h, cmds });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

interface TextRun {
  text: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  colorHex: string;
  fontName: string;
}

interface BulletDef {
  char: string;
  fontName: string;
  sizePt: number;
  colorHex: string;
}

interface TextParagraph {
  runs: TextRun[];
  spaceBefore: number; // pts
  lineSpacingMult: number;
  marginLeft: number; // pts — where the text content starts (after bullet)
  marginRight: number; // pts
  indent: number; // pts — hanging indent (negative = bullet hangs left of text)
  align: "left" | "center" | "right" | "justify";
  bullet?: BulletDef; // bullet character to render before the paragraph
}

/**
 * Extract default font properties from txBody's lstStyle/lvl1pPr/defRPr.
 * This is the fallback when individual runs have no explicit sz/bold/color.
 */
function getFontDefaults(txBody: Element | null, fallback?: FontDefaults): FontDefaults {
  // Start from placeholder/layout fallback if provided, otherwise hard defaults
  const defaults: FontDefaults = fallback
    ? { ...fallback }
    : { sizePt: 12, bold: false, colorHex: "000000", fontName: "helvetica" };
  if (!txBody) return defaults;

  const lstStyle = child(txBody, "lstStyle");
  const lvl1pPr = child(lstStyle, "lvl1pPr");
  const defRPr = child(lvl1pPr, "defRPr");

  if (defRPr) {
    const sz = defRPr.getAttribute("sz");
    if (sz) defaults.sizePt = parseInt(sz, 10) / 100;
    const b = defRPr.getAttribute("b");
    if (b === "1" || b === "true") defaults.bold = true;
    const color = getSolidFillColor(defRPr);
    if (color) defaults.colorHex = color;
    const latin = child(defRPr, "latin");
    const typeface = latin?.getAttribute("typeface");
    if (typeface) defaults.fontName = mapFont(typeface);
  }

  return defaults;
}

function parseTextBody(txBody: Element | null, fontDefaults?: FontDefaults): TextParagraph[] {
  if (!txBody) return [];
  const fd = fontDefaults ?? getFontDefaults(txBody);
  const paragraphs: TextParagraph[] = [];

  for (const para of children(txBody, "p")) {
    const pPr = child(para, "pPr");

    // Paragraph-level default run properties (override body defaults)
    const pDefRPr = child(pPr, "defRPr");
    const pSz = pDefRPr?.getAttribute("sz");
    const pBold = pDefRPr?.getAttribute("b");
    const pColor = getSolidFillColor(pDefRPr);
    const paraFd: FontDefaults = {
      sizePt: pSz ? parseInt(pSz, 10) / 100 : fd.sizePt,
      bold: pBold === "1" || pBold === "true" ? true : pBold === "0" ? false : fd.bold,
      colorHex: pColor ?? fd.colorHex,
      fontName: fd.fontName,
    };

    // Spacing before
    const spcBef = child(child(pPr, "spcBef"), "spcPts");
    const spaceBefore = spcBef ? parseFloat(attr(spcBef, "val") || "0") / 100 : 0;

    // Line spacing — PowerPoint default is "Single" (1.0), not 1.2
    let lineSpacingMult = 1.0;
    const lnSpc = child(child(pPr, "lnSpc"), "spcPct");
    if (lnSpc) {
      const pct = parseFloat(attr(lnSpc, "val") || "100000");
      lineSpacingMult = pct / 100000;
    }

    // Margins and hanging indent
    const marginLeft = emu(pPr?.getAttribute("marL") ?? "0");
    const marginRight = emu(pPr?.getAttribute("marR") ?? "0");
    const indent = emu(pPr?.getAttribute("indent") ?? "0"); // negative = hanging bullet

    // Alignment
    const algn = pPr?.getAttribute("algn") ?? "l";
    const align: "left" | "center" | "right" | "justify" =
      algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";

    // Bullet character
    let bullet: BulletDef | undefined;
    const buNone = child(pPr, "buNone");
    const buChar = child(pPr, "buChar");
    if (buChar && !buNone) {
      const buCharVal = buChar.getAttribute("char") ?? "•";
      const buFont = child(pPr, "buFont");
      const buClr = child(pPr, "buClr");
      const buSzPct = child(pPr, "buSzPct");
      const buTypeface = buFont?.getAttribute("typeface") ?? "helvetica";
      const buFontName = mapFont(buTypeface);
      const buPct = buSzPct ? parseFloat(attr(buSzPct, "val") || "100000") / 100000 : 1.0;
      const buSizePt = paraFd.sizePt * buPct;
      const buColor = getSolidFillColor(buClr) ?? paraFd.colorHex;
      bullet = { char: buCharVal, fontName: buFontName, sizePt: buSizePt, colorHex: buColor };
    }

    const runs: TextRun[] = [];

    for (const run of children(para, "r")) {
      const rPr = child(run, "rPr");
      const textEl = child(run, "t");
      if (!textEl) continue;

      // Preserve whitespace in text nodes
      let text = textEl.textContent ?? "";
      if (!text && textEl.getAttribute("xml:space") !== "preserve") continue;

      // Replace tabs with two spaces
      text = text.replace(/\t/g, "  ");
      if (!text) continue;

      // Font size (sz in hundredths of point) — fall back to paragraph/body default
      const szStr = rPr?.getAttribute("sz") ?? "";
      const fontSizePt = szStr ? parseInt(szStr, 10) / 100 : paraFd.sizePt;

      // Bold / italic — explicit on run, else inherit
      const bStr = rPr?.getAttribute("b") ?? "";
      const iStr = rPr?.getAttribute("i") ?? "";
      const bold = bStr === "1" || bStr === "true" ? true : bStr === "0" ? false : paraFd.bold;
      const italic = iStr === "1" || iStr === "true";

      // Color — explicit on run, else inherit
      const colorFromFill = getSolidFillColor(rPr);
      const colorHex = colorFromFill ?? paraFd.colorHex;

      // Font
      const latinEl = child(rPr, "latin");
      const typeface = latinEl?.getAttribute("typeface") ?? "+mj-lt";
      // Wingdings → substitute with bullet
      const isWingdings = typeface.toLowerCase().includes("wingding");
      const displayText = isWingdings ? "•" : text;
      const fontName = isWingdings ? "helvetica" : mapFont(typeface);

      runs.push({ text: displayText, fontSizePt, bold, italic, colorHex, fontName });
    }

    paragraphs.push({ runs, spaceBefore, lineSpacingMult, marginLeft, marginRight, indent, align, bullet });
  }

  return paragraphs;
}

/** Measure text width for any string using a run's font settings. Returns actual Helvetica width. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measureText(doc: any, run: TextRun, text: string): number {
  const fontStyle = run.bold && run.italic ? "bolditalic" : run.bold ? "bold" : run.italic ? "italic" : "normal";
  doc.setFont(run.fontName, fontStyle);
  doc.setFontSize(run.fontSizePt);
  return doc.getTextWidth(text);
}

/**
 * Tokenize all runs in a paragraph into word-level tokens,
 * then wrap them into lines that fit within availW.
 * Returns array of lines, each line being an array of WrapTokens.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildWrappedLines(doc: any, para: TextParagraph, availW: number): WrapToken[][] {
  // Calibri (PowerPoint default) is ~0.85× the width of Helvetica at the same pt size.
  // We measure in Helvetica units but wrap as if the box were Calibri-scaled wider,
  // preventing premature line breaks. Token widths stay in Helvetica units so that
  // curX position accumulation is accurate (no glyph overlap).
  const CALIBRI_FACTOR = 0.85;
  const wrapLimit = availW / CALIBRI_FACTOR;

  // Flatten all runs into tokens (words and whitespace)
  const allTokens: WrapToken[] = [];
  for (const run of para.runs) {
    // Split on whitespace boundaries but keep separators
    const parts = run.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      const width = measureText(doc, run, part);
      allTokens.push({ text: part, run, width });
    }
  }

  if (allTokens.length === 0) return [[]];

  const lines: WrapToken[][] = [];
  let currentLine: WrapToken[] = [];
  let currentLineW = 0;

  for (const token of allTokens) {
    const isWhitespace = /^\s+$/.test(token.text);

    if (isWhitespace) {
      // Add whitespace only if line is non-empty (avoid leading whitespace on new line)
      if (currentLine.length > 0) {
        currentLine.push(token);
        currentLineW += token.width;
      }
    } else {
      // Non-whitespace word: check if it fits (using Calibri-adjusted limit)
      if (currentLine.length > 0 && currentLineW + token.width > wrapLimit + 0.5) {
        // Trim trailing whitespace from current line
        while (currentLine.length > 0 && /^\s+$/.test(currentLine[currentLine.length - 1].text)) {
          currentLine.pop();
        }
        lines.push(currentLine);
        currentLine = [token];
        currentLineW = token.width;
      } else {
        currentLine.push(token);
        currentLineW += token.width;
      }
    }
  }

  // Push the last line
  while (currentLine.length > 0 && /^\s+$/.test(currentLine[currentLine.length - 1].text)) {
    currentLine.pop();
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return lines.length > 0 ? lines : [[]];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderTextBody(
  doc: any,
  txBody: Element | null,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  fontDefaults?: FontDefaults
) {
  if (!txBody) return;

  const bodyPr = child(txBody, "bodyPr");
  // spAutoFit means the box grows to fit text — do not clip at boxH for these shapes
  const hasAutoFit = !!child(bodyPr, "spAutoFit");
  // Default PPTX insets: lIns=91440, tIns=45720, rIns=91440, bIns=45720 EMU
  const lIns = emu(bodyPr?.getAttribute("lIns") ?? "91440");
  const tIns = emu(bodyPr?.getAttribute("tIns") ?? "45720");
  const rIns = emu(bodyPr?.getAttribute("rIns") ?? "91440");
  const bIns = emu(bodyPr?.getAttribute("bIns") ?? "45720");

  const paragraphs = parseTextBody(txBody, fontDefaults);
  if (paragraphs.length === 0) return;

  const contentX = boxX + lIns;
  const contentW = Math.max(boxW - lIns - rIns, 10);

  // Pre-build all wrapped lines for each paragraph (needed for vertical align)
  type BuiltPara = {
    spaceBefore: number;
    lineSpacingMult: number;
    marginLeft: number;
    marginRight: number;
    indent: number;
    align: string;
    lines: WrapToken[][];
    lineH: number;
    bullet?: BulletDef;
  };

  const builtParas: BuiltPara[] = [];
  let totalTextH = 0;

  for (const para of paragraphs) {
    const availW = contentW - para.marginLeft - para.marginRight;
    const wrappedLines = para.runs.length > 0 ? buildWrappedLines(doc, para, availW) : [[]];
    const maxFontSize = para.runs.length > 0
      ? para.runs.reduce((m, r) => Math.max(m, r.fontSizePt), 8)
      : (fontDefaults?.sizePt ?? 12);
    const lineH = maxFontSize * Math.max(para.lineSpacingMult, 1.0);

    totalTextH += para.spaceBefore + lineH * wrappedLines.length;
    builtParas.push({
      spaceBefore: para.spaceBefore,
      lineSpacingMult: para.lineSpacingMult,
      marginLeft: para.marginLeft,
      marginRight: para.marginRight,
      indent: para.indent,
      align: para.align,
      lines: wrappedLines,
      lineH,
      bullet: para.bullet,
    });
  }

  // Vertical anchor
  const anchor = bodyPr?.getAttribute("anchor") ?? "t";
  let curY = boxY + tIns;
  if (anchor === "ctr" && boxH > 0) {
    curY = boxY + Math.max((boxH - totalTextH) / 2, tIns);
  } else if (anchor === "b" && boxH > 0) {
    curY = boxY + Math.max(boxH - totalTextH - bIns, boxY + tIns);
  }

  for (const bp of builtParas) {
    curY += bp.spaceBefore;

    // Render bullet character on the first line of the paragraph
    if (bp.bullet && bp.lines.length > 0 && bp.lines[0].length > 0) {
      if (!hasAutoFit && boxH > 0 && curY > boxY + boxH) {
        // skip this paragraph entirely
        curY += bp.lineH * bp.lines.length;
        continue;
      }
      const bul = bp.bullet;
      doc.setFont(bul.fontName, "normal");
      doc.setFontSize(bul.sizePt);
      const [br, bg, bb] = parseHex(bul.colorHex);
      doc.setTextColor(br, bg, bb);
      // Bullet sits at contentX + marginLeft + indent (indent is typically negative)
      const bulletX = contentX + bp.marginLeft + bp.indent;
      doc.text(bul.char, bulletX, curY, { baseline: "top" });
      doc.setTextColor(0, 0, 0);
    }

    for (const lineTokens of bp.lines) {
      // Stop rendering if line start is below box bottom (skip when shape auto-expands)
      if (!hasAutoFit && boxH > 0 && curY > boxY + boxH) break;

      if (lineTokens.length === 0) {
        curY += bp.lineH;
        continue;
      }

      const lineW = lineTokens.reduce((s, t) => s + t.width, 0);
      const availW = contentW - bp.marginLeft - bp.marginRight;
      let startX: number;

      if (bp.align === "center") {
        startX = contentX + bp.marginLeft + Math.max((availW - lineW) / 2, 0);
      } else if (bp.align === "right") {
        startX = contentX + contentW - bp.marginRight - lineW;
        startX = Math.max(startX, contentX);
      } else {
        startX = contentX + bp.marginLeft;
      }

      let curX = startX;
      for (const token of lineTokens) {
        const fontStyle = token.run.bold && token.run.italic ? "bolditalic"
          : token.run.bold ? "bold"
          : token.run.italic ? "italic"
          : "normal";
        doc.setFont(token.run.fontName, fontStyle);
        doc.setFontSize(token.run.fontSizePt);
        const [r, g, b] = parseHex(token.run.colorHex);
        doc.setTextColor(r, g, b);
        doc.text(token.text, curX, curY, { baseline: "top" });
        curX += token.width;
      }

      curY += bp.lineH;
    }
  }

  doc.setTextColor(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Shape rendering
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderPic(doc: any, el: Element, images: Map<string, ImageEntry>, rels: Map<string, string>, groupStack: GroupTransform[]) {
  const blipFill = child(el, "blipFill");
  const spPr = child(el, "spPr");
  const xfrm = child(spPr, "xfrm");
  const pos = parseXfrm(xfrm);

  const blip = child(blipFill, "blip");
  const rId = blip?.getAttributeNS(R_NS, "embed") ?? blip?.getAttribute("r:embed") ?? "";
  const mediaTarget = rels.get(rId);
  if (!mediaTarget) return;

  const img = images.get(mediaTarget);
  if (!img) return;

  const { x, y } = applyGroupStack(pos.x, pos.y, groupStack);
  const { cx, cy } = applyGroupStackSize(pos.cx, pos.cy, groupStack);

  if (cx <= 0 || cy <= 0) return;

  try {
    doc.addImage(img.data, img.format, x, y, cx, cy);
  } catch {
    // Skip image if rendering fails
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderShape(doc: any, el: Element, groupStack: GroupTransform[], placeholders?: PlaceholderMap, isLayoutShape = false) {
  const spPr = child(el, "spPr");
  const txBody = child(el, "txBody");
  const xfrm = child(spPr, "xfrm");
  let pos = parseXfrm(xfrm);

  // Look up placeholder for position AND font defaults
  const nvSpPr = child(el, "nvSpPr");
  const nvPr = child(nvSpPr, "nvPr");
  const ph = child(nvPr, "ph");
  let phFontFallback: FontDefaults | undefined;

  if (ph) {
    // Layout shapes that are placeholders are templates — skip rendering their text
    if (isLayoutShape) return;

    if (placeholders) {
      const phType = ph.getAttribute("type") ?? "body";
      const phIdx = ph.getAttribute("idx") ?? "0";
      const phDef = placeholders.get(phType) ?? placeholders.get(`idx:${phIdx}`);
      if (phDef) {
        // Use placeholder position when shape has no xfrm
        if (!xfrm && phDef.cx > 0) {
          pos = { x: phDef.x, y: phDef.y, cx: phDef.cx, cy: phDef.cy };
        }
        // Build font fallback from placeholder lstStyle data
        if (phDef.fontSizePt !== undefined || phDef.bold !== undefined) {
          phFontFallback = {
            sizePt: phDef.fontSizePt ?? 12,
            bold: phDef.bold ?? false,
            colorHex: phDef.colorHex ?? "000000",
            fontName: phDef.fontName ?? "helvetica",
          };
        }
      }
    }
  }

  const { x, y } = applyGroupStack(pos.x, pos.y, groupStack);
  const { cx, cy } = applyGroupStackSize(pos.cx, pos.cy, groupStack);

  // Fill color
  const fillColor = getSolidFillColor(spPr);

  // Stroke / line — default to black (0.5pt) when ln element exists but no explicit color
  const lnEl = child(spPr, "ln");
  let strokeColor = lnEl ? getSolidFillColor(lnEl) : null;
  let strokeW = lnEl ? emu(lnEl.getAttribute("w") ?? "0") : 0;
  if (lnEl) {
    // Check noFill on the line
    const lnNoFill = child(lnEl, "noFill");
    if (lnNoFill) {
      strokeColor = null;
      strokeW = 0;
    } else if (!strokeColor) {
      // ln exists but no explicit color → default to dark (use dk1/black)
      strokeColor = "000000";
    }
    if (strokeW <= 0 && strokeColor) strokeW = 0.75; // minimum visible stroke
  }

  // Geometry
  const prstGeom = child(spPr, "prstGeom");
  const custGeom = child(spPr, "custGeom");

  if (prstGeom) {
    const prst = prstGeom.getAttribute("prst") ?? "rect";
    if (prst === "ellipse") {
      renderEllipse(doc, x, y, cx, cy, fillColor, strokeColor, strokeW);
    } else if (prst === "roundRect") {
      const hasRoundedRect = typeof doc.roundedRect === "function";
      if (hasRoundedRect) {
        const hasFill = !!fillColor;
        const hasStroke = !!strokeColor && strokeW > 0;
        if (hasFill || hasStroke) {
          if (hasFill) { const [r,g,b] = parseHex(fillColor!); doc.setFillColor(r,g,b); }
          if (hasStroke) { const [r,g,b] = parseHex(strokeColor!); doc.setDrawColor(r,g,b); doc.setLineWidth(strokeW); }
          const rr = Math.min(cx, cy) * 0.1;
          doc.roundedRect(x, y, cx, cy, rr, rr, hasFill && hasStroke ? "FD" : hasFill ? "F" : "S");
        }
      } else {
        renderRect(doc, x, y, cx, cy, fillColor, strokeColor, strokeW);
      }
    } else {
      renderRect(doc, x, y, cx, cy, fillColor, strokeColor, strokeW);
    }
  } else if (custGeom) {
    const paths = parseCustGeomPaths(custGeom);
    for (const { w, h, cmds } of paths) {
      renderCustomPath(doc, cmds, x, y, w, h, cx, cy, fillColor, strokeColor, strokeW);
    }
  }

  // Render text body — pass placeholder font fallback for proper inheritance chain
  if (txBody) {
    const fontDefaults = getFontDefaults(txBody, phFontFallback);
    renderTextBody(doc, txBody, x, y, cx, cy, fontDefaults);
  }
}

// ---------------------------------------------------------------------------
// Shape tree traversal
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderSpTree(doc: any, spTree: Element, images: Map<string, ImageEntry>, rels: Map<string, string>, groupStack: GroupTransform[], placeholders?: PlaceholderMap, isLayout = false) {
  for (let i = 0; i < spTree.children.length; i++) {
    const el = spTree.children[i];
    const localName = el.localName;

    if (localName === "pic") {
      await renderPic(doc, el, images, rels, groupStack);
    } else if (localName === "sp") {
      try { renderShape(doc, el, groupStack, placeholders, isLayout); } catch { /* skip broken shape */ }
    } else if (localName === "grpSp") {
      await renderNestedGroup(doc, el, images, rels, groupStack, placeholders, isLayout);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderNestedGroup(doc: any, grpEl: Element, images: Map<string, ImageEntry>, rels: Map<string, string>, parentStack: GroupTransform[], placeholders?: PlaceholderMap, isLayout = false) {
  const grpSpPr = child(grpEl, "grpSpPr");
  const grpTransform = parseGroupTransform(grpSpPr);
  const newStack = [...parentStack, grpTransform];

  for (let i = 0; i < grpEl.children.length; i++) {
    const el = grpEl.children[i];
    const localName = el.localName;
    if (localName === "pic") {
      await renderPic(doc, el, images, rels, newStack);
    } else if (localName === "sp") {
      try { renderShape(doc, el, newStack, placeholders, isLayout); } catch { /* skip broken shape */ }
    } else if (localName === "grpSp") {
      await renderNestedGroup(doc, el, images, rels, newStack, placeholders, isLayout);
    }
  }
}

// ---------------------------------------------------------------------------
// Main converter
// ---------------------------------------------------------------------------

export async function convertPptxToPdf(
  file: File,
  onProgress: (update: ProcessingUpdate) => void
): Promise<PptxToPdfResult> {
  onProgress({ progress: 2, status: "Reading file..." });

  const JSZip = await getJSZip();
  const JsPDF = await getJsPDF();
  const xmlParser = new DOMParser();

  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  onProgress({ progress: 8, status: "Loading media..." });

  // --- Load presentation.xml to get slide list + dimensions ---
  const presentationXmlStr = await zip.file("ppt/presentation.xml")?.async("string");
  if (!presentationXmlStr) throw new Error("File bukan PPTX yang valid: presentation.xml tidak ditemukan.");
  const presentationXml = xmlParser.parseFromString(presentationXmlStr, "text/xml");

  // Slide dimensions from sldSz
  const sldSz = presentationXml.getElementsByTagNameNS(P_NS, "sldSz")[0]
    ?? presentationXml.getElementsByTagName("p:sldSz")[0];
  const slideCxEmu = parseInt(sldSz?.getAttribute("cx") ?? "12192000", 10);
  const slideCyEmu = parseInt(sldSz?.getAttribute("cy") ?? "6858000", 10);
  const slideWPt = slideCxEmu / EMU_PER_PT;
  const slideHPt = slideCyEmu / EMU_PER_PT;

  // --- Load presentation.xml.rels to map slide rIds ---
  const presRelsStr = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  const slideRels: Map<string, string> = new Map();
  if (presRelsStr) {
    const presRelsXml = xmlParser.parseFromString(presRelsStr, "text/xml");
    for (const rel of Array.from(presRelsXml.getElementsByTagName("Relationship"))) {
      const type = rel.getAttribute("Type") ?? "";
      if (type.includes("/slide") && !type.includes("slideLayout") && !type.includes("slideMaster")) {
        slideRels.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
      }
    }
  }

  // Get slide IDs in order
  const sldIdLst = presentationXml.getElementsByTagNameNS(P_NS, "sldIdLst")[0]
    ?? presentationXml.getElementsByTagName("p:sldIdLst")[0];
  const slideFiles: string[] = [];
  if (sldIdLst) {
    for (let i = 0; i < sldIdLst.children.length; i++) {
      const sldId = sldIdLst.children[i];
      const rId = sldId.getAttributeNS(R_NS, "id") ?? sldId.getAttribute("r:id") ?? "";
      const target = slideRels.get(rId);
      if (target) slideFiles.push(target.startsWith("/ppt/") ? target.slice(1) : "ppt/" + target.replace(/^\.\//, ""));
    }
  }

  if (slideFiles.length === 0) throw new Error("Tidak ada slide yang ditemukan dalam file PPTX.");

  const totalSlides = slideFiles.length;

  // --- Load all media files ---
  const images: Map<string, ImageEntry> = new Map();
  const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("ppt/media/"));

  onProgress({ progress: 12, status: `Loading ${mediaFiles.length} media files...` });

  await Promise.all(
    mediaFiles.map(async (mediaPath) => {
      const entry = zip.file(mediaPath);
      if (!entry) return;
      try {
        const bytes = await entry.async("uint8array");
        const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "png";
        if (!["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return;
        const img = await loadImage(bytes, ext);
        images.set(mediaPath.replace("ppt/", ""), img);
      } catch {
        // Skip unloadable media
      }
    })
  );

  onProgress({ progress: 18, status: "Loading slide layout..." });

  // --- Load slide master placeholder positions ---
  let masterPlaceholders: PlaceholderMap = new Map();
  const presRelsForMasterStr = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  let masterPath = "ppt/slideMasters/slideMaster1.xml";
  if (presRelsForMasterStr) {
    const presRelsXml = xmlParser.parseFromString(presRelsForMasterStr, "text/xml");
    for (const rel of Array.from(presRelsXml.getElementsByTagName("Relationship"))) {
      const type = rel.getAttribute("Type") ?? "";
      if (type.includes("slideMaster")) {
        const target = rel.getAttribute("Target") ?? "";
        masterPath = target.startsWith("/ppt/") ? target.slice(1) : "ppt/" + target.replace(/^\.\//, "");
        break;
      }
    }
  }
  const masterXmlStr = await zip.file(masterPath)?.async("string");
  if (masterXmlStr) {
    const masterXml = xmlParser.parseFromString(masterXmlStr, "text/xml");
    masterPlaceholders = parsePlaceholderPositions(masterXml);
  }

  // --- Cache for layout data (path → {placeholders, spTree, rels}) ---
  interface LayoutData {
    placeholders: PlaceholderMap;
    spTree: Element | null;
    rels: Map<string, string>;
  }
  const layoutCache: Map<string, LayoutData> = new Map();

  onProgress({ progress: 20, status: "Starting slide render..." });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = null;

  // --- Process slides ---
  for (let slideIdx = 0; slideIdx < slideFiles.length; slideIdx++) {
    const slideFile = slideFiles[slideIdx];
    const progress = 20 + Math.round((slideIdx / totalSlides) * 70);
    onProgress({
      progress,
      status: `Rendering slide ${slideIdx + 1} of ${totalSlides}...`,
      currentSlide: slideIdx + 1,
      totalSlides,
    });

    // Load slide XML
    const slideXmlStr = await zip.file(slideFile)?.async("string");
    if (!slideXmlStr) continue;
    const slideXml = xmlParser.parseFromString(slideXmlStr, "text/xml");

    // Load slide relationships
    const slideRelPath = slideFile.replace(/\/([^/]+)$/, "/_rels/$1.rels");
    const slideRelsStr = await zip.file(slideRelPath)?.async("string");
    const slideImageRels: Map<string, string> = new Map();
    let layoutPath = "";
    if (slideRelsStr) {
      const relsXml = xmlParser.parseFromString(slideRelsStr, "text/xml");
      for (const rel of Array.from(relsXml.getElementsByTagName("Relationship"))) {
        const type = rel.getAttribute("Type") ?? "";
        const rId = rel.getAttribute("Id") ?? "";
        const target = rel.getAttribute("Target") ?? "";
        if (type.includes("image") && rId && target) {
          const normalized = target.replace(/^\.\.\//, "");
          slideImageRels.set(rId, normalized);
        } else if (type.includes("slideLayout") && target) {
          layoutPath = "ppt/slides/" + target;
          layoutPath = layoutPath.replace(/\/slides\/\.\.\//, "/");
        }
      }
    }

    // Load layout data (cached)
    let slidePlaceholders: PlaceholderMap = masterPlaceholders;
    let layoutSpTree: Element | null = null;
    let layoutImageRels: Map<string, string> = new Map();

    if (layoutPath) {
      if (!layoutCache.has(layoutPath)) {
        const layoutXmlStr = await zip.file(layoutPath)?.async("string");
        let layoutData: LayoutData = { placeholders: masterPlaceholders, spTree: null, rels: new Map() };

        if (layoutXmlStr) {
          const layoutXml = xmlParser.parseFromString(layoutXmlStr, "text/xml");
          const layoutPh = parsePlaceholderPositions(layoutXml);
          const mergedPh = mergePlaceholderMaps(masterPlaceholders, layoutPh);

          // Get layout's spTree
          const layoutCSld = layoutXml.getElementsByTagNameNS(P_NS, "cSld")[0]
            ?? layoutXml.getElementsByTagName("p:cSld")[0];
          const layoutSpTreeEl = layoutCSld?.getElementsByTagNameNS(P_NS, "spTree")[0]
            ?? layoutCSld?.getElementsByTagName("p:spTree")[0];

          // Load layout's rels (for layout-level images)
          const layoutRelPath = layoutPath.replace(/\/([^/]+)$/, "/_rels/$1.rels");
          const layoutRelsStr = await zip.file(layoutRelPath)?.async("string");
          const lRels: Map<string, string> = new Map();
          if (layoutRelsStr) {
            const lRelsXml = xmlParser.parseFromString(layoutRelsStr, "text/xml");
            for (const rel of Array.from(lRelsXml.getElementsByTagName("Relationship"))) {
              const type = rel.getAttribute("Type") ?? "";
              const rId = rel.getAttribute("Id") ?? "";
              const target = rel.getAttribute("Target") ?? "";
              if (type.includes("image") && rId && target) {
                lRels.set(rId, target.replace(/^\.\.\//, ""));
              }
            }
          }

          layoutData = { placeholders: mergedPh, spTree: layoutSpTreeEl ?? null, rels: lRels };
        }
        layoutCache.set(layoutPath, layoutData);
      }

      const cached = layoutCache.get(layoutPath)!;
      slidePlaceholders = cached.placeholders;
      layoutSpTree = cached.spTree;
      layoutImageRels = cached.rels;
    }

    // Initialize or add page
    if (slideIdx === 0) {
      doc = new JsPDF({
        orientation: slideWPt >= slideHPt ? "landscape" : "portrait",
        unit: "pt",
        format: [slideWPt, slideHPt],
        compress: true,
      });
    } else {
      doc.addPage([slideWPt, slideHPt], slideWPt >= slideHPt ? "landscape" : "portrait");
    }

    // Background: white by default
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, slideWPt, slideHPt, "F");

    // --- Render layout background shapes first (behind slide content) ---
    if (layoutSpTree) {
      await renderSpTree(doc, layoutSpTree, images, layoutImageRels, [], slidePlaceholders, true);
    }

    // --- Render slide shapes ---
    const cSld = slideXml.getElementsByTagNameNS(P_NS, "cSld")[0]
      ?? slideXml.getElementsByTagName("p:cSld")[0];
    const spTree = cSld?.getElementsByTagNameNS(P_NS, "spTree")[0]
      ?? cSld?.getElementsByTagName("p:spTree")[0];

    if (!spTree) continue;

    await renderSpTree(doc, spTree, images, slideImageRels, [], slidePlaceholders);
  }

  onProgress({ progress: 92, status: "Saving PDF..." });

  const pdfBlob: Blob = doc.output("blob");
  const previewUrl = URL.createObjectURL(pdfBlob);

  onProgress({ progress: 100, status: "Done!" });

  return {
    blob: pdfBlob,
    previewUrl,
    originalSize: file.size,
    processedSize: pdfBlob.size,
    slideCount: totalSlides,
  };
}
