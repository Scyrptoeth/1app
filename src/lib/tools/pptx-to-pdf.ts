// ============================================================================
// PowerPoint to PDF Converter — Direct PPTX-to-PDF Rendering
//
// Pipeline:
//   1. JSZip      → unpack PPTX (slide XMLs, _rels/, media/)
//   2. DOMParser  → parse OOXML slide XML into rendering elements
//   3. jsPDF      → render shapes, images, and text directly as PDF vectors
//
// No html2canvas — text is PDF vector text; images are embedded JPEG/PNG.
// Output: 960 × 540 pt pages (PPTX widescreen 16:9 at 96 DPI equiv.)
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
}

// Map from placeholder type or index string → default position
type PlaceholderMap = Map<string, PlaceholderDef>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMU_PER_PT = 12700;
const SLIDE_W_PT = 960; // 12192000 EMU / 12700
const SLIDE_H_PT = 540; // 6858000  EMU / 12700

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
 * Parse placeholder positions from a slide master or layout XML document.
 * Returns a map from placeholder key ("title", "body", "idx:N") → position.
 */
function parsePlaceholderPositions(xmlDoc: Document): PlaceholderMap {
  const map: PlaceholderMap = new Map();
  // Use getElementsByTagName fallback since NS-aware methods are more reliable in XML docs
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
    if (!xfrm) continue;

    const pos = parseXfrm(xfrm);
    if (pos.cx <= 0 && pos.cy <= 0) continue;

    // Store by type and by idx
    map.set(phType, pos);
    map.set(`idx:${phIdx}`, pos);
  }

  return map;
}

/**
 * Merge master and layout placeholder maps.
 * Layout values override master values.
 */
function mergePlaceholderMaps(master: PlaceholderMap, layout: PlaceholderMap): PlaceholderMap {
  const merged = new Map(master);
  for (const [k, v] of layout) merged.set(k, v);
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

  // Build base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  const data = `data:${mime};base64,${b64}`;

  // Detect dimensions via HTMLImageElement
  const dims = await new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = data;
  });

  return { data, format, width: dims.width, height: dims.height };
}

// ---------------------------------------------------------------------------
// Solid fill color extraction
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
    // Fallback scheme colors
    const scheme = schemeClr.getAttribute("val") ?? "";
    const schemeMap: Record<string, string> = {
      dk1: "000000", lt1: "FFFFFF", dk2: "1F497D", lt2: "EEECE1",
      accent1: "4F81BD", accent2: "C0504D", accent3: "9BBB59",
      accent4: "8064A2", accent5: "4BACC6", accent6: "F79646",
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

  for (const cmd of cmds) {
    if (cmd.type === "M") {
      doc.moveTo(shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy);
    } else if (cmd.type === "L") {
      doc.lineTo(shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy);
    } else if (cmd.type === "C") {
      // cubic bezier: cp1x, cp1y, cp2x, cp2y, ex, ey
      doc.curveTo(
        shapeX + cmd.pts[0] * sx, shapeY + cmd.pts[1] * sy,
        shapeX + cmd.pts[2] * sx, shapeY + cmd.pts[3] * sy,
        shapeX + cmd.pts[4] * sx, shapeY + cmd.pts[5] * sy
      );
    } else if (cmd.type === "Z") {
      doc.closePath();
      if (hasFill && hasStroke) doc.fillStroke();
      else if (hasFill) doc.fill();
      else doc.stroke();
    }
  }

  // If no close command ended the path, try to close/stroke it
  // (for open paths like lines)
  const lastCmd = cmds[cmds.length - 1];
  if (lastCmd?.type !== "Z") {
    if (hasStroke) doc.stroke();
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

interface TextParagraph {
  runs: TextRun[];
  spaceBefore: number; // pts
  lineSpacingMult: number;
  marginLeft: number; // pts
  marginRight: number; // pts
  align: "left" | "center" | "right" | "justify";
}

function parseTextBody(txBody: Element | null): TextParagraph[] {
  if (!txBody) return [];
  const paragraphs: TextParagraph[] = [];

  for (const para of children(txBody, "p")) {
    const pPr = child(para, "pPr");

    // Spacing before
    const spcBef = child(child(pPr, "spcBef"), "spcPts");
    const spaceBefore = spcBef ? parseFloat(attr(spcBef, "val") || "0") / 100 : 0;

    // Line spacing
    let lineSpacingMult = 1.2;
    const lnSpc = child(child(pPr, "lnSpc"), "spcPct");
    if (lnSpc) {
      const pct = parseFloat(attr(lnSpc, "val") || "100000");
      lineSpacingMult = pct / 100000;
    }

    // Margins
    const marginLeft = emu(pPr?.getAttribute("marL") ?? "0");
    const marginRight = emu(pPr?.getAttribute("marR") ?? "0");

    // Alignment
    const algn = pPr?.getAttribute("algn") ?? "l";
    const align: "left" | "center" | "right" | "justify" =
      algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";

    const runs: TextRun[] = [];

    for (const run of children(para, "r")) {
      const rPr = child(run, "rPr");
      const textEl = child(run, "t");
      if (!textEl) continue;
      const text = textEl.textContent ?? "";
      if (!text) continue;

      // Font size (sz in hundredths of point)
      const szStr = rPr?.getAttribute("sz") ?? "";
      const fontSizePt = szStr ? parseInt(szStr, 10) / 100 : 12;

      // Bold / italic
      const bStr = rPr?.getAttribute("b") ?? "";
      const iStr = rPr?.getAttribute("i") ?? "";
      const bold = bStr === "1" || bStr === "true";
      const italic = iStr === "1" || iStr === "true";

      // Color
      const colorFromFill = getSolidFillColor(rPr);
      const colorHex = colorFromFill ?? "000000";

      // Font
      const latinEl = child(rPr, "latin");
      const typeface = latinEl?.getAttribute("typeface") ?? "+mj-lt";
      const fontName = mapFont(typeface);

      // Skip Wingdings symbols (map to bullet)
      const isWingdings = typeface.toLowerCase().includes("wingding");
      const displayText = isWingdings ? "•" : text;

      runs.push({ text: displayText, fontSizePt, bold, italic, colorHex, fontName });
    }

    // Include empty paragraphs as spacers
    if (runs.length > 0 || paragraphs.length >= 0) {
      paragraphs.push({ runs, spaceBefore, lineSpacingMult, marginLeft, marginRight, align });
    }
  }

  return paragraphs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measureRunWidth(doc: any, run: TextRun): number {
  const fontStyle = run.bold && run.italic ? "bolditalic" : run.bold ? "bold" : run.italic ? "italic" : "normal";
  doc.setFont(run.fontName, fontStyle);
  doc.setFontSize(run.fontSizePt);
  return doc.getTextWidth(run.text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderRun(doc: any, run: TextRun, x: number, y: number) {
  const fontStyle = run.bold && run.italic ? "bolditalic" : run.bold ? "bold" : run.italic ? "italic" : "normal";
  doc.setFont(run.fontName, fontStyle);
  doc.setFontSize(run.fontSizePt);
  const [r, g, b] = parseHex(run.colorHex);
  doc.setTextColor(r, g, b);
  doc.text(run.text, x, y, { baseline: "top" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderTextBody(
  doc: any,
  txBody: Element | null,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  if (!txBody) return;

  const bodyPr = child(txBody, "bodyPr");
  // Default PPTX insets: lIns=91440, tIns=45720, rIns=91440, bIns=45720 EMU
  const lIns = emu(bodyPr?.getAttribute("lIns") ?? "91440");
  const tIns = emu(bodyPr?.getAttribute("tIns") ?? "45720");
  const rIns = emu(bodyPr?.getAttribute("rIns") ?? "91440");

  const paragraphs = parseTextBody(txBody);
  if (paragraphs.length === 0) return;

  const contentX = boxX + lIns;
  const contentW = Math.max(boxW - lIns - rIns, 10);

  // Calculate total rendered text height for vertical centering
  let totalTextH = 0;
  for (const para of paragraphs) {
    const maxFontSize = para.runs.length > 0
      ? para.runs.reduce((m, r) => Math.max(m, r.fontSizePt), 8)
      : 12;
    totalTextH += para.spaceBefore + maxFontSize * Math.max(para.lineSpacingMult, 1.0);
  }

  const anchor = bodyPr?.getAttribute("anchor") ?? "t";
  let curY = boxY + tIns;
  if (anchor === "ctr" && boxH > 0) {
    curY = boxY + Math.max((boxH - totalTextH) / 2, 0);
  } else if (anchor === "b" && boxH > 0) {
    curY = boxY + Math.max(boxH - totalTextH - tIns, boxY + tIns);
  }

  for (const para of paragraphs) {
    curY += para.spaceBefore;

    if (para.runs.length === 0) {
      curY += 14; // empty paragraph spacer
      continue;
    }

    const maxFontSize = para.runs.reduce((m, r) => Math.max(m, r.fontSizePt), 8);
    const lineH = maxFontSize * Math.max(para.lineSpacingMult, 1.0);

    // Stop rendering if we've gone past the box bottom
    if (boxH > 0 && curY > boxY + boxH) break;

    const paraMarginLeft = para.marginLeft;

    if (para.align === "left" || para.align === "justify") {
      let curX = contentX + paraMarginLeft;
      for (const run of para.runs) {
        const runW = measureRunWidth(doc, run);
        renderRun(doc, run, curX, curY);
        curX += runW;
      }
    } else if (para.align === "center") {
      // Measure total run width, then center
      let totalW = 0;
      for (const run of para.runs) totalW += measureRunWidth(doc, run);
      const startX = contentX + paraMarginLeft + Math.max((contentW - paraMarginLeft - para.marginRight - totalW) / 2, 0);
      let curX = startX;
      for (const run of para.runs) {
        const runW = measureRunWidth(doc, run);
        renderRun(doc, run, curX, curY);
        curX += runW;
      }
    } else if (para.align === "right") {
      // Measure total run width, then right-align
      let totalW = 0;
      for (const run of para.runs) totalW += measureRunWidth(doc, run);
      const startX = contentX + contentW - para.marginRight - totalW;
      let curX = Math.max(startX, contentX);
      for (const run of para.runs) {
        const runW = measureRunWidth(doc, run);
        renderRun(doc, run, curX, curY);
        curX += runW;
      }
    }

    curY += lineH;
  }

  // Reset text color
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

  // Get relationship ID for the image
  const blip = child(blipFill, "blip");
  const rId = blip?.getAttributeNS(R_NS, "embed") ?? blip?.getAttribute("r:embed") ?? "";
  const mediaTarget = rels.get(rId);
  if (!mediaTarget) return;

  const img = images.get(mediaTarget);
  if (!img) return;

  // Apply group transforms
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
function renderShape(doc: any, el: Element, groupStack: GroupTransform[], placeholders?: PlaceholderMap) {
  const spPr = child(el, "spPr");
  const txBody = child(el, "txBody");
  const xfrm = child(spPr, "xfrm");
  let pos = parseXfrm(xfrm);

  // If no xfrm and this is a placeholder, look up position from master/layout
  if (!xfrm && placeholders) {
    const nvSpPr = child(el, "nvSpPr");
    const nvPr = child(nvSpPr, "nvPr");
    const ph = child(nvPr, "ph");
    if (ph) {
      const phType = ph.getAttribute("type") ?? "body";
      const phIdx = ph.getAttribute("idx") ?? "0";
      const fallback = placeholders.get(phType) ?? placeholders.get(`idx:${phIdx}`);
      if (fallback) pos = { ...fallback };
    }
  }

  const { x, y } = applyGroupStack(pos.x, pos.y, groupStack);
  const { cx, cy } = applyGroupStackSize(pos.cx, pos.cy, groupStack);

  // Fill color
  const fillColor = getSolidFillColor(spPr);

  // Stroke / line
  const lnEl = child(spPr, "ln");
  const strokeColor = lnEl ? getSolidFillColor(lnEl) : null;
  const strokeW = lnEl ? emu(lnEl.getAttribute("w") ?? "0") : 0;

  // Geometry
  const prstGeom = child(spPr, "prstGeom");
  const custGeom = child(spPr, "custGeom");

  if (prstGeom) {
    const prst = prstGeom.getAttribute("prst") ?? "rect";
    if (prst === "ellipse") {
      renderEllipse(doc, x, y, cx, cy, fillColor, strokeColor, strokeW);
    } else if (prst === "roundRect") {
      // Use jsPDF roundedRect if available
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
      // Default: rect
      renderRect(doc, x, y, cx, cy, fillColor, strokeColor, strokeW);
    }
  } else if (custGeom) {
    const paths = parseCustGeomPaths(custGeom);
    for (const { w, h, cmds } of paths) {
      renderCustomPath(doc, cmds, x, y, w, h, cx, cy, fillColor, strokeColor, strokeW);
    }
  }

  // Render text body
  if (txBody) {
    renderTextBody(doc, txBody, x, y, cx, cy);
  }
}

// ---------------------------------------------------------------------------
// Shape tree traversal
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderSpTree(doc: any, spTree: Element, images: Map<string, ImageEntry>, rels: Map<string, string>, groupStack: GroupTransform[], placeholders?: PlaceholderMap) {
  for (let i = 0; i < spTree.children.length; i++) {
    const el = spTree.children[i];
    const localName = el.localName;

    if (localName === "pic") {
      await renderPic(doc, el, images, rels, groupStack);
    } else if (localName === "sp") {
      renderShape(doc, el, groupStack, placeholders);
    } else if (localName === "grpSp") {
      await renderNestedGroup(doc, el, images, rels, groupStack, placeholders);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function renderNestedGroup(doc: any, grpEl: Element, images: Map<string, ImageEntry>, rels: Map<string, string>, parentStack: GroupTransform[], placeholders?: PlaceholderMap) {
  const grpSpPr = child(grpEl, "grpSpPr");
  const grpTransform = parseGroupTransform(grpSpPr);
  const newStack = [...parentStack, grpTransform];

  for (let i = 0; i < grpEl.children.length; i++) {
    const el = grpEl.children[i];
    const localName = el.localName;
    if (localName === "pic") {
      await renderPic(doc, el, images, rels, newStack);
    } else if (localName === "sp") {
      renderShape(doc, el, newStack, placeholders);
    } else if (localName === "grpSp") {
      await renderNestedGroup(doc, el, images, rels, newStack, placeholders);
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
  onProgress({ progress: 2, status: "Membaca file..." });

  const JSZip = await getJSZip();
  const JsPDF = await getJsPDF();
  const xmlParser = new DOMParser();

  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  onProgress({ progress: 8, status: "Memuat media..." });

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

  onProgress({ progress: 12, status: `Memuat ${mediaFiles.length} file media...` });

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

  onProgress({ progress: 18, status: "Memuat layout slide..." });

  // --- Load slide master placeholder positions ---
  let masterPlaceholders: PlaceholderMap = new Map();
  const presRelsForMasterStr = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  let masterPath = "ppt/slideMasters/slideMaster1.xml"; // fallback
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

  // --- Cache for layout placeholders (path → PlaceholderMap) ---
  const layoutCache: Map<string, PlaceholderMap> = new Map();

  onProgress({ progress: 20, status: "Memulai render slide..." });

  // --- Initialize jsPDF ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any = null;

  // --- Process slides ---
  for (let slideIdx = 0; slideIdx < slideFiles.length; slideIdx++) {
    const slideFile = slideFiles[slideIdx];
    const progress = 20 + Math.round((slideIdx / totalSlides) * 70);
    onProgress({
      progress,
      status: `Merender slide ${slideIdx + 1} dari ${totalSlides}...`,
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
          // target like "../slideLayouts/slideLayout2.xml" → normalize
          layoutPath = "ppt/slides/" + target;
          layoutPath = layoutPath.replace(/\/slides\/\.\.\//, "/");
        }
      }
    }

    // Get layout placeholders (cached)
    let slidePlaceholders: PlaceholderMap = masterPlaceholders;
    if (layoutPath) {
      if (!layoutCache.has(layoutPath)) {
        const layoutXmlStr = await zip.file(layoutPath)?.async("string");
        if (layoutXmlStr) {
          const layoutXml = xmlParser.parseFromString(layoutXmlStr, "text/xml");
          const layoutPh = parsePlaceholderPositions(layoutXml);
          layoutCache.set(layoutPath, mergePlaceholderMaps(masterPlaceholders, layoutPh));
        } else {
          layoutCache.set(layoutPath, masterPlaceholders);
        }
      }
      slidePlaceholders = layoutCache.get(layoutPath)!;
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

    // Get shape tree
    const cSld = slideXml.getElementsByTagNameNS(P_NS, "cSld")[0]
      ?? slideXml.getElementsByTagName("p:cSld")[0];
    const spTree = cSld?.getElementsByTagNameNS(P_NS, "spTree")[0]
      ?? cSld?.getElementsByTagName("p:spTree")[0];

    if (!spTree) continue;

    // Render all elements with placeholder fallback positions
    await renderSpTree(doc, spTree, images, slideImageRels, [], slidePlaceholders);
  }

  onProgress({ progress: 92, status: "Menyimpan PDF..." });

  const pdfBlob: Blob = doc.output("blob");
  const previewUrl = URL.createObjectURL(pdfBlob);

  onProgress({ progress: 100, status: "Selesai!" });

  return {
    blob: pdfBlob,
    previewUrl,
    originalSize: file.size,
    processedSize: pdfBlob.size,
    slideCount: totalSlides,
  };
}
