/**
 * QR Code to Link Decoder
 *
 * Decode single or multiple QR codes from an uploaded image.
 * Strategy: iterative scan with masking
 *
 * 1. Load image onto Canvas, extract ImageData
 * 2. Run jsQR to find first QR code
 * 3. If found, mask the QR region (white-fill) and re-scan
 * 4. Repeat until no more QR codes or max 20 iterations
 * 5. Return all decoded results with location data
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

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Main entry point: decode all QR codes from an image file.
 */
export async function decodeQrFromImage(
  file: File,
  onProgress: OnProgress
): Promise<QrDecodeResult> {
  onProgress({ progress: 5, status: "Loading image..." });

  const jsQR = (await import("jsqr")).default;

  const imageBitmap = await createImageBitmap(file);
  let { width, height } = imageBitmap;

  // Resize if too large for performance
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(imageBitmap, 0, 0, width, height);

  onProgress({ progress: 15, status: "Scanning for QR codes..." });

  const codes: DecodedQr[] = [];
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const result = jsQR(imageData.data, width, height);

    if (!result) break;

    const decoded: DecodedQr = {
      data: result.data,
      isUrl: isValidUrl(result.data),
      location: {
        topLeft: { x: result.location.topLeftCorner.x, y: result.location.topLeftCorner.y },
        topRight: { x: result.location.topRightCorner.x, y: result.location.topRightCorner.y },
        bottomLeft: { x: result.location.bottomLeftCorner.x, y: result.location.bottomLeftCorner.y },
        bottomRight: { x: result.location.bottomRightCorner.x, y: result.location.bottomRightCorner.y },
      },
    };

    codes.push(decoded);
    iteration++;

    const progressPct = 15 + Math.min(75, iteration * 5);
    onProgress({
      progress: progressPct,
      status: `Found ${codes.length} QR code${codes.length > 1 ? "s" : ""}...`,
    });

    // Mask the found QR region with white to find next one
    const loc = result.location;
    const minX = Math.floor(Math.min(loc.topLeftCorner.x, loc.bottomLeftCorner.x)) - 10;
    const minY = Math.floor(Math.min(loc.topLeftCorner.y, loc.topRightCorner.y)) - 10;
    const maxX = Math.ceil(Math.max(loc.topRightCorner.x, loc.bottomRightCorner.x)) + 10;
    const maxY = Math.ceil(Math.max(loc.bottomLeftCorner.y, loc.bottomRightCorner.y)) + 10;

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(
      Math.max(0, minX),
      Math.max(0, minY),
      Math.min(width, maxX) - Math.max(0, minX),
      Math.min(height, maxY) - Math.max(0, minY)
    );
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
