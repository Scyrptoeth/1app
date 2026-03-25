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
            Conversion Complete
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            {result.pageCount} slide{result.pageCount !== 1 ? "s" : ""} &middot; 3 output versions ready
          </p>

          {/* Original file info */}
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-4">
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
            <div className="text-left min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {file.name}
              </p>
              <p className="text-xs text-slate-500">{formatFileSize(result.originalSize)}</p>
            </div>
          </div>

          {/* 3 output versions */}
          {(
            [
              {
                label: "Hybrid",
                description: "Background image + white text overlay — visual fidelity + copyable text",
                blob: result.hybridBlob,
                suffix: "hybrid",
              },
              {
                label: "Image Only",
                description: "Full-page screenshot per slide — identical to original PDF",
                blob: result.imageOnlyBlob,
                suffix: "image",
              },
              {
                label: "Text Only",
                description: "Editable text boxes on white background — best for editing",
                blob: result.textOnlyBlob,
                suffix: "text",
              },
            ] as const
          ).map((opt) => {
            const baseName = file.name.replace(/\.pdf$/i, "");
            const outputName = `${baseName}-${opt.suffix}.pptx`;
            return (
              <div
                key={opt.suffix}
                className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl mb-3"
              >
                {/* File icon */}
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-slate-400"
                  >
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                </div>

                {/* Info */}
                <div className="text-left min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">
                    {opt.label}
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {opt.description}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatFileSize(opt.blob.size)}
                  </p>
                </div>

                {/* Download button */}
                <button
                  onClick={() => triggerDownload(opt.blob, outputName)}
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-white text-sm font-semibold rounded-lg hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-sm shadow-accent-500/25"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download
                </button>
              </div>
            );
          })}

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
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {label}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Percentage of slides where editable text was successfully extracted from the PDF.
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
              Output quality depends on the source PDF structure. Text-based PDFs produce the most editable presentations. Scanned or image-heavy PDFs will be converted as images.
            </p>
          </div>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="w-full mt-1 px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
          >
            Convert Another PDF
          </button>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select any PDF document — presentations, reports, or scanned files.",
            },
            {
              step: "2",
              title: "Smart Extraction",
              desc: "Text, images, and layout are analyzed. Editable text is extracted where possible, preserving fonts and positioning.",
            },
            {
              step: "3",
              title: "3 Output Modes",
              desc: "Get three versions: Hybrid (image + text overlay), Image Only (visual fidelity), and Text Only (fully editable).",
            },
            {
              step: "4",
              title: "Download PPTX",
              desc: "Download your preferred version as a PowerPoint file, ready to edit or present.",
            },
          ].map((item) => (
            <div key={item.step} className="flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-accent-600">{item.step}</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1">{item.title}</h3>
              <p className="text-xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </ToolPageLayout>
  );
}
