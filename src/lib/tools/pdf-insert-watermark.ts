/**
 * PDF Insert Watermark
 *
 * Adds text or image watermark to PDF pages using pdf-lib.
 * - "over" layer: copyPages() (lossless) + draw watermark on top
 * - "below" layer: new page + watermark + embedPdf() original content on top
 * Supports 20 fonts (3 built-in + 17 Google Fonts), 9-point positioning,
 * mosaic pattern, rotation, and opacity.
 */

import { renderPageThumbnail, getPdfPageCount } from "./pdf-splitter";
import { getPageDimensions } from "./pdf-reorder";

export { renderPageThumbnail, getPdfPageCount, getPageDimensions };
export type { PageDimensions } from "./pdf-reorder";

// ─── Font Registry ───────────────────────────────────────────────────

export interface FontDef {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "monospace" | "display";
  isBuiltIn: boolean;
  googleFamily?: string;
  standardFonts?: {
    regular: string;
    bold: string;
    italic: string;
    boldItalic: string;
  };
}

export const FONT_REGISTRY: FontDef[] = [
  // Built-in PDF fonts (no file fetch needed)
  {
    id: "helvetica",
    name: "Helvetica",
    category: "sans-serif",
    isBuiltIn: true,
    standardFonts: {
      regular: "Helvetica",
      bold: "HelveticaBold",
      italic: "HelveticaOblique",
      boldItalic: "HelveticaBoldOblique",
    },
  },
  {
    id: "times-roman",
    name: "Times Roman",
    category: "serif",
    isBuiltIn: true,
    standardFonts: {
      regular: "TimesRoman",
      bold: "TimesRomanBold",
      italic: "TimesRomanItalic",
      boldItalic: "TimesRomanBoldItalic",
    },
  },
  {
    id: "courier",
    name: "Courier",
    category: "monospace",
    isBuiltIn: true,
    standardFonts: {
      regular: "Courier",
      bold: "CourierBold",
      italic: "CourierOblique",
      boldItalic: "CourierBoldOblique",
    },
  },
  // Google Fonts — fetched on-demand via /api/fonts
  { id: "inter", name: "Inter", category: "sans-serif", isBuiltIn: false, googleFamily: "Inter" },
  { id: "dm-sans", name: "DM Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "DM Sans" },
  { id: "nunito", name: "Nunito", category: "sans-serif", isBuiltIn: false, googleFamily: "Nunito" },
  { id: "open-sans", name: "Open Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "Open Sans" },
  { id: "roboto", name: "Roboto", category: "sans-serif", isBuiltIn: false, googleFamily: "Roboto" },
  { id: "lato", name: "Lato", category: "sans-serif", isBuiltIn: false, googleFamily: "Lato" },
  { id: "montserrat", name: "Montserrat", category: "sans-serif", isBuiltIn: false, googleFamily: "Montserrat" },
  { id: "poppins", name: "Poppins", category: "sans-serif", isBuiltIn: false, googleFamily: "Poppins" },
  { id: "raleway", name: "Raleway", category: "sans-serif", isBuiltIn: false, googleFamily: "Raleway" },
  { id: "noto-sans", name: "Noto Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "Noto Sans" },
  { id: "pt-sans", name: "PT Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "PT Sans" },
  { id: "source-sans-3", name: "Source Sans 3", category: "sans-serif", isBuiltIn: false, googleFamily: "Source Sans 3" },
  { id: "ubuntu", name: "Ubuntu", category: "sans-serif", isBuiltIn: false, googleFamily: "Ubuntu" },
  { id: "comic-neue", name: "Comic Neue", category: "display", isBuiltIn: false, googleFamily: "Comic Neue" },
  { id: "pt-serif", name: "PT Serif", category: "serif", isBuiltIn: false, googleFamily: "PT Serif" },
  { id: "merriweather", name: "Merriweather", category: "serif", isBuiltIn: false, googleFamily: "Merriweather" },
  { id: "playfair-display", name: "Playfair Display", category: "serif", isBuiltIn: false, googleFamily: "Playfair Display" },
];

// ─── Types ───────────────────────────────────────────────────────────

export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface TextWatermarkConfig {
  mode: "text";
  text: string;
  fontId: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: { r: number; g: number; b: number };
  opacity: number;
}

export interface ImageWatermarkConfig {
  mode: "image";
  imageData: ArrayBuffer;
  imageType: "png" | "jpg";
  scale: number;
  opacity: number;
}

export interface WatermarkOptions {
  watermark: TextWatermarkConfig | ImageWatermarkConfig;
  position: WatermarkPosition;
  mosaic: boolean;
  rotation: number;
  layer: "over" | "below";
}

export interface ProcessingUpdate {
  progress: number;
  stage: string;
}

export interface InsertWatermarkInput {
  pdfData: ArrayBuffer;
  fileName: string;
  pageOrder: number[];
  options: WatermarkOptions;
  fontBytes?: ArrayBuffer;
  onProgress?: (update: ProcessingUpdate) => void;
}

export interface InsertWatermarkResult {
  blob: Blob;
  fileName: string;
  originalSize: number;
  processedSize: number;
  totalPages: number;
  watermarkedPages: number;
}

// ─── Font Fetch (client-side) ────────────────────────────────────────

const fontCache = new Map<string, ArrayBuffer>();

export async function fetchFontBytes(
  googleFamily: string,
  bold: boolean
): Promise<ArrayBuffer> {
  const weight = bold ? "700" : "400";
  const key = `${googleFamily}::${weight}`;
  if (fontCache.has(key)) return fontCache.get(key)!;

  const res = await fetch(
    `/api/fonts?family=${encodeURIComponent(googleFamily)}&weight=${weight}`
  );
  if (!res.ok) throw new Error(`Failed to fetch font ${googleFamily}`);
  const buf = await res.arrayBuffer();
  fontCache.set(key, buf);
  return buf;
}

// ─── Position Calculation ────────────────────────────────────────────

function calculatePosition(
  pageWidth: number,
  pageHeight: number,
  wmWidth: number,
  wmHeight: number,
  position: WatermarkPosition
): { x: number; y: number } {
  const margin = 20;

  let x: number;
  if (position.includes("left")) x = margin;
  else if (position.includes("right")) x = pageWidth - margin - wmWidth;
  else x = (pageWidth - wmWidth) / 2;

  let y: number;
  if (position.startsWith("top")) y = pageHeight - margin - wmHeight;
  else if (position.startsWith("bottom")) y = margin;
  else y = (pageHeight - wmHeight) / 2;

  return { x, y };
}

function getMosaicPositions(
  pageWidth: number,
  pageHeight: number,
  wmWidth: number,
  wmHeight: number
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const spacingX = wmWidth * 1.8;
  const spacingY = wmHeight * 3;

  let row = 0;
  for (let y = -wmHeight; y < pageHeight + wmHeight; y += spacingY) {
    const offsetX = row % 2 === 1 ? spacingX / 2 : 0;
    for (let x = -wmWidth + offsetX; x < pageWidth + wmWidth; x += spacingX) {
      positions.push({ x, y });
    }
    row++;
  }
  return positions;
}

// ─── Draw Watermark ──────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function drawWatermark(
  page: any,
  opts: WatermarkOptions,
  font: any,
  image: any,
  rgb: any,
  degreesHelper: any
): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const { watermark, position, mosaic, rotation } = opts;

  let wmWidth: number, wmHeight: number;
  if (watermark.mode === "text" && font) {
    wmWidth = font.widthOfTextAtSize(watermark.text, watermark.fontSize);
    wmHeight = watermark.fontSize;
  } else if (watermark.mode === "image" && image) {
    wmWidth = pageWidth * watermark.scale;
    wmHeight = (image.height / image.width) * wmWidth;
  } else {
    return;
  }

  const placements = mosaic
    ? getMosaicPositions(pageWidth, pageHeight, wmWidth, wmHeight)
    : [calculatePosition(pageWidth, pageHeight, wmWidth, wmHeight, position)];

  for (const pt of placements) {
    if (watermark.mode === "text" && font) {
      page.drawText(watermark.text, {
        x: pt.x,
        y: pt.y,
        font,
        size: watermark.fontSize,
        color: rgb(watermark.color.r, watermark.color.g, watermark.color.b),
        opacity: watermark.opacity,
        rotate: degreesHelper(rotation),
      });

      if (watermark.underline) {
        page.drawLine({
          start: { x: pt.x, y: pt.y - 2 },
          end: { x: pt.x + wmWidth, y: pt.y - 2 },
          thickness: Math.max(1, watermark.fontSize / 20),
          color: rgb(watermark.color.r, watermark.color.g, watermark.color.b),
          opacity: watermark.opacity,
        });
      }
    } else if (watermark.mode === "image" && image) {
      page.drawImage(image, {
        x: pt.x,
        y: pt.y,
        width: wmWidth,
        height: wmHeight,
        opacity: watermark.opacity,
        rotate: degreesHelper(rotation),
      });
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Main Function ───────────────────────────────────────────────────

export async function insertWatermark(
  input: InsertWatermarkInput
): Promise<InsertWatermarkResult> {
  const { pdfData, fileName, pageOrder, options, fontBytes, onProgress } =
    input;
  const report = (stage: string, progress: number) =>
    onProgress?.({ stage, progress });

  report("Loading PDF...", 5);
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");

  const srcDoc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
  const originalSize = pdfData.byteLength;

  report("Preparing watermark...", 10);
  const newDoc = await PDFDocument.create();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let font: any = null;
  let image: any = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (options.watermark.mode === "text") {
    const config = options.watermark;
    const fontDef = FONT_REGISTRY.find((f) => f.id === config.fontId);

    if (fontDef?.isBuiltIn && fontDef.standardFonts) {
      const variant =
        config.bold && config.italic
          ? "boldItalic"
          : config.bold
            ? "bold"
            : config.italic
              ? "italic"
              : "regular";
      const sfKey = fontDef.standardFonts[variant];
      font = await newDoc.embedFont(
        StandardFonts[sfKey as keyof typeof StandardFonts]
      );
    } else if (fontBytes) {
      // Register fontkit for custom font embedding
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      newDoc.registerFontkit(fontkit);
      font = await newDoc.embedFont(fontBytes);
    } else {
      font = await newDoc.embedFont(StandardFonts.Helvetica);
    }
  } else {
    const config = options.watermark;
    image =
      config.imageType === "png"
        ? await newDoc.embedPng(config.imageData)
        : await newDoc.embedJpg(config.imageData);
  }

  const totalPages = pageOrder.length;
  for (let i = 0; i < totalPages; i++) {
    const srcIdx = pageOrder[i];
    report(
      `Adding watermark to page ${i + 1}/${totalPages}...`,
      15 + ((i + 1) / totalPages) * 70
    );

    if (options.layer === "over") {
      const [copiedPage] = await newDoc.copyPages(srcDoc, [srcIdx]);
      newDoc.addPage(copiedPage);
      drawWatermark(copiedPage, options, font, image, rgb, degrees);
    } else {
      const srcPage = srcDoc.getPage(srcIdx);
      const { width, height } = srcPage.getSize();
      const newPage = newDoc.addPage([width, height]);
      drawWatermark(newPage, options, font, image, rgb, degrees);
      const [embeddedPage] = await newDoc.embedPdf(srcDoc, [srcIdx]);
      newPage.drawPage(embeddedPage, { x: 0, y: 0, width, height });
    }
  }

  report("Saving PDF...", 90);
  const pdfBytes = await newDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const baseName = fileName.replace(/\.pdf$/i, "");

  report("Complete!", 100);

  return {
    blob,
    fileName: `watermarked-${baseName}.pdf`,
    originalSize,
    processedSize: blob.size,
    totalPages,
    watermarkedPages: totalPages,
  };
}
