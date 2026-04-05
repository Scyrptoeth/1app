"use client";

import { useState, useCallback, useRef } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  extractArchive,
  repackAsZip,
  type ExtractResult,
  type ExtractedFile,
} from "@/lib/tools/unzip-extract-file";
import { HowItWorks } from "@/components/HowItWorks";

type Stage = "upload" | "processing" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export default function UnzipExtractFilePage() {
  const tool = getToolById("unzip-extract-file")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [progress, setProgress] = useState({ progress: 0, status: "" });
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExtract = useCallback(async (file: File) => {
    setError(null);
    setStage("processing");

    try {
      const extractResult = await extractArchive(file, (update) =>
        setProgress({ progress: update.progress, status: update.stage })
      );
      setResult(extractResult);
      setStage("done");
    } catch (err) {
      console.error("Extraction failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to extract archive. The file may be corrupted or unsupported."
      );
      setStage("upload");
    }
  }, []);

  const handleFileSelected = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext !== "zip" && ext !== "rar") {
        setError("Unsupported file format. Please upload a .zip or .rar file.");
        return;
      }
      handleExtract(file);
    },
    [handleExtract]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFileSelected(e.dataTransfer.files);
    },
    [handleFileSelected]
  );

  const handleDownloadFile = useCallback((file: ExtractedFile) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file.blob);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (!result) return;
    setDownloadingAll(true);

    try {
      const baseName = result.archiveName.replace(/\.(zip|rar)$/i, "");
      const blob = await repackAsZip(result.files, baseName);

      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${baseName}-extracted.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error("Download All failed:", err);
    } finally {
      setDownloadingAll(false);
    }
  }, [result]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setProgress({ progress: 0, status: "" });
    setResult(null);
    setError(null);
    setDownloadingAll(false);
  }, []);

  return (
    <ToolPageLayout tool={tool}>
      <HowItWorks steps={[
        {
          step: "1",
          title: "Upload Archive",
          desc: "Select a ZIP or RAR file by dragging it in or using the file picker.",
        },
        {
          step: "2",
          title: "Extract Files",
          desc: "Your archive is extracted instantly. OS metadata like __MACOSX, .DS_Store, and Thumbs.db is filtered out automatically.",
        },
        {
          step: "3",
          title: "Download",
          desc: "Download individual files or grab everything as a clean ZIP. All processing happens in your browser, so nothing leaves your device.",
        },
      ]} />

      {/* Stage 1: Upload */}
      {stage === "upload" && (
        <div className="w-full max-w-2xl mx-auto">
          {/* Error message */}
          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-red-500 shrink-0 mt-0.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
              <p className="text-xs text-red-700 leading-relaxed">{error}</p>
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-accent-400 bg-accent-50/50"
                : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-700 mb-1">
              Drop a .zip or .rar file here, or click to browse
            </p>
            <p className="text-xs text-slate-400">
              Supports ZIP and RAR (v5) archives. One file at a time.
            </p>
          </div>

          <p className="mt-3 text-center text-xs text-slate-400">
            All files are extracted locally in your browser. Nothing is uploaded.
            to any server.
          </p>

          {/* Hidden input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.rar"
            className="hidden"
            onChange={(e) => {
              handleFileSelected(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {/* Stage 2: Processing */}
      {stage === "processing" && (
        <ProcessingView
          fileName={result?.archiveName || "archive"}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Stage 3: Done */}
      {stage === "done" && result && (
        <div className="w-full max-w-2xl mx-auto">
          {/* Success header */}
          <div className="text-center mb-6">
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
              Archive extracted!
            </h3>
            <p className="text-sm text-slate-500">
              {result.fileCount} file{result.fileCount !== 1 ? "s" : ""}{" "}
              extracted from{" "}
              <span className="font-medium text-slate-700">
                {result.archiveName}
              </span>
            </p>
          </div>

          {/* Stats grid */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl text-center">
              <p className="text-xs text-slate-400 mb-1">Archive</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(result.archiveSize)}
              </p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl text-center">
              <p className="text-xs text-emerald-600 mb-1">Extracted</p>
              <p className="text-sm font-semibold text-emerald-700">
                {formatFileSize(result.totalExtractedSize)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl text-center">
              <p className="text-xs text-slate-400 mb-1">Files</p>
              <p className="text-sm font-semibold text-slate-900">
                {result.fileCount}
              </p>
            </div>
          </div>

          {/* File list */}
          <div className="mb-6">
            <p className="text-sm font-medium text-slate-700 mb-2">
              Extracted files
            </p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {result.files.map((file, idx) => (
                  <div
                    key={`${file.path}-${idx}`}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-50 group"
                  >
                    <FileIcon type={file.type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">
                        {file.path}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0 mr-2">
                      {formatFileSize(file.size)}
                    </span>
                    <button
                      onClick={() => handleDownloadFile(file)}
                      className="opacity-0 group-hover:opacity-100 text-xs font-medium text-accent-600 hover:text-accent-700 transition-all shrink-0"
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {result.fileCount} file{result.fileCount !== 1 ? "s" : ""}
                </span>
                <span className="text-xs font-medium text-slate-600">
                  {formatFileSize(result.totalExtractedSize)}
                </span>
              </div>
            </div>
          </div>

          {/* Data Quality badge */}
          <div className="mb-4 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
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
                {result.fileCount} file{result.fileCount !== 1 ? "s" : ""}{" "}
                extracted successfully, format:{" "}
                {result.format.toUpperCase()}
              </span>
            </div>
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
              OS metadata files (__MACOSX, .DS_Store, Thumbs.db) are
              automatically filtered out. &quot;Download All&quot; re-packages
              the files into a clean ZIP without these metadata files. All
              processing happens locally in your browser.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <button
              onClick={handleDownloadAll}
              disabled={downloadingAll}
              className="flex-1 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 text-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloadingAll ? "Packaging..." : "Download All (.zip)"}
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
