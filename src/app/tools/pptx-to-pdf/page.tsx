"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { HowItWorks } from "@/components/HowItWorks";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertPptxToPdf,
  type ProcessingUpdate,
  type PptxToPdfResult,
} from "@/lib/tools/pptx-to-pdf";

type Stage = "upload" | "processing" | "done";

export default function PptxToPdfPage() {
  const tool = getToolById("pptx-to-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<PptxToPdfResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setErrorMessage(null);
    setStage("processing");

    try {
      const processingResult = await convertPptxToPdf(selectedFile, (update) =>
        setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(
        message.startsWith("File bukan PPTX")
          ? "Invalid file: not a valid PPTX file."
          : "Failed to convert file. The file may be corrupted, encrypted, or in an unsupported format."
      );
      setStage("upload");
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.(pptx|ppt)$/i, "");
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
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload PowerPoint",
            desc: "Select a .pptx or .ppt file from your device. PPTX is recommended for best results.",
          },
          {
            step: "2",
            title: "Parse Slides",
            desc: "Every slide element, including images, shapes, and text, is read directly from the PowerPoint file.",
          },
          {
            step: "3",
            title: "Render to PDF",
            desc: "Each slide is rendered as a PDF page with vector text that is searchable, selectable, and printable.",
          },
          {
            step: "4",
            title: "Download PDF",
            desc: "Download your converted PDF instantly. All processing happens in your browser, so no data is sent to any server.",
          },
        ]}
      />

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
            acceptedFormats={[".pptx", ".ppt"]}
            maxSizeMB={100}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            title="Select a PowerPoint file to convert to PDF"
            subtitle="Supports .pptx (recommended) and .ppt up to 100 MB"
          />

          {/* .ppt format notice */}
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
              <strong>.ppt (legacy format)</strong> has limited browser conversion support.
              For best results, use a <strong>.pptx</strong> file. If you only have .ppt,
              open it in Microsoft PowerPoint or LibreOffice and re-save as .pptx first.
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
                {result.slideCount} {result.slideCount === 1 ? "page" : "pages"} &middot; text is selectable &amp; searchable
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
                Convert Another File
              </button>
            </div>
          </div>

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
              Converted 100% in your browser — no files are sent to any server.
              Text in the PDF is searchable (Ctrl+F), selectable, copyable, and printable.
              Fonts not available in the browser will be replaced with similar fonts.
            </p>
          </div>

          {/* PDF Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">PDF Preview</span>
              <span className="text-xs text-slate-400">
                {result.slideCount} {result.slideCount === 1 ? "page" : "pages"}
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
                {result.slideCount} {result.slideCount === 1 ? "page" : "pages"}
              </span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              PowerPoint {formatFileSize(result.originalSize)} &rarr; PDF{" "}
              {formatFileSize(result.processedSize)}
            </div>
          </div>
        </div>
      )}

    </ToolPageLayout>
  );
}
