"use client";

import { useState, useCallback, useRef } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { HowItWorks } from "@/components/HowItWorks";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  createZipArchive,
  processDataTransferItems,
  readDirectoryHandle,
  type FileEntry,
  type ArchiveResult,
} from "@/lib/tools/zip-rar-file";

type Stage = "upload" | "configure" | "processing" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["pdf"].includes(ext)) return "pdf";
  if (["jpg", "jpeg", "png", "gif", "svg", "webp"].includes(ext))
    return "image";
  if (["doc", "docx"].includes(ext)) return "word";
  if (["xls", "xlsx"].includes(ext)) return "excel";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  if (["mp3", "wav", "ogg", "flac"].includes(ext)) return "audio";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["js", "ts", "py", "html", "css", "json", "md", "txt", "csv"].includes(ext))
    return "code";
  return "file";
}

const FILE_ICON_COLORS: Record<string, string> = {
  pdf: "text-red-500",
  image: "text-blue-500",
  word: "text-blue-600",
  excel: "text-emerald-600",
  ppt: "text-orange-500",
  archive: "text-amber-500",
  audio: "text-purple-500",
  video: "text-pink-500",
  code: "text-slate-600",
  file: "text-slate-400",
};

function FileIcon({ type }: { type: string }) {
  const color = FILE_ICON_COLORS[type] || "text-slate-400";
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={color}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500"
    >
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export default function ZipRarFilePage() {
  const tool = getToolById("zip-rar-file")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [outputName, setOutputName] = useState("archive");
  const [progress, setProgress] = useState({ progress: 0, status: "" });
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sizeWarning, setSizeWarning] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const SIZE_WARNING_THRESHOLD = 500 * 1024 * 1024; // 500MB

  const addEntries = useCallback(
    (newEntries: FileEntry[]) => {
      setEntries((prev) => {
        // Deduplicate by relativePath
        const existingPaths = new Set(prev.map((e) => e.relativePath));
        const unique = newEntries.filter(
          (e) => !existingPaths.has(e.relativePath)
        );
        const combined = [...prev, ...unique];
        const totalSize = combined.reduce((s, e) => s + e.size, 0);
        setSizeWarning(totalSize > SIZE_WARNING_THRESHOLD);
        return combined;
      });
    },
    [SIZE_WARNING_THRESHOLD]
  );

  const computeDefaultName = useCallback((fileEntries: FileEntry[]): string => {
    if (fileEntries.length === 0) return "archive";
    if (fileEntries.length === 1) {
      return fileEntries[0].file.name.replace(/\.[^.]+$/, "");
    }
    // Check if all files share a common root folder
    const firstPath = fileEntries[0].relativePath;
    const slashIdx = firstPath.indexOf("/");
    if (slashIdx > 0) {
      const root = firstPath.substring(0, slashIdx);
      const allSameRoot = fileEntries.every((e) =>
        e.relativePath.startsWith(root + "/")
      );
      if (allSameRoot) return root;
    }
    return "files";
  }, []);

  const handleFilesSelected = useCallback(
    (files: FileList) => {
      const newEntries: FileEntry[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const relativePath =
          (file as File & { webkitRelativePath?: string })
            .webkitRelativePath || file.name;
        newEntries.push({ file, relativePath, size: file.size });
      }
      addEntries(newEntries);
    },
    [addEntries]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        // Check if any item is a directory
        const hasDirectory = Array.from(e.dataTransfer.items).some((item) => {
          const entry = item.webkitGetAsEntry?.();
          return entry?.isDirectory;
        });

        if (hasDirectory) {
          const newEntries = await processDataTransferItems(
            e.dataTransfer.items
          );
          addEntries(newEntries);
        } else {
          handleFilesSelected(e.dataTransfer.files);
        }
      }
    },
    [addEntries, handleFilesSelected]
  );

  const handleSelectFolder = useCallback(async () => {
    // Prefer showDirectoryPicker (no browser trust warning)
    if ("showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
        const newEntries = await readDirectoryHandle(dirHandle, dirHandle.name);
        addEntries(newEntries);
        return;
      } catch (err) {
        // User cancelled the picker - do nothing
        if ((err as DOMException).name === "AbortError") return;
      }
    }
    // Fallback: webkitdirectory input (shows browser dialog on some browsers)
    folderInputRef.current?.click();
  }, [addEntries]);

  const handleRemoveEntry = useCallback((index: number) => {
    setEntries((prev) => {
      const next = prev.filter((_, i) => i !== index);
      const totalSize = next.reduce((s, e) => s + e.size, 0);
      setSizeWarning(totalSize > SIZE_WARNING_THRESHOLD);
      return next;
    });
  }, [SIZE_WARNING_THRESHOLD]);

  const handleProceedToConfigure = useCallback(() => {
    if (entries.length === 0) return;
    setOutputName(computeDefaultName(entries));
    setStage("configure");
  }, [entries, computeDefaultName]);

  const handleProcess = useCallback(async () => {
    if (entries.length === 0) return;
    setStage("processing");

    try {
      const archiveResult = await createZipArchive(
        entries,
        outputName || "archive",
        (update) => setProgress({ progress: update.progress, status: update.stage })
      );
      setResult(archiveResult);
      setStage("done");
    } catch (err) {
      console.error("ZIP creation failed:", err);
      setStage("configure");
      alert(
        "Failed to create ZIP archive. The files may be too large for the browser to process."
      );
    }
  }, [entries, outputName]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result]);

  const handleBackToEdit = useCallback(() => {
    setStage("configure");
  }, []);

  const handleReset = useCallback(() => {
    setStage("upload");
    setEntries([]);
    setOutputName("archive");
    setProgress({ progress: 0, status: "" });
    setResult(null);
    setSizeWarning(false);
  }, []);

  const totalSize = entries.reduce((s, e) => s + e.size, 0);

  // Group entries by top-level folder for display
  const groupedEntries = entries.reduce<
    Record<string, FileEntry[]>
  >((acc, entry) => {
    const slashIdx = entry.relativePath.indexOf("/");
    const group = slashIdx > 0 ? entry.relativePath.substring(0, slashIdx) : "";
    if (!acc[group]) acc[group] = [];
    acc[group].push(entry);
    return acc;
  }, {});

  return (
    <ToolPageLayout tool={tool}>
      <HowItWorks
        steps={[
          {
            title: "Add Files or Folders",
            desc: "Drag and drop files or entire folders into the upload area, or use the file picker and folder selector. Any file type is accepted, and you can add more files at any time.",
          },
          {
            title: "Name Your Archive",
            desc: "Review the file list, confirm folder structure is correct, and set a custom name for your ZIP archive.",
          },
          {
            title: "Create ZIP",
            desc: "Click Create ZIP to compress all your files into a single archive. Folder hierarchy is preserved inside the ZIP for easy extraction later.",
          },
          {
            title: "Download Your Archive",
            desc: "Download the finished .zip file, which is compatible with WinRAR, 7-Zip, Windows Explorer, macOS Finder, and all major tools. All processing happens in your browser; nothing is uploaded to any server.",
          },
        ]}
      />
      {/* Stage 1: Upload */}
      {stage === "upload" && (
        <div className="w-full max-w-2xl mx-auto">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-accent-400 bg-accent-50/50"
                : entries.length > 0
                ? "border-slate-200 bg-white"
                : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
            }`}
            onClick={() => {
              if (entries.length === 0) fileInputRef.current?.click();
            }}
          >
            {entries.length === 0 ? (
              <>
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-amber-500"
                  >
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-700 mb-1">
                  Drop files or folders here, or click to browse
                </p>
                <p className="text-xs text-slate-400">
                  Any file type supported. Files and folders accepted.
                </p>
              </>
            ) : (
              <>
                {/* File list */}
                <div className="text-left max-h-80 overflow-y-auto -mx-4 px-4">
                  {Object.entries(groupedEntries).map(
                    ([folder, folderEntries]) => (
                      <div key={folder || "__root__"} className="mb-3">
                        {folder && (
                          <div className="flex items-center gap-1.5 mb-1.5 pl-1">
                            <FolderIcon />
                            <span className="text-xs font-medium text-slate-600">
                              {folder}/
                            </span>
                          </div>
                        )}
                        {folderEntries.map((entry) => {
                          const globalIdx = entries.indexOf(entry);
                          const displayName = folder
                            ? entry.relativePath.substring(folder.length + 1)
                            : entry.relativePath;
                          return (
                            <div
                              key={entry.relativePath}
                              className={`flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-slate-50 group ${
                                folder ? "ml-5" : ""
                              }`}
                            >
                              <FileIcon
                                type={getFileIcon(entry.file.name)}
                              />
                              <span className="text-sm text-slate-700 truncate flex-1">
                                {displayName}
                              </span>
                              <span className="text-xs text-slate-400 shrink-0">
                                {formatFileSize(entry.size)}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveEntry(globalIdx);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all p-0.5"
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>

                {/* Summary bar */}
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    {entries.length} file{entries.length !== 1 ? "s" : ""} ·{" "}
                    {formatFileSize(totalSize)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      addFileInputRef.current?.click();
                    }}
                    className="text-xs font-medium text-accent-600 hover:text-accent-700 transition-colors"
                  >
                    + Add More Files
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Upload buttons */}
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                <path d="M12 18v-6" />
                <path d="m9 15 3-3 3 3" />
              </svg>
              Select Files
            </button>
            <button
              onClick={handleSelectFolder}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <FolderIcon />
              Select Folder
            </button>
          </div>

          <p className="mt-2 text-center text-xs text-slate-400">
            Your browser may ask for folder access permission. Your files stay on your device and are never uploaded to any server.
          </p>

          {/* Size warning */}
          {sizeWarning && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-amber-500 shrink-0 mt-0.5"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p className="text-xs text-amber-700 leading-relaxed">
                Total size exceeds 500MB. Large archives may take longer to
                process and use significant browser memory.
              </p>
            </div>
          )}

          {/* Process button */}
          {entries.length > 0 && (
            <button
              onClick={handleProceedToConfigure}
              className="w-full mt-4 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
            >
              Continue
            </button>
          )}

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
          {/* Fallback for browsers without showDirectoryPicker */}
          {/* @ts-expect-error - webkitdirectory is not in React types */}
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={addFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Stage 2: Configure */}
      {stage === "configure" && (
        <div className="w-full max-w-lg mx-auto">
          <h3 className="text-lg font-semibold text-slate-900 mb-1">
            Configure archive
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Name your archive and review the files before creating.
          </p>

          {/* Output name */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Archive name
            </label>
            <div className="flex items-center">
              <input
                type="text"
                value={outputName}
                onChange={(e) => {
                  // Remove illegal filename chars
                  const clean = e.target.value.replace(
                    /[<>:"/\\|?*\x00-\x1F]/g,
                    ""
                  );
                  setOutputName(clean);
                }}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-l-xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-400"
                placeholder="archive"
              />
              <span className="px-4 py-2.5 bg-slate-100 border border-l-0 border-slate-200 rounded-r-xl text-sm text-slate-500 font-mono">
                .zip
              </span>
            </div>
          </div>

          {/* File list (read-only) */}
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-2">
              Files ({entries.length})
            </p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="max-h-60 overflow-y-auto divide-y divide-slate-100">
                {entries.map((entry) => (
                  <div
                    key={entry.relativePath}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <FileIcon type={getFileIcon(entry.file.name)} />
                    <span className="text-sm text-slate-700 truncate flex-1">
                      {entry.relativePath}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      {formatFileSize(entry.size)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {entries.length} file{entries.length !== 1 ? "s" : ""}
                </span>
                <span className="text-xs font-medium text-slate-600">
                  {formatFileSize(totalSize)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleProcess}
              disabled={!outputName.trim()}
              className="w-full sm:flex-1 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create ZIP
            </button>
            <button
              onClick={() => setStage("upload")}
              className="w-full sm:flex-1 px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Stage 3: Processing */}
      {stage === "processing" && (
        <ProcessingView
          fileName={`${outputName || "archive"}.zip`}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Stage 4: Done */}
      {stage === "done" && result && (
        <div className="w-full max-w-lg mx-auto text-center">
          {/* Success icon */}
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h3 className="text-xl font-bold text-slate-900 mb-1">
            Archive created!
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Your ZIP archive is ready to download.
          </p>

          {/* Archive stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Original</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(result.originalTotalSize)}
              </p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl">
              <p className="text-xs text-emerald-600 mb-1">Archived</p>
              <p className="text-sm font-semibold text-emerald-700">
                {formatFileSize(result.archiveSize)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Saved</p>
              <p className="text-sm font-semibold text-slate-900">
                {result.compressionRatio > 0
                  ? `${result.compressionRatio}%`
                  : "0%"}
              </p>
            </div>
          </div>

          {/* File info */}
          <div className="mb-6 flex items-center justify-center gap-4 text-sm text-slate-500">
            <span>{result.fileCount} file{result.fileCount !== 1 ? "s" : ""}</span>
            <div className="text-slate-300">|</div>
            <span>{result.fileName}</span>
          </div>

          {/* Data Quality badge */}
          <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-xs font-medium text-emerald-700">
              Compression ratio: {result.compressionRatio > 0 ? `${result.compressionRatio}%` : "0%"} saved
            </span>
          </div>

          {/* Info Notice */}
          <div className="mb-6 flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-left">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-blue-500 shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              ZIP and RAR are both compressed archive formats that serve the same purpose. Your .zip file can be opened with WinRAR, 7-Zip, Windows Explorer, macOS Finder, and all major archive tools. All files are processed locally in your browser. Nothing is uploaded to any server.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <button
              onClick={handleDownload}
              className="flex-1 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 text-center"
            >
              Download .zip
            </button>
            <button
              onClick={handleBackToEdit}
              className="flex-1 px-6 py-3 text-accent-600 font-medium rounded-xl border border-accent-200 hover:bg-accent-50 transition-colors text-center"
            >
              Back to Edit
            </button>
            <button
              onClick={handleReset}
              className="flex-1 px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-center"
            >
              Process Another
            </button>
          </div>
        </div>
      )}

    </ToolPageLayout>
  );
}
