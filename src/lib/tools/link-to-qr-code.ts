/**
 * Link to QR Code Generator
 *
 * Convert URL/text into a customizable QR code PNG image.
 * Uses qr-code-styling for QR generation + Canvas 2D for frame rendering.
 * Supports 20 fonts (3 system + 17 Google Fonts) for frame text.
 *
 * 100% client-side — no data sent to server.
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export type OnProgress = (update: ProcessingUpdate) => void;

// ─── Font Registry ───────────────────────────────────────────────────

export interface QrFontDef {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "monospace" | "display";
  canvasFamily: string;
  googleFamily?: string;
}

export const QR_FONT_REGISTRY: QrFontDef[] = [
  // System fonts (no fetch needed)
  { id: "helvetica", name: "Helvetica", category: "sans-serif", canvasFamily: "Helvetica, Arial, sans-serif" },
  { id: "times-roman", name: "Times Roman", category: "serif", canvasFamily: "'Times New Roman', Times, serif" },
  { id: "courier", name: "Courier", category: "monospace", canvasFamily: "'Courier New', Courier, monospace" },
  // Google Fonts — loaded on-demand via CSS <link>
  { id: "inter", name: "Inter", category: "sans-serif", canvasFamily: "'Inter', sans-serif", googleFamily: "Inter" },
  { id: "dm-sans", name: "DM Sans", category: "sans-serif", canvasFamily: "'DM Sans', sans-serif", googleFamily: "DM Sans" },
  { id: "nunito", name: "Nunito", category: "sans-serif", canvasFamily: "'Nunito', sans-serif", googleFamily: "Nunito" },
  { id: "open-sans", name: "Open Sans", category: "sans-serif", canvasFamily: "'Open Sans', sans-serif", googleFamily: "Open Sans" },
  { id: "roboto", name: "Roboto", category: "sans-serif", canvasFamily: "'Roboto', sans-serif", googleFamily: "Roboto" },
  { id: "lato", name: "Lato", category: "sans-serif", canvasFamily: "'Lato', sans-serif", googleFamily: "Lato" },
  { id: "montserrat", name: "Montserrat", category: "sans-serif", canvasFamily: "'Montserrat', sans-serif", googleFamily: "Montserrat" },
  { id: "poppins", name: "Poppins", category: "sans-serif", canvasFamily: "'Poppins', sans-serif", googleFamily: "Poppins" },
  { id: "raleway", name: "Raleway", category: "sans-serif", canvasFamily: "'Raleway', sans-serif", googleFamily: "Raleway" },
  { id: "noto-sans", name: "Noto Sans", category: "sans-serif", canvasFamily: "'Noto Sans', sans-serif", googleFamily: "Noto Sans" },
  { id: "pt-sans", name: "PT Sans", category: "sans-serif", canvasFamily: "'PT Sans', sans-serif", googleFamily: "PT Sans" },
  { id: "source-sans-3", name: "Source Sans 3", category: "sans-serif", canvasFamily: "'Source Sans 3', sans-serif", googleFamily: "Source Sans 3" },
  { id: "ubuntu", name: "Ubuntu", category: "sans-serif", canvasFamily: "'Ubuntu', sans-serif", googleFamily: "Ubuntu" },
  { id: "comic-neue", name: "Comic Neue", category: "display", canvasFamily: "'Comic Neue', cursive", googleFamily: "Comic Neue" },
  { id: "pt-serif", name: "PT Serif", category: "serif", canvasFamily: "'PT Serif', serif", googleFamily: "PT Serif" },
  { id: "merriweather", name: "Merriweather", category: "serif", canvasFamily: "'Merriweather', serif", googleFamily: "Merriweather" },
  { id: "playfair-display", name: "Playfair Display", category: "serif", canvasFamily: "'Playfair Display', serif", googleFamily: "Playfair Display" },
];

// ─── Frame Types ────────────────────────────────────────────────────

export const FRAME_TYPES = [
  "none",
  "simple",
  "simple-text",
  "rounded",
  "rounded-text",
  "bold",
  "bold-text",
  "shadow",
  "badge",
  "banner",
] as const;

export type FrameType = (typeof FRAME_TYPES)[number];

export const FRAME_LABELS: Record<FrameType, string> = {
  none: "No Frame",
  simple: "Simple",
  "simple-text": "Simple + Text",
  rounded: "Rounded",
  "rounded-text": "Rounded + Text",
  bold: "Bold",
  "bold-text": "Bold + Text",
  shadow: "Shadow",
  badge: "Badge",
  banner: "Banner",
};

export function hasTextArea(frameType: FrameType): boolean {
  return [
    "simple-text",
    "rounded-text",
    "bold-text",
    "badge",
    "banner",
  ].includes(frameType);
}

// ─── Options & Result ───────────────────────────────────────────────

export interface QrGenerateOptions {
  url: string;
  dotColor: string;
  bgColor: string;
  transparentBg: boolean;
  frameType: FrameType;
  frameText: string;
  frameFontFamily: string;
  frameFontSize: number;
}

export interface QrGenerateResult {
  blob: Blob;
  previewUrl: string;
  fileSize: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const QR_SIZE = 1024;
const QR_MARGIN = 40;
const FRAME_PADDING = 60;
const DEFAULT_FONT_SIZE = 40;

function getTextAreaHeight(fontSize: number): number {
  return Math.max(80, fontSize * 2.2);
}

// ─── Preview (with frame) ───────────────────────────────────────────

const PREVIEW_QR = 320;
const PREVIEW_MARGIN = 12;
const PREVIEW_PAD = 20;

/**
 * Generate a live preview with frame at preview resolution.
 */
export async function generatePreview(
  options: QrGenerateOptions
): Promise<string> {
  const QRCodeStyling = (await import("qr-code-styling")).default;

  const qrCode = new QRCodeStyling({
    width: PREVIEW_QR,
    height: PREVIEW_QR,
    data: options.url || " ",
    margin: PREVIEW_MARGIN,
    dotsOptions: {
      color: options.dotColor,
      type: "square",
    },
    backgroundOptions: {
      color: options.transparentBg ? "transparent" : options.bgColor,
    },
    qrOptions: {
      errorCorrectionLevel: "M",
    },
  });

  const blob = await qrCode.getRawData("png");
  if (!blob) throw new Error("Failed to generate QR preview");

  // No frame → return bare QR
  if (options.frameType === "none") {
    return URL.createObjectURL(blob);
  }

  // Composite QR + frame on Canvas
  const qrImg = await createImageBitmap(blob);
  const fontSize = options.frameFontSize || DEFAULT_FONT_SIZE;
  const scale = PREVIEW_QR / QR_SIZE;
  const scaledPad = PREVIEW_PAD;
  const addText = hasTextArea(options.frameType);
  const scaledTextH = addText ? getTextAreaHeight(fontSize) * scale : 0;
  const totalW = PREVIEW_QR + scaledPad;
  const totalH = PREVIEW_QR + scaledPad + scaledTextH;

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d")!;

  // Background
  if (options.transparentBg) {
    ctx.clearRect(0, 0, totalW, totalH);
  } else {
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, totalW, totalH);
  }

  // Draw frame (shadow behind, others on top)
  if (options.frameType === "shadow") {
    drawFrame(ctx, options, totalW, totalH, scale);
  }

  // Draw QR centered
  ctx.drawImage(qrImg, scaledPad / 2, scaledPad / 2, PREVIEW_QR, PREVIEW_QR);

  if (options.frameType !== "shadow") {
    drawFrame(ctx, options, totalW, totalH, scale);
  }

  const finalBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Preview export failed"))),
      "image/png"
    );
  });

  return URL.createObjectURL(finalBlob);
}

// ─── Frame Drawing ──────────────────────────────────────────────────

function drawFrame(
  ctx: CanvasRenderingContext2D,
  options: QrGenerateOptions,
  totalWidth: number,
  totalHeight: number,
  scale: number = 1,
): void {
  const { frameType, dotColor, bgColor, transparentBg, frameText, frameFontFamily, frameFontSize } = options;
  const pad = FRAME_PADDING * scale;
  const fontSize = (frameFontSize || DEFAULT_FONT_SIZE) * scale;
  const textH = getTextAreaHeight(frameFontSize || DEFAULT_FONT_SIZE) * scale;
  const fontStyle = `bold ${fontSize}px ${frameFontFamily || "sans-serif"}`;
  const text = frameText || "Scan me!";

  switch (frameType) {
    case "none":
      break;

    case "simple": {
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4 * scale;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, totalHeight - pad);
      break;
    }

    case "simple-text": {
      const innerH = totalHeight - textH;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4 * scale;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      ctx.fillStyle = dotColor;
      ctx.font = fontStyle;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, totalWidth / 2, innerH + textH / 2 - pad / 4, totalWidth - pad);
      break;
    }

    case "rounded": {
      const r = 24 * scale;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4 * scale;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.stroke();
      break;
    }

    case "rounded-text": {
      const r = 24 * scale;
      const innerH = totalHeight - textH;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4 * scale;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2, r);
      ctx.stroke();
      ctx.fillStyle = dotColor;
      ctx.font = fontStyle;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, totalWidth / 2, innerH + textH / 2 - pad / 4, totalWidth - pad);
      break;
    }

    case "bold": {
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 8 * scale;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, totalHeight - pad);
      break;
    }

    case "bold-text": {
      const innerH = totalHeight - textH;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 8 * scale;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      ctx.fillStyle = dotColor;
      ctx.font = fontStyle;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, totalWidth / 2, innerH + textH / 2 - pad / 4, totalWidth - pad);
      break;
    }

    case "shadow": {
      ctx.shadowColor = "rgba(0,0,0,0.2)";
      ctx.shadowBlur = 20 * scale;
      ctx.shadowOffsetX = 4 * scale;
      ctx.shadowOffsetY = 4 * scale;
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      const r = 16 * scale;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 2 * scale;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.stroke();
      break;
    }

    case "badge": {
      const innerH = totalHeight - textH;
      const r = 16 * scale;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 3 * scale;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2, r);
      ctx.stroke();
      // Badge pill — sized to fit text
      const pillH = Math.max(44 * scale, fontSize * 1.4);
      const pillW = Math.max(200 * scale, fontSize * text.length * 0.65 + 40 * scale);
      const pillX = (totalWidth - pillW) / 2;
      const pillY = innerH + (textH - pillH) / 2 - pad / 4;
      ctx.fillStyle = dotColor;
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      ctx.font = fontStyle;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, totalWidth / 2, pillY + pillH / 2, pillW - 20 * scale);
      break;
    }

    case "banner": {
      const innerH = totalHeight - textH;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 3 * scale;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      const bannerY = innerH - pad / 4;
      const bannerH = textH + pad / 4;
      ctx.fillStyle = dotColor;
      ctx.fillRect(pad / 2, bannerY, totalWidth - pad, bannerH);
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      ctx.font = fontStyle;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, totalWidth / 2, bannerY + bannerH / 2, totalWidth - pad * 2);
      break;
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Contrast Check ─────────────────────────────────────────────────

export function getContrastWarning(dotColor: string, bgColor: string): string | null {
  const lum1 = relativeLuminance(dotColor);
  const lum2 = relativeLuminance(bgColor);
  const ratio = (Math.max(lum1, lum2) + 0.05) / (Math.min(lum1, lum2) + 0.05);
  if (ratio < 3) {
    return "Low contrast between dot and background colors. The QR code may not be scannable by some readers.";
  }
  return null;
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// ─── Main Generation ────────────────────────────────────────────────

export async function generateQrCode(
  options: QrGenerateOptions,
  onProgress: OnProgress
): Promise<QrGenerateResult> {
  onProgress({ progress: 5, status: "Loading QR generator..." });

  const QRCodeStyling = (await import("qr-code-styling")).default;

  onProgress({ progress: 15, status: "Generating QR code..." });

  const qrCode = new QRCodeStyling({
    width: QR_SIZE,
    height: QR_SIZE,
    data: options.url,
    margin: QR_MARGIN,
    dotsOptions: {
      color: options.dotColor,
      type: "square",
    },
    backgroundOptions: {
      color: options.transparentBg ? "transparent" : options.bgColor,
    },
    qrOptions: {
      errorCorrectionLevel: "H",
    },
  });

  onProgress({ progress: 40, status: "Rendering QR code..." });

  const qrBlob = await qrCode.getRawData("png");
  if (!qrBlob) throw new Error("Failed to generate QR code");

  onProgress({ progress: 55, status: "Applying frame..." });

  // No frame → return QR as-is
  if (options.frameType === "none") {
    const url = URL.createObjectURL(qrBlob);
    onProgress({ progress: 100, status: "Complete!" });
    return { blob: qrBlob, previewUrl: url, fileSize: qrBlob.size };
  }

  // Draw frame around QR on a larger canvas
  const qrImg = await createImageBitmap(qrBlob);
  const addText = hasTextArea(options.frameType);
  const textH = addText ? getTextAreaHeight(options.frameFontSize || DEFAULT_FONT_SIZE) : 0;
  const totalWidth = QR_SIZE + FRAME_PADDING;
  const totalHeight = QR_SIZE + FRAME_PADDING + textH;

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d")!;

  if (options.transparentBg) {
    ctx.clearRect(0, 0, totalWidth, totalHeight);
  } else {
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  onProgress({ progress: 70, status: "Drawing frame..." });

  if (options.frameType === "shadow") {
    drawFrame(ctx, options, totalWidth, totalHeight);
  }

  const qrX = FRAME_PADDING / 2;
  const qrY = FRAME_PADDING / 2;
  ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);

  if (options.frameType !== "shadow") {
    drawFrame(ctx, options, totalWidth, totalHeight);
  }

  onProgress({ progress: 90, status: "Exporting PNG..." });

  const finalBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/png"
    );
  });

  const url = URL.createObjectURL(finalBlob);

  onProgress({ progress: 100, status: "Complete!" });

  return { blob: finalBlob, previewUrl: url, fileSize: finalBlob.size };
}
