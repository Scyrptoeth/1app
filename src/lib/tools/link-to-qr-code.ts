/**
 * Link to QR Code Generator
 *
 * Convert URL/text into a customizable QR code PNG image.
 * Uses qr-code-styling for QR generation + Canvas 2D for frame rendering.
 *
 * 100% client-side — no data sent to server.
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export type OnProgress = (update: ProcessingUpdate) => void;

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

export interface QrGenerateOptions {
  url: string;
  dotColor: string;
  bgColor: string;
  transparentBg: boolean;
  frameType: FrameType;
}

export interface QrGenerateResult {
  blob: Blob;
  previewUrl: string;
  fileSize: number;
}

const QR_SIZE = 1024;
const QR_MARGIN = 40;
const FRAME_PADDING = 60;
const TEXT_AREA_HEIGHT = 80;

/**
 * Generate a live preview (lower resolution, no frame) for real-time updates.
 */
export async function generatePreview(
  options: QrGenerateOptions
): Promise<string> {
  const QRCodeStyling = (await import("qr-code-styling")).default;

  const qrCode = new QRCodeStyling({
    width: 256,
    height: 256,
    data: options.url || " ",
    margin: 10,
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
  return URL.createObjectURL(blob);
}

/**
 * Draw a frame around the QR code on a canvas.
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  frameType: FrameType,
  totalWidth: number,
  totalHeight: number,
  dotColor: string,
  bgColor: string,
  transparentBg: boolean
): void {
  const pad = FRAME_PADDING;

  switch (frameType) {
    case "none":
      break;

    case "simple": {
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, totalHeight - pad);
      break;
    }

    case "simple-text": {
      const innerH = totalHeight - TEXT_AREA_HEIGHT;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      // Text
      ctx.fillStyle = dotColor;
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan me!", totalWidth / 2, innerH + TEXT_AREA_HEIGHT / 2 - pad / 4);
      break;
    }

    case "rounded": {
      const r = 24;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.stroke();
      break;
    }

    case "rounded-text": {
      const r = 24;
      const innerH = totalHeight - TEXT_AREA_HEIGHT;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 4;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2, r);
      ctx.stroke();
      // Text
      ctx.fillStyle = dotColor;
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan me!", totalWidth / 2, innerH + TEXT_AREA_HEIGHT / 2 - pad / 4);
      break;
    }

    case "bold": {
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, totalHeight - pad);
      break;
    }

    case "bold-text": {
      const innerH = totalHeight - TEXT_AREA_HEIGHT;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      // Text
      ctx.fillStyle = dotColor;
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan me!", totalWidth / 2, innerH + TEXT_AREA_HEIGHT / 2 - pad / 4);
      break;
    }

    case "shadow": {
      // Drop shadow effect
      ctx.shadowColor = "rgba(0,0,0,0.2)";
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      const r = 16;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.fill();
      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      // Border
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 2;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, totalHeight - pad, r);
      ctx.stroke();
      break;
    }

    case "badge": {
      // Pill-shaped badge below QR
      const innerH = totalHeight - TEXT_AREA_HEIGHT;
      const r = 16;
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 3;
      roundRect(ctx, pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2, r);
      ctx.stroke();
      // Badge pill
      const pillW = 200;
      const pillH = 44;
      const pillX = (totalWidth - pillW) / 2;
      const pillY = innerH + (TEXT_AREA_HEIGHT - pillH) / 2 - pad / 4;
      ctx.fillStyle = dotColor;
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      // Badge text
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("SCAN ME", totalWidth / 2, pillY + pillH / 2);
      break;
    }

    case "banner": {
      // Full-width colored banner below QR
      const innerH = totalHeight - TEXT_AREA_HEIGHT;
      // Border around QR area
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(pad / 2, pad / 2, totalWidth - pad, innerH - pad / 2);
      // Banner rect
      const bannerY = innerH - pad / 4;
      const bannerH = TEXT_AREA_HEIGHT + pad / 4;
      ctx.fillStyle = dotColor;
      ctx.fillRect(pad / 2, bannerY, totalWidth - pad, bannerH);
      // Banner text
      ctx.fillStyle = transparentBg ? "#ffffff" : bgColor;
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Scan me!", totalWidth / 2, bannerY + bannerH / 2);
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

function hasTextArea(frameType: FrameType): boolean {
  return [
    "simple-text",
    "rounded-text",
    "bold-text",
    "badge",
    "banner",
  ].includes(frameType);
}

/**
 * Check if dot/bg color contrast is too low for reliable scanning.
 */
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

/**
 * Main entry point: generate a high-quality QR code PNG with frame and color customization.
 */
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

  // If no frame, return QR as-is
  if (options.frameType === "none") {
    const url = URL.createObjectURL(qrBlob);
    onProgress({ progress: 100, status: "Complete!" });
    return { blob: qrBlob, previewUrl: url, fileSize: qrBlob.size };
  }

  // Draw frame around QR on a larger canvas
  const qrImg = await createImageBitmap(qrBlob);
  const addText = hasTextArea(options.frameType);
  const totalWidth = QR_SIZE + FRAME_PADDING;
  const totalHeight = QR_SIZE + FRAME_PADDING + (addText ? TEXT_AREA_HEIGHT : 0);

  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d")!;

  // Fill background
  if (options.transparentBg) {
    ctx.clearRect(0, 0, totalWidth, totalHeight);
  } else {
    ctx.fillStyle = options.bgColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);
  }

  onProgress({ progress: 70, status: "Drawing frame..." });

  // Draw frame (behind QR for shadow, around for borders)
  if (options.frameType === "shadow") {
    drawFrame(ctx, options.frameType, totalWidth, totalHeight, options.dotColor, options.bgColor, options.transparentBg);
  }

  // Draw QR code centered
  const qrX = FRAME_PADDING / 2;
  const qrY = FRAME_PADDING / 2;
  ctx.drawImage(qrImg, qrX, qrY, QR_SIZE, QR_SIZE);

  // Draw frame (on top for borders)
  if (options.frameType !== "shadow") {
    drawFrame(ctx, options.frameType, totalWidth, totalHeight, options.dotColor, options.bgColor, options.transparentBg);
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
