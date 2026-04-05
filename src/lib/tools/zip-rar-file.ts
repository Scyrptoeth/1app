/**
 * Zip & Rar File — Client-side ZIP archive creation using fflate.
 * RAR creation is not possible client-side (proprietary format).
 */

export interface FileEntry {
  file: File;
  relativePath: string; // e.g., "folder/subfolder/file.pdf" or "file.pdf"
  size: number;
}

export interface ArchiveResult {
  blob: Blob;
  fileName: string;
  format: "zip";
  originalTotalSize: number;
  archiveSize: number;
  fileCount: number;
  compressionRatio: number; // percentage saved (0-100)
}

export type OnProgress = (update: {
  stage: string;
  progress: number;
}) => void;

/**
 * Create a ZIP archive from file entries using fflate.
 */
export async function createZipArchive(
  entries: FileEntry[],
  outputName: string,
  onProgress?: OnProgress
): Promise<ArchiveResult> {
  onProgress?.({ stage: "Preparing files...", progress: 0 });

  const { zipSync } = await import("fflate");

  const zipData: Record<string, Uint8Array> = {};
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  let processedSize = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress?.({
      stage: `Processing file ${i + 1} of ${entries.length}...`,
      progress: Math.round((processedSize / totalSize) * 80),
    });

    const arrayBuffer = await entry.file.arrayBuffer();
    zipData[entry.relativePath] = new Uint8Array(arrayBuffer);
    processedSize += entry.size;
  }

  onProgress?.({ stage: "Creating ZIP archive...", progress: 85 });

  const zipped = zipSync(zipData);

  onProgress?.({ stage: "Finalizing...", progress: 95 });

  const blob = new Blob([zipped], { type: "application/zip" });
  const fileName = `${outputName}.zip`;
  const archiveSize = blob.size;
  const compressionRatio =
    totalSize > 0 ? Math.round((1 - archiveSize / totalSize) * 100) : 0;

  onProgress?.({ stage: "Done", progress: 100 });

  return {
    blob,
    fileName,
    format: "zip",
    originalTotalSize: totalSize,
    archiveSize,
    fileCount: entries.length,
    compressionRatio,
  };
}

/**
 * Recursively traverse a dropped directory via FileSystemDirectoryEntry API.
 */
export async function traverseDirectory(
  entry: FileSystemDirectoryEntry,
  basePath: string = ""
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const reader = entry.createReader();

  const readEntries = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

  // readEntries may return batches — keep reading until empty
  let batch = await readEntries();
  while (batch.length > 0) {
    for (const child of batch) {
      const childPath = basePath
        ? `${basePath}/${child.name}`
        : child.name;

      if (child.isFile) {
        const file = await new Promise<File>((resolve, reject) => {
          (child as FileSystemFileEntry).file(resolve, reject);
        });
        results.push({
          file,
          relativePath: childPath,
          size: file.size,
        });
      } else if (child.isDirectory) {
        const subEntries = await traverseDirectory(
          child as FileSystemDirectoryEntry,
          childPath
        );
        results.push(...subEntries);
      }
    }
    batch = await readEntries();
  }

  return results;
}

/**
 * Recursively read a FileSystemDirectoryHandle (File System Access API).
 * Used by showDirectoryPicker() — no browser trust dialog.
 */
export async function readDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  basePath: string = ""
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

  for await (const [name, handle] of dirHandle.entries()) {
    const path = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      results.push({ file, relativePath: path, size: file.size });
    } else if (handle.kind === "directory") {
      const subEntries = await readDirectoryHandle(
        handle as FileSystemDirectoryHandle,
        path
      );
      results.push(...subEntries);
    }
  }

  return results;
}

/**
 * Process drag & drop DataTransfer items, handling both files and folders.
 */
export async function processDataTransferItems(
  items: DataTransferItemList
): Promise<FileEntry[]> {
  const results: FileEntry[] = [];

  const entries: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      results.push({
        file,
        relativePath: entry.name,
        size: file.size,
      });
    } else if (entry.isDirectory) {
      const dirEntries = await traverseDirectory(
        entry as FileSystemDirectoryEntry,
        entry.name
      );
      results.push(...dirEntries);
    }
  }

  return results;
}
