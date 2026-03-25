"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  convertPdfToWord,
  type ProcessingUpdate,
  type PdfToWordResult,
} from "@/lib/tools/pdf-to-word";

type Stage = "upload" | "processing" | "done";

export default function PdfToWordPage() {
  const tool = getToolById("pdf-to-word")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<PdfToWordResult | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const processingResult = await convertPdfToWord(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      console.error("PDF-to-Word conversion failed:", err);
      setStage("upload");
      alert(
        "Failed to convert the PDF. The file may be encrypted, corrupted, or unsupported. Please try a different file."
      );
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;

    const baseName = file.name.replace(/\.pdf$/i, "");
    const outputName = `${baseName}.docx`;

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
          title="Select a PDF to convert to Word"
          subtitle="Supports text-based PDFs. Preserves fonts, bold, italic, and page layout."
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
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Conversion Complete
              </h3>
              <p className="text-sm text-slate-500">
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""} converted — ready to download
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 active:bg-violet-800 transition-colors shadow-md shadow-violet-500/25"
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
                Download .docx
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Convert Another
              </button>
            </div>
          </div>

          {/* Result Summary Card */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-violet-600"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  {file.name.replace(/\.pdf$/i, "")}.docx
                </p>
                <p className="text-sm text-slate-500 mt-0.5">
                  Word Document — {formatFileSize(result.processedSize)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200">
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900">
                  {result.pageCount}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Page{result.pageCount !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-slate-900">
                  {formatFileSize(result.originalSize)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Original PDF</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-violet-600">
                  {formatFileSize(result.processedSize)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Word File</p>
              </div>
            </div>
          </div>

          {/* Formatting note */}
          <div className="mt-4 flex items-start gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-500 shrink-0 mt-0.5"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-amber-700 leading-relaxed">
              Formatting accuracy depends on the PDF source. Text-based PDFs preserve bold, italic, and font sizes well. For scanned PDFs, OCR support is coming in a future update.
            </p>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          How it works
        </h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select any text-based PDF document — reports, contracts, forms, or manuals.",
            },
            {
              step: "2",
              title: "Text Extraction",
              desc: "The engine reads every text element, capturing position, font, size, and style information.",
            },
            {
              step: "3",
              title: "Layout Reconstruction",
              desc: "Text items are grouped into lines and paragraphs, preserving bold, italic, and font sizing.",
            },
            {
              step: "4",
              title: "Download .docx",
              desc: "Get a fully editable Word document with page breaks matching the original PDF.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex flex-col items-center text-center"
            >
              <div className="w-10 h-10 rounded-full bg-violet-50 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-violet-600">
                  {item.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1">
                {item.title}
              </h3>
              <p className="text-xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </ToolPageLayout>
  );
}
