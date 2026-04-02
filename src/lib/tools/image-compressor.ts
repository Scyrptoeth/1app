/**
 * Image Compressor
 *
 * Compresses JPEG/PNG images client-side using Canvas API.
 * - JPEG: re-encodes at lower quality via canvas.toBlob
 * - PNG: Median Cut quantization + Floyd-Steinberg dithering + indexed PNG encoding
 *
 * Key techniques for PNG (matching professional tools like pngquant/iLoveImg):
 * 1. Median Cut color quantization to build optimal palette
 * 2. Floyd-Steinberg error diffusion dithering to eliminate visible banding
 * 3. Custom indexed PNG encoder (PNG-8 palette mode) for dramatically smaller files
 * 4. CompressionStream API for zlib/deflate compression
 *
 * Dimensions are always preserved. PNG alpha channel is preserved.
 */

export interface ProcessingUpdate {
  progress: number;
  status: string;
}

export interface ImageCompressionMode {
  id: "high" | "medium" | "low";
  label: string;
  description: string;
  jpegQuality: number;
  pngColorCount: number;
  estimateRatio: number;
}

export interface ImageCompressionResult {
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  width: number;
  height: number;
  format: "jpeg" | "png";
  previewUrl: string;
}

export const COMPRESSION_MODES: ImageCompressionMode[] = [
  {
    id: "high",
    label: "High Compress, Low Quality",
    description:
      "Maximum compression with dithering. Much smaller file, good for web thumbnails.",
    jpegQuality: 0.3,
    pngColorCount: 48,
    estimateRatio: 0.25,
  },
  {
    id: "medium",
    label: "Medium Compress, Medium Quality",
    description:
      "Balanced compression. Great quality for most images with significant size reduction.",
    jpegQuality: 0.6,
    pngColorCount: 128,
    estimateRatio: 0.4,
  },
  {
    id: "low",
    label: "Low Compress, High Quality",
    description:
      "Minimal compression. Quality is nearly identical to the original image.",
    jpegQuality: 0.85,
    pngColorCount: 256,
    estimateRatio: 0.6,
  },
];

export function estimateCompressedSize(
  originalSize: number,
  mode: ImageCompressionMode
): number {
  return Math.round(originalSize * mode.estimateRatio);
}

function detectFormat(file: File): "jpeg" | "png" {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "png";
  return "jpeg";
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// CRC32 for PNG chunk checksums
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// PNG Encoder — indexed (palette) mode for dramatically smaller files
// ---------------------------------------------------------------------------

function writeUint32BE(arr: Uint8Array, offset: number, val: number): void {
  arr[offset] = (val >> 24) & 0xff;
  arr[offset + 1] = (val >> 16) & 0xff;
  arr[offset + 2] = (val >> 8) & 0xff;
  arr[offset + 3] = val & 0xff;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crcVal = crc32(crcInput);

  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32BE(chunk, 8 + data.length, crcVal);
  return chunk;
}

async function deflateCompress(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream();
  const compressed = stream.pipeThrough(new CompressionStream("deflate"));
  const reader = compressed.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function encodeIndexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: [number, number, number][],
  hasTransparency: boolean
): Promise<Blob> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit depth 8, color type 3 (indexed)
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type: indexed
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // PLTE: palette RGB values
  const plte = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plte[i * 3] = palette[i][0];
    plte[i * 3 + 1] = palette[i][1];
    plte[i * 3 + 2] = palette[i][2];
  }

  // tRNS: transparency for palette entry 0 (if transparency exists)
  let trnsChunk: Uint8Array | null = null;
  if (hasTransparency) {
    const trns = new Uint8Array(1);
    trns[0] = 0; // palette entry 0 is fully transparent
    trnsChunk = createPngChunk("tRNS", trns);
  }

  // Image data: filter byte 0 (None) + palette indices per row
  const rawData = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width);
    rawData[rowOffset] = 0; // filter: None
    rawData.set(
      indices.subarray(y * width, y * width + width),
      rowOffset + 1
    );
  }

  const compressedData = await deflateCompress(rawData);

  // Assemble PNG
  const chunks: Uint8Array[] = [
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("PLTE", plte),
  ];
  if (trnsChunk) chunks.push(trnsChunk);
  chunks.push(createPngChunk("IDAT", compressedData));
  chunks.push(createPngChunk("IEND", new Uint8Array(0)));

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([result], { type: "image/png" });
}

// ---------------------------------------------------------------------------
// Median Cut Color Quantization
// ---------------------------------------------------------------------------

interface ColorBox {
  pixels: Uint8Array;
  count: number;
}

function buildColorBox(imageData: ImageData, sampleSize: number): ColorBox {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  const step = Math.max(1, Math.floor(totalPixels / sampleSize));

  const sampled: number[] = [];
  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    if (data[idx + 3] === 0) continue;
    sampled.push(data[idx], data[idx + 1], data[idx + 2]);
  }

  return {
    pixels: new Uint8Array(sampled),
    count: sampled.length / 3,
  };
}

function findLongestAxis(box: ColorBox): number {
  let minR = 255, maxR = 0;
  let minG = 255, maxG = 0;
  let minB = 255, maxB = 0;

  for (let i = 0; i < box.pixels.length; i += 3) {
    const r = box.pixels[i];
    const g = box.pixels[i + 1];
    const b = box.pixels[i + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  // Weight green channel more (human eye is most sensitive to green)
  const rangeR = (maxR - minR) * 0.299;
  const rangeG = (maxG - minG) * 0.587;
  const rangeB = (maxB - minB) * 0.114;

  if (rangeR >= rangeG && rangeR >= rangeB) return 0;
  if (rangeG >= rangeR && rangeG >= rangeB) return 1;
  return 2;
}

function splitBox(box: ColorBox, axis: number): [ColorBox, ColorBox] {
  const buckets: number[][] = new Array(256);
  for (let i = 0; i < 256; i++) buckets[i] = [];

  for (let i = 0; i < box.pixels.length; i += 3) {
    const val = box.pixels[i + axis];
    buckets[val].push(box.pixels[i], box.pixels[i + 1], box.pixels[i + 2]);
  }

  const sorted: number[] = [];
  for (let v = 0; v < 256; v++) {
    for (let j = 0; j < buckets[v].length; j++) {
      sorted.push(buckets[v][j]);
    }
  }

  const mid = Math.floor(sorted.length / 2);
  const splitAt = mid - (mid % 3);

  return [
    { pixels: new Uint8Array(sorted.slice(0, splitAt)), count: splitAt / 3 },
    {
      pixels: new Uint8Array(sorted.slice(splitAt)),
      count: (sorted.length - splitAt) / 3,
    },
  ];
}

function boxAverage(box: ColorBox): [number, number, number] {
  let totalR = 0, totalG = 0, totalB = 0;
  for (let i = 0; i < box.pixels.length; i += 3) {
    totalR += box.pixels[i];
    totalG += box.pixels[i + 1];
    totalB += box.pixels[i + 2];
  }
  const n = box.count || 1;
  return [
    Math.round(totalR / n),
    Math.round(totalG / n),
    Math.round(totalB / n),
  ];
}

function medianCutPalette(
  imageData: ImageData,
  targetColors: number
): [number, number, number][] {
  const initialBox = buildColorBox(imageData, 20000);
  if (initialBox.count === 0) return [[0, 0, 0]];

  const boxes: ColorBox[] = [initialBox];

  while (boxes.length < targetColors) {
    let maxIdx = 0;
    let maxCount = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].count > maxCount) {
        maxCount = boxes[i].count;
        maxIdx = i;
      }
    }

    if (boxes[maxIdx].count <= 1) break;

    const axis = findLongestAxis(boxes[maxIdx]);
    const [a, b] = splitBox(boxes[maxIdx], axis);

    if (a.count === 0 || b.count === 0) break;

    boxes.splice(maxIdx, 1, a, b);
  }

  return boxes.map(boxAverage);
}

// ---------------------------------------------------------------------------
// Floyd-Steinberg Error Diffusion Dithering
// ---------------------------------------------------------------------------

function findNearestColorIdx(
  r: number,
  g: number,
  b: number,
  palette: [number, number, number][]
): number {
  let bestDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0];
    const dg = g - palette[i][1];
    const db = b - palette[i][2];
    // Perceptual weighting: green > red > blue
    const dist = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
      if (dist === 0) break;
    }
  }

  return bestIdx;
}

function applyDithering(
  imageData: ImageData,
  palette: [number, number, number][],
  transparentIndex: number | null,
  onProgress: (pct: number) => void
): Uint8Array {
  const { data, width, height } = imageData;
  const totalPixels = width * height;

  // Float buffer for error accumulation (RGB only)
  const buf = new Float32Array(totalPixels * 3);
  for (let i = 0; i < totalPixels; i++) {
    buf[i * 3] = data[i * 4];
    buf[i * 3 + 1] = data[i * 4 + 1];
    buf[i * 3 + 2] = data[i * 4 + 2];
  }

  const indices = new Uint8Array(totalPixels);
  const stride = width * 3;
  let lastReportedPct = 0;

  for (let y = 0; y < height; y++) {
    const pct = Math.round((y / height) * 100);
    if (pct - lastReportedPct >= 5) {
      onProgress(pct);
      lastReportedPct = pct;
    }

    for (let x = 0; x < width; x++) {
      const pi = y * width + x;
      const alpha = data[pi * 4 + 3];

      // Fully transparent pixel — assign transparent index
      if (alpha === 0 && transparentIndex !== null) {
        indices[pi] = transparentIndex;
        continue;
      }

      const bi = pi * 3;
      const r = Math.max(0, Math.min(255, Math.round(buf[bi])));
      const g = Math.max(0, Math.min(255, Math.round(buf[bi + 1])));
      const b = Math.max(0, Math.min(255, Math.round(buf[bi + 2])));

      const idx = findNearestColorIdx(r, g, b, palette);
      indices[pi] = transparentIndex !== null ? idx + 1 : idx;

      const pr = palette[idx][0];
      const pg = palette[idx][1];
      const pb = palette[idx][2];

      // Quantization error
      const errR = r - pr;
      const errG = g - pg;
      const errB = b - pb;

      // Distribute error to neighbors (Floyd-Steinberg kernel)
      if (x + 1 < width) {
        const ni = bi + 3;
        buf[ni] += errR * 7 / 16;
        buf[ni + 1] += errG * 7 / 16;
        buf[ni + 2] += errB * 7 / 16;
      }
      if (y + 1 < height) {
        if (x > 0) {
          const ni = bi + stride - 3;
          buf[ni] += errR * 3 / 16;
          buf[ni + 1] += errG * 3 / 16;
          buf[ni + 2] += errB * 3 / 16;
        }
        {
          const ni = bi + stride;
          buf[ni] += errR * 5 / 16;
          buf[ni + 1] += errG * 5 / 16;
          buf[ni + 2] += errB * 5 / 16;
        }
        if (x + 1 < width) {
          const ni = bi + stride + 3;
          buf[ni] += errR * 1 / 16;
          buf[ni + 1] += errG * 1 / 16;
          buf[ni + 2] += errB * 1 / 16;
        }
      }
    }
  }

  return indices;
}

// ---------------------------------------------------------------------------
// Alpha analysis
// ---------------------------------------------------------------------------

function hasAnyTransparency(imageData: ImageData): boolean {
  const { data } = imageData;
  for (let i = 3; i < data.length; i += 16) {
    // Sample every 4th pixel for speed
    if (data[i] < 255) return true;
  }
  // Full check if sampling found nothing
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

function hasSemiTransparency(imageData: ImageData): boolean {
  const { data } = imageData;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 0 && data[i] < 255) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function compressImage(
  file: File,
  mode: ImageCompressionMode,
  onProgress: (update: ProcessingUpdate) => void
): Promise<ImageCompressionResult> {
  const format = detectFormat(file);

  onProgress({ progress: 5, status: "Loading image..." });
  const img = await loadImage(file);
  const { width, height } = img;

  onProgress({ progress: 10, status: "Preparing canvas..." });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  if (format === "jpeg") {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);

    onProgress({ progress: 50, status: "Compressing JPEG..." });

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("JPEG export failed"))),
        "image/jpeg",
        mode.jpegQuality
      );
    });

    const previewUrl = URL.createObjectURL(blob);
    onProgress({ progress: 100, status: "Complete!" });
    canvas.width = 0;
    canvas.height = 0;

    return {
      blob,
      originalSize: file.size,
      compressedSize: blob.size,
      compressionRatio: Math.max(
        Math.round((1 - blob.size / file.size) * 100),
        0
      ),
      width,
      height,
      format,
      previewUrl,
    };
  }

  // =========================================================================
  // PNG compression: quantize → dither → indexed PNG
  // =========================================================================
  ctx.drawImage(img, 0, 0);

  onProgress({ progress: 12, status: "Analyzing image..." });
  const imageData = ctx.getImageData(0, 0, width, height);

  const hasTransp = hasAnyTransparency(imageData);
  const hasSemiTransp = hasSemiTransparency(imageData);

  onProgress({ progress: 15, status: "Building color palette..." });
  const palette = medianCutPalette(imageData, mode.pngColorCount);

  onProgress({ progress: 30, status: "Applying dithering..." });
  const transparentIndex = hasTransp && !hasSemiTransp ? 0 : null;

  const indices = applyDithering(
    imageData,
    palette,
    transparentIndex,
    (pct) => {
      const mapped = 30 + Math.round(pct * 0.5);
      onProgress({ progress: mapped, status: "Applying dithering..." });
    }
  );

  // Build final palette for PNG (prepend transparent entry if needed)
  let finalPalette: [number, number, number][];
  if (transparentIndex !== null) {
    finalPalette = [[0, 0, 0], ...palette];
  } else {
    finalPalette = palette;
  }

  // Cap at 256 colors (max for indexed PNG)
  if (finalPalette.length > 256) {
    finalPalette = finalPalette.slice(0, 256);
  }

  let blob: Blob;

  // Use indexed PNG encoder if CompressionStream is available
  // Fall back to truecolor canvas.toBlob if not
  const supportsCompression =
    typeof CompressionStream !== "undefined";

  if (supportsCompression && !hasSemiTransp) {
    onProgress({ progress: 82, status: "Encoding indexed PNG..." });

    blob = await encodeIndexedPng(
      width,
      height,
      indices,
      finalPalette,
      hasTransp && !hasSemiTransp
    );
  } else {
    // Fallback: apply dithered colors back to canvas
    onProgress({ progress: 82, status: "Encoding PNG..." });

    const resultData = new ImageData(width, height);
    const totalPixels = width * height;
    for (let i = 0; i < totalPixels; i++) {
      const paletteIdx =
        transparentIndex !== null
          ? indices[i] === 0
            ? -1
            : indices[i] - 1
          : indices[i];

      if (paletteIdx === -1) {
        // Transparent pixel
        resultData.data[i * 4 + 3] = 0;
      } else {
        const color = palette[paletteIdx] || [0, 0, 0];
        resultData.data[i * 4] = color[0];
        resultData.data[i * 4 + 1] = color[1];
        resultData.data[i * 4 + 2] = color[2];
        resultData.data[i * 4 + 3] = imageData.data[i * 4 + 3];
      }
    }

    ctx.putImageData(resultData, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG export failed"))),
        "image/png"
      );
    });
  }

  // Generate preview by applying dithered pixels to canvas
  const previewData = new ImageData(width, height);
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const paletteIdx =
      transparentIndex !== null
        ? indices[i] === 0
          ? -1
          : indices[i] - 1
        : indices[i];

    if (paletteIdx === -1) {
      previewData.data[i * 4 + 3] = 0;
    } else {
      const color = palette[paletteIdx] || [0, 0, 0];
      previewData.data[i * 4] = color[0];
      previewData.data[i * 4 + 1] = color[1];
      previewData.data[i * 4 + 2] = color[2];
      previewData.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(previewData, 0, 0);

  const previewBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Preview export failed"))),
      "image/png"
    );
  });
  const previewUrl = URL.createObjectURL(previewBlob);

  onProgress({ progress: 100, status: "Complete!" });
  canvas.width = 0;
  canvas.height = 0;

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    compressionRatio: Math.max(
      Math.round((1 - blob.size / file.size) * 100),
      0
    ),
    width,
    height,
    format,
    previewUrl,
  };
}
