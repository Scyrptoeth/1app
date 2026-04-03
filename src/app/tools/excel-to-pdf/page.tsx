"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertExcelToPdf,
  type ProcessingUpdate,
  type ExcelToPdfResult,
} from "@/lib/tools/excel-to-pdf";

type Stage = "upload" | "processing" | "done";

export default function ExcelToPdfPage() {
  const tool = getToolById("excel-to-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<ExcelToPdfResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selected = files[0];
    setFile(selected);
    setErrorMessage(null);
    setStage("processing");

    try {
      const res = await convertExcelToPdf(selected, (u) => setProgress(u));
      setResult(res);
      setStage("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(
        msg.includes("No worksheets")
          ? "The file appears to be empty or contains no worksheets."
          : msg.includes("empty")
          ? "All worksheets in this file are empty."
          : "Failed to convert the Excel file. It may be corrupted, encrypted, or in an unsupported format."
      );
      setStage("upload");
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.(xlsx|xls)$/i, "");
    const a = document.createElement("a");
    a.href = result.previewUrl;
    a.download = `${baseName}-converted.pdf`;
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

  const fmtSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ToolPageLayout tool={tool}>
      {/* Error notice */}
      {errorMessage && (
        <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500 shrink-0 mt-0.5">
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
            acceptedFormats={[".xlsx", ".xls"]}
            maxSizeMB={50}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            title="Select an Excel file to convert to PDF"
            subtitle="Supports .xlsx files up to 50 MB"
          />

          <div className="mt-4 flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>.xlsx (Excel 2007+)</strong> is the recommended format. The legacy <strong>.xls</strong> format
              has limited support. If you have a .xls file, open it in Excel or LibreOffice and re-save as .xlsx first.
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
                {result.sheetCount} sheet{result.sheetCount !== 1 ? "s" : ""} &middot;{" "}
                {result.pageCount} page{result.pageCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            const s = result.qualityScore;
            const label = s >= 90 ? "Excellent" : s >= 70 ? "Good" : s >= 50 ? "Fair" : "Poor";
            const cls =
              s >= 90 ? "bg-emerald-50 text-emerald-700"
                : s >= 70 ? "bg-blue-50 text-blue-700"
                : s >= 50 ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700";
            return (
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${cls}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  Conversion Quality: {label} ({s}/100)
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Score reflects how many sheets were successfully rendered. Complex
                  formatting, charts, or macros may not be fully supported.
                </p>
              </div>
            );
          })()}

          {/* Info notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Converted 100% in your browser — no files are sent to any server. Cell
              styles, colors, borders, merged cells, and number formats are preserved.
              Text in the PDF is searchable and selectable.
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>{result.sheetCount} sheet{result.sheetCount !== 1 ? "s" : ""}, {result.pageCount} page{result.pageCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div>Excel {fmtSize(result.originalSize)} &rarr; PDF {fmtSize(result.processedSize)}</div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            { step: "1", title: "Upload Excel", desc: "Select an .xlsx or .xls file from your device." },
            { step: "2", title: "Parse Spreadsheet", desc: "All sheets, cell styles, colors, borders, merged cells, and number formats are extracted." },
            { step: "3", title: "Render to PDF", desc: "Each sheet is rendered as a styled table with auto-fit columns and smart pagination." },
            { step: "4", title: "Download PDF", desc: "Download the result directly — no data is sent to any server." },
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
