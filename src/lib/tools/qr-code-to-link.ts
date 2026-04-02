/**
 * QR Code to Link Decoder
 *
 * Decode single or multiple QR codes from an uploaded image.
 * Strategy: multi-pass scan with preprocessing fallbacks
 *
 * 1. Load image onto Canvas with white padding (quiet zone)
 * 2. Try jsQR on raw image data
 * 3. If fails: binarize (force pure B/W) and retry
 * 4. If fails: try inverted colors
 * 5. If fails: try downscaled version
 * 6. For multi-QR: mask found region and re-scan (max 20 iterations)
 *
 * Why multi-pass? jsQR struggles with:
 * - Anti-aliased edges (not pure black/white pixels)
 * - Missing/insufficient quiet zones (white margin around QR)
 * - Very large images
 *
 * 100% client-side — no data sent to server.
 */

export interface DecodedQr {
  data: string;
  isUrl: boolean;
  location: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
  };
}

export interface QrDecodeResult {
  codes: DecodedQr[];
  totalFound: number;
  originalSize: number;
  qualityScore: number;
}

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export type OnProgress = (update: ProcessingUpdate) => void;

const MAX_ITERATIONS = 20;
const MAX_DIMENSION = 2048;
const QUIET_ZONE = 40;

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type JsQRFn = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => {
  data: string;
  location: {
    topLeftCorner: { x: number; y: number };
    topRightCorner: { x: number; y: number };
    bottomLeftCorner: { x: number; y: number };
    bottomRightCorner: { x: number; y: number };
  };
} | null;

/**
 * Binarize image data: force every pixel to pure black or white.
 * Threshold at 128 gray value.
 */
function binarize(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4) {
    const gray = (out[i] + out[i + 1] + out[i + 2]) / 3;
    const val = gray > 128 ? 255 : 0;
    out[i] = val;
    out[i + 1] = val;
    out[i + 2] = val;
  }
  return out;
}

/**
 * Invert image data colors.
 */
function invert(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i];
    out[i + 1] = 255 - out[i + 1];
    out[i + 2] = 255 - out[i + 2];
  }
  return out;
}

/**
 * Create a canvas with white padding around the image for quiet zone.
 */
function createPaddedCanvas(
  source: HTMLCanvasElement | ImageBitmap,
  drawWidth: number,
  drawHeight: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; totalWidth: number; totalHeight: number } {
  const totalWidth = drawWidth + QUIET_ZONE * 2;
  const totalHeight = drawHeight + QUIET_ZONE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, totalWidth, totalHeight);
  ctx.drawImage(source, QUIET_ZONE, QUIET_ZONE, drawWidth, drawHeight);
  return { canvas, ctx, totalWidth, totalHeight };
}

/**
 * Try to decode a QR code from image data using multiple preprocessing strategies.
 * Returns the first successful result, or null if all fail.
 */
function tryDecode(
  jsQR: JsQRFn,
  rawData: Uint8ClampedArray,
  width: number,
  height: number
): ReturnType<JsQRFn> {
  // Pass 1: raw image
  const r1 = jsQR(rawData, width, height);
  if (r1) return r1;

  // Pass 2: binarized (force pure B/W — fixes anti-aliased edges)
  const r2 = jsQR(binarize(rawData), width, height);
  if (r2) return r2;

  // Pass 3: inverted (some QR images have inverted polarity)
  const r3 = jsQR(invert(rawData), width, height);
  if (r3) return r3;

  // Pass 4: binarized + inverted
  const r4 = jsQR(invert(binarize(rawData)), width, height);
  if (r4) return r4;

  return null;
}

/**
 * Adjust QR location coordinates to account for padding offset.
 */
function adjustLocation(loc: ReturnType<JsQRFn> extends infer R ? R extends null ? never : R : never) {
  return {
    topLeft: { x: loc.location.topLeftCorner.x - QUIET_ZONE, y: loc.location.topLeftCorner.y - QUIET_ZONE },
    topRight: { x: loc.location.topRightCorner.x - QUIET_ZONE, y: loc.location.topRightCorner.y - QUIET_ZONE },
    bottomLeft: { x: loc.location.bottomLeftCorner.x - QUIET_ZONE, y: loc.location.bottomLeftCorner.y - QUIET_ZONE },
    bottomRight: { x: loc.location.bottomRightCorner.x - QUIET_ZONE, y: loc.location.bottomRightCorner.y - QUIET_ZONE },
  };
}

/**
 * Main entry point: decode all QR codes from an image file.
 */
export async function decodeQrFromImage(
  file: File,
  onProgress: OnProgress
): Promise<QrDecodeResult> {
  onProgress({ progress: 5, status: "Loading image..." });

  const jsQR = (await import("jsqr")).default as unknown as JsQRFn;

  const imageBitmap = await createImageBitmap(file);
  let { width, height } = imageBitmap;

  // Resize if too large for performance
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  onProgress({ progress: 10, status: "Preparing image..." });

  // Create padded canvas (adds quiet zone for better QR detection)
  const { ctx, totalWidth, totalHeight } = createPaddedCanvas(
    imageBitmap,
    width,
    height
  );

  onProgress({ progress: 15, status: "Scanning for QR codes..." });

  const codes: DecodedQr[] = [];
  const seenData = new Set<string>();
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    const imageData = ctx.getImageData(0, 0, totalWidth, totalHeight);

    onProgress({
      progress: 15 + Math.min(70, iteration * 8),
      status: iteration === 0
        ? "Scanning for QR codes..."
        : `Found ${codes.length}, scanning for more...`,
    });

    const result = tryDecode(jsQR, imageData.data, totalWidth, totalHeight);

    if (!result) break;

    // Deduplicate (masking might re-detect same QR at slightly different position)
    if (seenData.has(result.data)) {
      // Mask and continue to avoid infinite loop
      maskRegion(ctx, result.location, totalWidth, totalHeight);
      iteration++;
      continue;
    }

    seenData.add(result.data);

    codes.push({
      data: result.data,
      isUrl: isValidUrl(result.data),
      location: adjustLocation(result),
    });

    // Mask the found QR region with white to find next one
    maskRegion(ctx, result.location, totalWidth, totalHeight);
    iteration++;
  }

  // If no results found at full size, try downscaled as last resort
  if (codes.length === 0 && (width > 500 || height > 500)) {
    onProgress({ progress: 85, status: "Trying enhanced scan..." });

    const scale = 0.5;
    const smallW = Math.round(width * scale);
    const smallH = Math.round(height * scale);
    const { ctx: sCtx, totalWidth: sTW, totalHeight: sTH } = createPaddedCanvas(
      imageBitmap,
      smallW,
      smallH
    );
    const sData = sCtx.getImageData(0, 0, sTW, sTH);
    const sResult = tryDecode(jsQR, sData.data, sTW, sTH);

    if (sResult) {
      codes.push({
        data: sResult.data,
        isUrl: isValidUrl(sResult.data),
        location: adjustLocation(sResult),
      });
    }
  }

  onProgress({ progress: 95, status: "Finalizing results..." });

  const qualityScore = codes.length > 0 ? 100 : 0;

  onProgress({ progress: 100, status: "Complete!" });

  return {
    codes,
    totalFound: codes.length,
    originalSize: file.size,
    qualityScore,
  };
}

function maskRegion(
  ctx: CanvasRenderingContext2D,
  location: { topLeftCorner: { x: number; y: number }; topRightCorner: { x: number; y: number }; bottomLeftCorner: { x: number; y: number }; bottomRightCorner: { x: number; y: number } },
  canvasWidth: number,
  canvasHeight: number
) {
  const margin = 15;
  const minX = Math.floor(Math.min(location.topLeftCorner.x, location.bottomLeftCorner.x)) - margin;
  const minY = Math.floor(Math.min(location.topLeftCorner.y, location.topRightCorner.y)) - margin;
  const maxX = Math.ceil(Math.max(location.topRightCorner.x, location.bottomRightCorner.x)) + margin;
  const maxY = Math.ceil(Math.max(location.bottomLeftCorner.y, location.bottomRightCorner.y)) + margin;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(
    Math.max(0, minX),
    Math.max(0, minY),
    Math.min(canvasWidth, maxX) - Math.max(0, minX),
    Math.min(canvasHeight, maxY) - Math.max(0, minY)
  );
}
