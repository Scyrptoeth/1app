"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertWordToPdf,
  type ProcessingUpdate,
  type WordToPdfResult,
} from "@/lib/tools/word-to-pdf";

type Stage = "upload" | "processing" | "done";

const DOC_FALLBACK_MESSAGE =
  "The legacy .doc format has limited conversion support in the browser. " +
  "For best results, use .docx files. If you only have a .doc file, open it " +
  "in Microsoft Word or LibreOffice and re-save it as .docx (File → Save As → .docx), then try again.";

export default function WordToPdfPage() {
  const tool = getToolById("word-to-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<WordToPdfResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setErrorMessage(null);
    setStage("processing");

    try {
      const processingResult = await convertWordToPdf(selectedFile, (update) =>
        setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("DOC_FORMAT_NOT_SUPPORTED")) {
        setErrorMessage(DOC_FALLBACK_MESSAGE);
      } else {
        setErrorMessage(
          "Failed to convert the document. The file may be corrupted, encrypted, or in an unsupported format."
        );
      }
      setStage("upload");
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.(docx|doc)$/i, "");
    const outputName = `${baseName}-converted.pdf`;
    const a = document.createElement("a");
    a.href = result.previewUrl;
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [result, file]);

  const handleReset = useCallback(() => {
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
    setErrorMessage(null);
  }, [result]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ToolPageLayout tool={tool}>
      {/* Error notice */}
      {errorMessage && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-red-500 shrink-0 mt-0.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-red-700 leading-relaxed">{errorMessage}</p>
        </div>
      )}

      {/* Upload stage */}
      {stage === "upload" && (
        <>
          <FileUploader
            acceptedFormats={[".docx", ".doc"]}
            maxSizeMB={50}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            title="Select a Word document to convert to PDF"
            subtitle="Supports .docx (recommended) and .doc files up to 50 MB"
          />

          {/* .doc format notice */}
          <div className="mt-4 flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-amber-500 shrink-0 mt-0.5"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>The .doc format (legacy)</strong> has limited conversion support in the browser.
              For best results, use <strong>.docx</strong> files. If you only have a .doc file, open it
              in Microsoft Word or LibreOffice and re-save it as .docx first.
            </p>
          </div>
        </>
      )}

      {/* Processing stage */}
      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Done stage */}
      {stage === "done" && result && file && (
        <div className="w-full">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Conversion Complete</h3>
              <p className="text-sm text-slate-500">
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""} &middot; text is
                searchable &amp; selectable
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download .pdf
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Convert Another
              </button>
            </div>
          </div>

          {/* Quality badge */}
          {(() => {
            const score = result.qualityScore;
            const label =
              score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : "Poor";
            const badgeClass =
              score >= 90
                ? "bg-emerald-50 text-emerald-700"
                : score >= 70
                ? "bg-blue-50 text-blue-700"
                : score >= 50
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700";
            return (
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  Conversion Quality: {label} ({score}/100)
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Score reflects how completely the document content was rendered. Documents with
                  non-standard fonts or highly complex layouts may score lower.
                </p>
              </div>
            );
          })()}

          {/* Info notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
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
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Converted 100% in your browser — no files are sent to any server. Text in the PDF
              is searchable (Ctrl+F), selectable, copyable, and printable. Fonts not available
              in the browser will be substituted with a similar typeface.
            </p>
          </div>

          {/* PDF Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">PDF Preview</span>
              <span className="text-xs text-slate-400">
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""}
              </span>
            </div>
            <iframe
              src={result.previewUrl}
              className="w-full"
              style={{ height: "600px" }}
              title="PDF Preview"
            />
          </div>

          {/* File size info */}
          <div className="mt-4 flex items-center justify-center gap-6 text-sm text-slate-500">
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
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              Word {formatFileSize(result.originalSize)} &rarr; PDF{" "}
              {formatFileSize(result.processedSize)}
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload Word",
              desc: "Select a .docx or .doc file from your device.",
            },
            {
              step: "2",
              title: "Render Document",
              desc: "The document is rendered in your browser with high precision — preserving fonts, tables, images, and charts.",
            },
            {
              step: "3",
              title: "Generate PDF",
              desc: "Each page is packaged into a PDF with a searchable and selectable text layer.",
            },
            {
              step: "4",
              title: "Download PDF",
              desc: "Download the result directly — no data is sent to any server.",
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
