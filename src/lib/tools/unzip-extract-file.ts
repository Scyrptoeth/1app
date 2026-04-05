/**
 * Unzip (Extract) File — Client-side ZIP/RAR extraction.
 * ZIP: JSZip (already a dependency)
 * RAR: node-unrar-js (WASM-based, supports RAR v5)
 */

export interface ExtractedFile {
  name: string; // filename only
  path: string; // full relative path including folders
  blob: Blob;
  size: number;
  type: string; // file type category for icon coloring
}

export interface ExtractResult {
  files: ExtractedFile[];
  archiveName: string;
  archiveSize: number;
  totalExtractedSize: number;
  fileCount: number;
  format: "zip" | "rar";
}

export type OnProgress = (update: {
  stage: string;
  progress: number;
}) => void;

/** OS metadata files/folders to filter out */
const METADATA_PATTERNS = [
  "__MACOSX/",
  "__MACOSX",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
];

function isMetadataFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("__MACOSX/") || normalized === "__MACOSX") return true;
  const basename = normalized.split("/").pop() || "";
  if (basename === ".DS_Store" || basename === "Thumbs.db" || basename === "desktop.ini") return true;
  if (basename.startsWith("._")) return true; // Apple Double files
  return false;
}

function getFileTypeCategory(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["pdf"].includes(ext)) return "pdf";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "tiff"].includes(ext)) return "image";
  if (["doc", "docx"].includes(ext)) return "word";
  if (["xls", "xlsx"].includes(ext)) return "excel";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["mp3", "wav", "ogg", "flac", "aac"].includes(ext)) return "audio";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["js", "ts", "py", "html", "css", "json", "md", "txt", "csv", "xml"].includes(ext)) return "code";
  return "file";
}

function detectFormat(file: File): "zip" | "rar" | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "zip") return "zip";
  if (ext === "rar") return "rar";
  return null;
}

/**
 * Extract a ZIP archive using JSZip.
 */
async function extractZip(
  data: ArrayBuffer,
  onProgress?: OnProgress
): Promise<ExtractedFile[]> {
  onProgress?.({ stage: "Loading ZIP archive...", progress: 10 });

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);

  const entries = Object.entries(zip.files).filter(
    ([path, entry]) => !entry.dir && !isMetadataFile(path)
  );

  const files: ExtractedFile[] = [];
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    const [path, entry] = entries[i];
    onProgress?.({
      stage: `Extracting file ${i + 1} of ${total}...`,
      progress: 10 + Math.round((i / total) * 80),
    });

    const uint8 = await entry.async("uint8array");
    const blob = new Blob([uint8]);
    const name = path.split("/").pop() || path;

    files.push({
      name,
      path,
      blob,
      size: uint8.length,
      type: getFileTypeCategory(name),
    });
  }

  return files;
}

/**
 * Extract a RAR archive using node-unrar-js (WASM).
 */
async function extractRar(
  data: ArrayBuffer,
  onProgress?: OnProgress
): Promise<ExtractedFile[]> {
  onProgress?.({ stage: "Loading RAR engine...", progress: 5 });

  const { createExtractorFromData } = await import("node-unrar-js");

  onProgress?.({ stage: "Loading RAR archive...", progress: 10 });

  const wasmResponse = await fetch("/unrar.wasm");
  const wasmBinary = await wasmResponse.arrayBuffer();

  const extractor = await createExtractorFromData({
    wasmBinary,
    data,
  });

  onProgress?.({ stage: "Reading file list...", progress: 20 });

  const { files: extractedFiles } = extractor.extract();
  const allFiles = [...extractedFiles];

  // Filter out directories and metadata
  const validFiles = allFiles.filter(
    (f) => f.fileHeader && !f.fileHeader.flags.directory && !isMetadataFile(f.fileHeader.name)
  );

  const files: ExtractedFile[] = [];
  const total = validFiles.length;

  for (let i = 0; i < validFiles.length; i++) {
    const entry = validFiles[i];
    onProgress?.({
      stage: `Extracting file ${i + 1} of ${total}...`,
      progress: 20 + Math.round((i / total) * 70),
    });

    const path = entry.fileHeader.name.replace(/\\/g, "/");
    const name = path.split("/").pop() || path;
    const extraction = entry.extraction;

    if (extraction) {
      const blob = new Blob([extraction]);
      files.push({
        name,
        path,
        blob,
        size: blob.size,
        type: getFileTypeCategory(name),
      });
    }
  }

  return files;
}

/**
 * Main extraction function — detects format and delegates.
 */
export async function extractArchive(
  file: File,
  onProgress?: OnProgress
): Promise<ExtractResult> {
  const format = detectFormat(file);
  if (!format) {
    throw new Error(
      "Unsupported file format. Please upload a .zip or .rar file."
    );
  }

  onProgress?.({ stage: "Reading archive...", progress: 0 });
  const data = await file.arrayBuffer();

  let files: ExtractedFile[];

  if (format === "zip") {
    files = await extractZip(data, onProgress);
  } else {
    files = await extractRar(data, onProgress);
  }

  // Sort files by path for consistent display
  files.sort((a, b) => a.path.localeCompare(b.path));

  onProgress?.({ stage: "Done", progress: 100 });

  const totalExtractedSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    files,
    archiveName: file.name,
    archiveSize: file.size,
    totalExtractedSize,
    fileCount: files.length,
    format,
  };
}

/**
 * Re-package extracted files into a clean ZIP (no OS metadata).
 */
export async function repackAsZip(
  files: ExtractedFile[],
  archiveName: string,
  onProgress?: OnProgress
): Promise<Blob> {
  onProgress?.({ stage: "Preparing download...", progress: 0 });

  const { zipSync } = await import("fflate");

  const zipData: Record<string, Uint8Array> = {};
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    onProgress?.({
      stage: `Packaging file ${i + 1} of ${total}...`,
      progress: Math.round((i / total) * 90),
    });

    const buf = await files[i].blob.arrayBuffer();
    zipData[files[i].path] = new Uint8Array(buf);
  }

  onProgress?.({ stage: "Finalizing...", progress: 95 });

  const zipped = zipSync(zipData);

  onProgress?.({ stage: "Done", progress: 100 });

  return new Blob([zipped], { type: "application/zip" });
}
