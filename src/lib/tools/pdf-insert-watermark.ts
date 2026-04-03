/**
 * PDF Insert Watermark
 *
 * Adds text or image watermark to PDF pages using pdf-lib.
 * - "over" layer: copyPages() (lossless) + draw watermark on top
 * - "below" layer: new page + watermark + embedPdf() original content on top
 * Supports 9-point positioning, mosaic pattern, rotation, and opacity.
 */

import { renderPageThumbnail, getPdfPageCount } from "./pdf-splitter";
import { getPageDimensions } from "./pdf-reorder";

export { renderPageThumbnail, getPdfPageCount, getPageDimensions };
export type { PageDimensions } from "./pdf-reorder";

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
  fontFamily: "Helvetica" | "Times-Roman" | "Courier";
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

// ─── Font Mapping ────────────────────────────────────────────────────

function getStandardFontKey(
  family: string,
  bold: boolean,
  italic: boolean
): string {
  const variants: Record<string, Record<string, string>> = {
    Helvetica: {
      "": "Helvetica",
      b: "HelveticaBold",
      i: "HelveticaOblique",
      bi: "HelveticaBoldOblique",
    },
    "Times-Roman": {
      "": "TimesRoman",
      b: "TimesRomanBold",
      i: "TimesRomanItalic",
      bi: "TimesRomanBoldItalic",
    },
    Courier: {
      "": "Courier",
      b: "CourierBold",
      i: "CourierOblique",
      bi: "CourierBoldOblique",
    },
  };
  const style = (bold ? "b" : "") + (italic ? "i" : "");
  return variants[family]?.[style] || "Helvetica";
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

  // PDF y-axis: 0 = bottom, increases upward
  let y: number;
  if (position.startsWith("top")) y = pageHeight - margin - wmHeight;
  else if (position.startsWith("bottom")) y = margin;
  else y = (pageHeight - wmHeight) / 2;

  return { x, y };
}

// ─── Mosaic Pattern ──────────────────────────────────────────────────

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
  const { pdfData, fileName, pageOrder, options, onProgress } = input;
  const report = (stage: string, progress: number) =>
    onProgress?.({ stage, progress });

  report("Loading PDF...", 5);
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");

  const srcDoc = await PDFDocument.load(pdfData, { ignoreEncryption: true });
  const originalSize = pdfData.byteLength;

  report("Preparing watermark...", 10);
  const newDoc = await PDFDocument.create();

  // Embed font (text mode) or image (image mode)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let font: any = null;
  let image: any = null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (options.watermark.mode === "text") {
    const config = options.watermark;
    const fontKey = getStandardFontKey(
      config.fontFamily,
      config.bold,
      config.italic
    );
    font = await newDoc.embedFont(
      StandardFonts[fontKey as keyof typeof StandardFonts]
    );
  } else {
    const config = options.watermark;
    image =
      config.imageType === "png"
        ? await newDoc.embedPng(config.imageData)
        : await newDoc.embedJpg(config.imageData);
  }

  // Process each page
  const totalPages = pageOrder.length;
  for (let i = 0; i < totalPages; i++) {
    const srcIdx = pageOrder[i];
    report(
      `Adding watermark to page ${i + 1}/${totalPages}...`,
      15 + ((i + 1) / totalPages) * 70
    );

    if (options.layer === "over") {
      // Lossless copy + draw watermark on top
      const [copiedPage] = await newDoc.copyPages(srcDoc, [srcIdx]);
      newDoc.addPage(copiedPage);
      drawWatermark(copiedPage, options, font, image, rgb, degrees);
    } else {
      // "below": create blank page, draw watermark, overlay original content
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
