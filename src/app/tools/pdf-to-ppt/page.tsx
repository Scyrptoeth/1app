"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertPdfToPpt,
  type ProcessingUpdate,
  type PdfToPptResult,
} from "@/lib/tools/pdf-to-ppt";

type Stage = "upload" | "processing" | "done";

interface DownloadOption {
  label: string;
  description: string;
  blob: Blob;
  suffix: string;
}

export default function PdfToPptPage() {
  const tool = getToolById("pdf-to-ppt")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<PdfToPptResult | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const processingResult = await convertPdfToPpt(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      console.error("PDF-to-PPT conversion failed:", err);
      setStage("upload");
      alert(
        "Failed to convert the PDF. The file may be encrypted, corrupted, or unsupported. Please try a different file."
      );
    }
  }, []);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, []);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadOptions: DownloadOption[] = result && file
    ? [
        {
          label: "Hybrid (Image + Text)",
          description: "Visual fidelity of PDF + editable white text overlay. Best for presentations.",
          blob: result.hybridBlob,
          suffix: "hybrid",
        },
        {
          label: "Image Only",
          description: "Each slide is a full-page screenshot. Looks exactly like the original PDF.",
          blob: result.imageOnlyBlob,
          suffix: "image",
        },
        {
          label: "Text Only",
          description: "Editable text boxes only, no background image. Best for editing content.",
          blob: result.textOnlyBlob,
          suffix: "text",
        },
      ]
    : [];

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to convert to PowerPoint"
          subtitle="Generates 3 versions: Hybrid (image + text), Image Only, and Text Only (editable)."
        />
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && file && (
        <div className="w-full">
          {/* Result Header */}
          <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/30">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
                <svg
                  className="h-5 w-5 text-violet-600 dark:text-violet-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-violet-900 dark:text-violet-100">
                  Conversion Complete
                </p>
                <p className="text-sm text-violet-700 dark:text-violet-300">
                  {result.pageCount} slide{result.pageCount !== 1 ? "s" : ""} — 3 versions ready
                </p>
              </div>
            </div>
          </div>

          {/* File stat */}
          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Original PDF
            </p>
            <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {formatFileSize(result.originalSize)}
            </p>
          </div>

          {/* 3 Download Options */}
          <div className="mb-6 flex flex-col gap-3">
            {downloadOptions.map((opt) => {
              const baseName = file.name.replace(/\.pdf$/i, "");
              const outputName = `${baseName}-${opt.suffix}.pptx`;
              return (
                <div
                  key={opt.suffix}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">
                      {opt.label}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {opt.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                      {formatFileSize(opt.blob.size)}
                    </p>
                  </div>
                  <button
                    onClick={() => triggerDownload(opt.blob, outputName)}
                    className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 active:scale-95"
                  >
                    Download
                  </button>
                </div>
              );
            })}
          </div>

          {/* Convert Another */}
          <button
            onClick={handleReset}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            Convert Another PDF
          </button>
        </div>
      )}
    </ToolPageLayout>
  );
}
