"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { HowItWorks } from "@/components/HowItWorks";
import { getToolById } from "@/config/tools";
import {
  removePdfWatermark,
  type ProcessingUpdate,
  type PdfProcessingResult,
} from "@/lib/tools/pdf-watermark-remover";

type Stage = "upload" | "processing" | "done";

export default function PdfWatermarkRemovePage() {
  const tool = getToolById("pdf-watermark-remove")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<PdfProcessingResult | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const processingResult = await removePdfWatermark(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      console.error("PDF processing failed:", err);
      setStage("upload");
      alert(
        "Failed to process the PDF. The file may be encrypted or corrupted. Please try a different file."
      );
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;

    const baseName = file.name.replace(/\.pdf$/i, "");
    const outputName = `${baseName}-no-watermark.pdf`;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

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

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to remove watermark"
          subtitle="Supports multi-page PDF documents"
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
        <>
          <DownloadView
            fileName={
              file.name.replace(/\.pdf$/i, "") + "-no-watermark.pdf"
            }
            fileSize={formatFileSize(result.processedSize)}
            onDownload={handleDownload}
            onReset={handleReset}
          />

          {/* Extra info for PDF */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
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
              <span>{result.pageCount} page{result.pageCount > 1 ? "s" : ""}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>
                {formatFileSize(result.originalSize)} &rarr;{" "}
                {formatFileSize(result.processedSize)}
              </span>
            </div>
          </div>

          {/* Data Quality */}
          {(() => {
            const score = result.qualityScore;
            const label =
              score >= 80
                ? `Data Quality: High (${score}%)`
                : score >= 50
                ? `Data Quality: Medium (${score}%)`
                : `Data Quality: Low (${score}%)`;
            const badgeClass =
              score >= 80
                ? "bg-emerald-50 text-emerald-700"
                : score >= 50
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700";
            return (
              <div className="mt-4 mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {label}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Estimated success rate for watermark removal based on PDF structure analysis.
                </p>
              </div>
            );
          })()}

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Removal quality depends on how the watermark was embedded. Overlay-type watermarks are easiest to remove cleanly.
            </p>
          </div>
        </>
      )}

      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload PDF",
            desc: "Select a PDF document that contains watermarks. Multi-page documents are fully supported.",
          },
          {
            step: "2",
            title: "Smart Detection",
            desc: "The engine analyzes the PDF structure to identify watermark layers, annotations, and overlays, then removes them while preserving all original content.",
          },
          {
            step: "3",
            title: "Download Clean PDF",
            desc: "Download your watermark-free PDF instantly. All processing happens in your browser, so your files stay private.",
          },
        ]}
      />
    </ToolPageLayout>
  );
}
