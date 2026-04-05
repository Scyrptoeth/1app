"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { HowItWorks } from "@/components/HowItWorks";
import { PdfPageManager, type PageConfig } from "@/components/PdfPageManager";
import { applyPageModifications } from "@/lib/tools/pdf-page-utils";
import { getToolById } from "@/config/tools";
import {
  compressPdf,
  estimateCompressedSize,
  COMPRESSION_MODES,
  type ProcessingUpdate,
  type CompressionResult,
  type CompressionMode,
} from "@/lib/tools/pdf-compressor";

type Stage = "upload" | "mode-select" | "configure" | "processing" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MODE_ICONS: Record<CompressionMode["id"], { bars: number; color: string }> = {
  high: { bars: 3, color: "text-amber-500" },
  medium: { bars: 2, color: "text-blue-500" },
  low: { bars: 1, color: "text-emerald-500" },
};

function CompressionBars({ bars, color }: { bars: number; color: string }) {
  return (
    <div className="flex items-end gap-0.5 h-5">
      {[1, 2, 3].map((level) => (
        <div
          key={level}
          className={`w-1.5 rounded-sm transition-colors ${
            level <= bars ? color.replace("text-", "bg-") : "bg-slate-200"
          }`}
          style={{ height: `${level * 6 + 2}px` }}
        />
      ))}
    </div>
  );
}

export default function CompressPdfPage() {
  const tool = getToolById("compress-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [selectedMode, setSelectedMode] = useState<CompressionMode | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<CompressionResult | null>(null);

  const handleFilesSelected = useCallback((files: File[]) => {
    setFile(files[0]);
    setStage("mode-select");
  }, []);

  const handleModeSelect = useCallback((mode: CompressionMode) => {
    setSelectedMode(mode);
    setStage("configure");
  }, []);

  const startCompression = useCallback(
    async (targetFile: File, mode: CompressionMode) => {
      setStage("processing");

      try {
        const compressionResult = await compressPdf(targetFile, mode, (update) =>
          setProgress(update)
        );
        setResult(compressionResult);
        setStage("done");
      } catch (err) {
        console.error("PDF compression failed:", err);
        setStage("mode-select");
        alert(
          "Failed to compress the PDF. The file may be encrypted or corrupted. Please try a different file."
        );
      }
    },
    []
  );

  const handlePageConfirm = useCallback(
    async (pages: PageConfig[]) => {
      if (!file || !selectedMode) return;

      const hasModifications =
        pages.some((p) => !p.included) ||
        pages.some((p) => p.rotation !== 0) ||
        pages.some((p, i) => p.originalIndex !== i);

      if (hasModifications) {
        setStage("processing");
        setProgress({ progress: 0, status: "Applying page modifications..." });
        try {
          const arrayBuffer = await file.arrayBuffer();
          const modifiedBytes = await applyPageModifications(arrayBuffer, pages);
          const modifiedFile = new File([modifiedBytes], file.name, {
            type: "application/pdf",
          });
          await startCompression(modifiedFile, selectedMode);
        } catch (err) {
          console.error("Page modification failed:", err);
          setStage("configure");
          alert("Failed to apply page modifications. Please try again.");
        }
      } else {
        await startCompression(file, selectedMode);
      }
    },
    [file, selectedMode, startCompression]
  );

  const handlePageCancel = useCallback(() => {
    setSelectedMode(null);
    setStage("mode-select");
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;

    const baseName = file.name.replace(/\.pdf$/i, "");
    const outputName = `${baseName}-compressed.pdf`;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const handleTryAnotherMode = useCallback(() => {
    if (result?.previewUrl) {
      URL.revokeObjectURL(result.previewUrl);
    }
    setResult(null);
    setSelectedMode(null);
    setProgress({ progress: 0, status: "" });
    setStage("mode-select");
  }, [result]);

  const handleReset = useCallback(() => {
    if (result?.previewUrl) {
      URL.revokeObjectURL(result.previewUrl);
    }
    setStage("upload");
    setFile(null);
    setSelectedMode(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, [result]);

  return (
    <ToolPageLayout tool={tool}>
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload PDF",
            desc: "Select a PDF document you want to compress. Multi-page files up to 100 MB are supported.",
          },
          {
            step: "2",
            title: "Choose Compression Level",
            desc: "Pick from three modes based on your quality and size requirements. Each mode shows an estimated output size before you commit.",
          },
          {
            step: "3",
            title: "Manage Pages",
            desc: "Optionally rotate, reorder, or remove pages before compression. You can also skip this step and compress all pages as-is.",
          },
          {
            step: "4",
            title: "Preview and Download",
            desc: "Review compression stats, preview the first page, and download your smaller PDF. All processing happens in your browser.",
          },
        ]}
      />

      {/* Stage 1: Upload */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to compress"
          subtitle="Supports multi-page PDF documents up to 100MB"
        />
      )}

      {/* Stage 2: Mode Selection */}
      {stage === "mode-select" && file && (
        <div className="w-full max-w-3xl mx-auto">
          {/* File info */}
          <div className="flex items-center gap-3 mb-8 p-4 bg-slate-50 rounded-xl">
            <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-slate-400"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {file.name}
              </p>
              <p className="text-xs text-slate-500">
                Original size: {formatFileSize(file.size)}
              </p>
            </div>
            <button
              onClick={handleReset}
              className="ml-auto text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Change file
            </button>
          </div>

          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            Choose compression level
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Select a mode based on your quality and size requirements.
          </p>

          {/* Mode cards */}
          <div className="grid sm:grid-cols-3 gap-4">
            {COMPRESSION_MODES.map((mode) => {
              const estimated = estimateCompressedSize(file.size, mode);
              const iconInfo = MODE_ICONS[mode.id];

              return (
                <button
                  key={mode.id}
                  onClick={() => handleModeSelect(mode)}
                  className="group flex flex-col p-5 bg-white border border-slate-200 rounded-xl hover:border-slate-300 hover:shadow-md transition-all text-left"
                >
                  <div className="flex items-center justify-between mb-3">
                    <CompressionBars bars={iconInfo.bars} color={iconInfo.color} />
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        mode.id === "high"
                          ? "bg-amber-50 text-amber-700"
                          : mode.id === "medium"
                          ? "bg-blue-50 text-blue-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      ~{formatFileSize(estimated)}
                    </span>
                  </div>

                  <h4 className="text-sm font-semibold text-slate-900 mb-1">
                    {mode.label}
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed mb-4 flex-1">
                    {mode.description}
                  </p>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      ~{Math.round(mode.estimateRatio * 100)}% of original
                    </span>
                    <span className="text-xs font-medium text-accent-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      Select →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage 3: Configure Pages */}
      {stage === "configure" && file && (
        <PdfPageManager
          file={file}
          onConfirm={handlePageConfirm}
          onCancel={handlePageCancel}
          confirmLabel="Compress PDF"
          cancelLabel="Cancel"
          requireChanges={false}
        />
      )}

      {/* Stage 4: Processing */}
      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Stage 5: Done */}
      {stage === "done" && result && file && (
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
            Compression complete!
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Your compressed PDF is ready to download.
          </p>

          {/* Preview */}
          {result.previewUrl && (
            <div className="mb-6 rounded-xl overflow-hidden border border-slate-100 shadow-sm">
              <img
                src={result.previewUrl}
                alt="First page preview"
                className="w-full max-h-64 object-contain bg-slate-50"
              />
            </div>
          )}

          {/* Compression stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Original</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(result.originalSize)}
              </p>
            </div>
            <div className="p-3 bg-emerald-50 rounded-xl">
              <p className="text-xs text-emerald-600 mb-1">Compressed</p>
              <p className="text-sm font-semibold text-emerald-700">
                {formatFileSize(result.compressedSize)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Reduced</p>
              <p className="text-sm font-semibold text-slate-900">
                {result.compressionRatio > 0
                  ? `${result.compressionRatio}%`
                  : "No reduction"}
              </p>
            </div>
          </div>

          {/* Page count + mode info */}
          <div className="mb-6 flex items-center justify-center gap-4 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-slate-400"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>
                {result.pageCount} page{result.pageCount > 1 ? "s" : ""}
              </span>
            </div>
            <div className="text-slate-300">|</div>
            <span>{result.mode.label}</span>
          </div>

          {/* Warning if file got larger */}
          {result.compressionRatio <= 0 && (
            <div className="mb-6 flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
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
                This PDF is already well-optimized. Try a higher compression mode
                for better results.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleDownload}
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download Compressed PDF
            </button>

            <button
              onClick={handleTryAnotherMode}
              className="w-full sm:w-auto px-6 py-3 text-accent-600 font-medium rounded-xl border border-accent-200 hover:bg-accent-50 transition-colors"
            >
              Try Another Mode
            </button>

            <button
              onClick={handleReset}
              className="w-full sm:w-auto px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Upload New File
            </button>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}
