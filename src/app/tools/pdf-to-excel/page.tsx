"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  convertPdfToExcel,
  type ProcessingUpdate,
  type PdfToExcelResult,
  type PageData,
  type RowData,
} from "@/lib/tools/pdf-to-excel";

type Stage = "upload" | "processing" | "preview" | "done";

export default function PdfToExcelPage() {
  const tool = getToolById("pdf-to-excel")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<PdfToExcelResult | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const processingResult = await convertPdfToExcel(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setActiveTab(0);
      setStage("preview");
    } catch (err) {
      console.error("PDF processing failed:", err);
      setStage("upload");
      alert(
        "Failed to process the PDF. The file may be encrypted, corrupted, or contain no readable content. Please try a different file."
      );
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;

    const baseName = file.name.replace(/\.pdf$/i, "");
    const outputName = `${baseName}.xlsx`;

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
    setActiveTab(0);
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatNumber = (val: number | null): string => {
    if (val === null) return "";
    return val.toLocaleString("id-ID");
  };

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to convert to Excel"
          subtitle="Supports multi-page PDF documents (scanned or text-based)"
        />
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "preview" && result && file && (
        <div className="w-full">
          {/* Preview Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Preview
              </h3>
              <p className="text-sm text-slate-500">
                {result.pages.length} sheet(s) extracted — review before
                downloading
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
                Download .xlsx
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Process Another
              </button>
            </div>
          </div>

          {/* PDF Data Quality */}
          {(() => {
            // confidence is only available for OCR-based (scanned) PDFs.
            // Text-based PDFs use direct text extraction (no OCR) and have no confidence score.
            const conf = (result as PdfToExcelResult & { confidence?: number }).confidence;
            const isTextBased = conf === undefined || conf === null;
            const qualityLabel = isTextBased
              ? "PDF Data Quality: Excellent (Text-based)"
              : conf >= 85
              ? `PDF Data Quality: ${conf.toFixed(1)}%`
              : conf >= 65
              ? `PDF Data Quality: ${conf.toFixed(1)}%`
              : `PDF Data Quality: ${conf.toFixed(1)}%`;
            const badgeClass = isTextBased || (conf !== undefined && conf >= 85)
              ? "bg-emerald-50 text-emerald-700"
              : conf !== undefined && conf >= 65
              ? "bg-amber-50 text-amber-700"
              : "bg-red-50 text-red-700";
            return (
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {qualityLabel}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Extraction accuracy depends on PDF Data Quality — the higher the score, the more precise the extracted data. For best results, use high-resolution, text-based PDFs with clear formatting.
                </p>
              </div>
            );
          })()}

          {/* Tab Navigation */}
          {result.pages.length > 1 && (
            <div className="flex gap-1 mb-4 border-b border-slate-200">
              {result.pages.map((page, idx) => (
                <button
                  key={page.pageNumber}
                  onClick={() => setActiveTab(idx)}
                  className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                    activeTab === idx
                      ? "bg-white text-accent-600 border border-slate-200 border-b-white -mb-px"
                      : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {page.sheetName}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {page.isSideBySide ? "(Side-by-side)" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Table Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              {result.pages[activeTab] && (
                <PreviewTable page={result.pages[activeTab]} formatNumber={formatNumber} />
              )}
            </div>
          </div>

          {/* File info */}
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
                {result.pages.length} page{result.pages.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="text-slate-300">|</div>
            <div>
              PDF {formatFileSize(result.originalSize)} &rarr; Excel{" "}
              {formatFileSize(result.processedSize)}
            </div>
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
              desc: "Select a PDF document containing tables, financial data, or structured content.",
            },
            {
              step: "2",
              title: "Smart Extraction",
              desc: "OCR engine reads every page and analyzes the layout — detecting columns, rows, and data types.",
            },
            {
              step: "3",
              title: "Preview",
              desc: "Review the extracted data in a table view. Each page becomes a separate Excel sheet.",
            },
            {
              step: "4",
              title: "Download Excel",
              desc: "Download a formatted .xlsx file with headers, borders, number formatting, and auto-fit columns.",
            },
          ].map((item) => (
            <div
              key={item.step}
              className="flex flex-col items-center text-center"
            >
              <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-accent-600">
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

/* ------------------------------------------------------------------ */
/*  Preview Table Component                                            */
/* ------------------------------------------------------------------ */

function PreviewTable({
  page,
  formatNumber,
}: {
  page: PageData;
  formatNumber: (val: number | null) => string;
}) {
  if (page.isSideBySide && page.leftRows && page.rightRows) {
    return (
      <SideBySidePreview
        leftRows={page.leftRows}
        rightRows={page.rightRows}
        leftTitle={page.leftTitle || "Left"}
        rightTitle={page.rightTitle || "Right"}
        formatNumber={formatNumber}
      />
    );
  }

  if (page.rawTable && page.rawTable.length > 0) {
    return <RawTablePreview rows={page.rawTable} />;
  }

  if (page.rows) {
    return (
      <SingleColumnPreview rows={page.rows} formatNumber={formatNumber} />
    );
  }

  return (
    <div className="p-8 text-center text-slate-400">
      No data extracted from this page.
    </div>
  );
}

function SingleColumnPreview({
  rows,
  formatNumber,
}: {
  rows: RowData[];
  formatNumber: (val: number | null) => string;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 sticky top-0">
        <tr>
          <th className="px-3 py-2.5 text-center font-semibold text-slate-700 w-12">
            No
          </th>
          <th className="px-3 py-2.5 text-left font-semibold text-slate-700">
            Keterangan
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-40">
            Sub-Amount (Rp)
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-40">
            Amount (Rp)
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr
            key={idx}
            className={`border-t border-slate-100 ${
              row.isHeader
                ? "bg-slate-50"
                : row.isTotal
                ? "bg-amber-50"
                : "hover:bg-slate-50/50"
            }`}
          >
            <td className="px-3 py-2 text-center text-slate-400">
              {row.rowNumber || ""}
            </td>
            <td
              className={`px-3 py-2 text-slate-800 ${
                row.isHeader || row.isTotal ? "font-semibold" : ""
              } ${row.isIndented ? "pl-8" : ""}`}
            >
              {row.label}
            </td>
            <td className="px-3 py-2 text-right text-slate-700 font-mono">
              {formatNumber(row.subValue)}
            </td>
            <td
              className={`px-3 py-2 text-right font-mono ${
                row.isTotal ? "font-semibold text-slate-900" : "text-slate-700"
              }`}
            >
              {formatNumber(row.mainValue)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawTablePreview({ rows }: { rows: string[][] }) {
  const numCols = Math.max(...rows.map((r) => r.length));
  // Scan the first 20 rows to find one that looks like a column header
  // (contains ≥2 year-like tokens or contains "Uraian"/"Description"/"No"/"Keterangan")
  const yearRe = /^(19|20)\d{2}$/;
  const labelRe = /^(uraian|no|description|keterangan)$/i;
  const headerIdx = rows.slice(0, 20).findIndex((row) =>
    row.filter((c) => yearRe.test((c || "").trim())).length >= 2 ||
    (row.some((c) => labelRe.test((c || "").trim())) && row.filter(Boolean).length >= 3)
  );
  const headerRow = headerIdx >= 0 ? rows[headerIdx] : null;
  const dataRows = headerIdx >= 0 ? rows.filter((_, i) => i !== headerIdx) : rows;

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 sticky top-0">
        <tr>
          {Array.from({ length: numCols }, (_, i) => (
            <th
              key={i}
              className="px-3 py-2.5 text-left font-semibold text-slate-700 whitespace-nowrap"
            >
              {headerRow ? headerRow[i] || "" : `Col ${i + 1}`}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {dataRows.map((row, rowIdx) => (
          <tr
            key={rowIdx}
            className="border-t border-slate-100 hover:bg-slate-50/50"
          >
            {Array.from({ length: numCols }, (_, colIdx) => {
              const val = row[colIdx] || "";
              const isNumeric = /^[\d,.\s]+$/.test(val) && val.trim() !== "";
              return (
                <td
                  key={colIdx}
                  className={`px-3 py-2 text-slate-800 ${
                    isNumeric ? "text-right font-mono text-slate-700" : ""
                  }`}
                >
                  {val}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SideBySidePreview({
  leftRows,
  rightRows,
  leftTitle,
  rightTitle,
  formatNumber,
}: {
  leftRows: RowData[];
  rightRows: RowData[];
  leftTitle: string;
  rightTitle: string;
  formatNumber: (val: number | null) => string;
}) {
  const maxRows = Math.max(leftRows.length, rightRows.length);

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 sticky top-0">
        <tr>
          <th className="px-3 py-2.5 text-left font-semibold text-slate-700">
            {leftTitle}
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-36">
            Rp
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-36">
            Nilai
          </th>
          <th className="w-4 bg-white"></th>
          <th className="px-3 py-2.5 text-left font-semibold text-slate-700">
            {rightTitle}
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-36">
            Rp
          </th>
          <th className="px-3 py-2.5 text-right font-semibold text-slate-700 w-36">
            Nilai
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxRows }, (_, idx) => {
          const left = leftRows[idx] || null;
          const right = rightRows[idx] || null;

          return (
            <tr key={idx} className="border-t border-slate-100">
              {/* Left side */}
              <td
                className={`px-3 py-2 text-slate-800 ${
                  left?.isHeader || left?.isTotal ? "font-semibold" : ""
                } ${
                  left?.isHeader
                    ? "bg-slate-50"
                    : left?.isTotal
                    ? "bg-amber-50"
                    : ""
                }`}
              >
                {left?.label || ""}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-slate-700 ${
                  left?.isHeader
                    ? "bg-slate-50"
                    : left?.isTotal
                    ? "bg-amber-50"
                    : ""
                }`}
              >
                {left ? formatNumber(left.subValue) : ""}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${
                  left?.isTotal ? "font-semibold bg-amber-50" : ""
                } ${left?.isHeader ? "bg-slate-50" : ""} text-slate-700`}
              >
                {left ? formatNumber(left.mainValue) : ""}
              </td>

              {/* Gap */}
              <td className="bg-slate-50"></td>

              {/* Right side */}
              <td
                className={`px-3 py-2 text-slate-800 ${
                  right?.isHeader || right?.isTotal ? "font-semibold" : ""
                } ${
                  right?.isHeader
                    ? "bg-slate-50"
                    : right?.isTotal
                    ? "bg-amber-50"
                    : ""
                }`}
              >
                {right?.label || ""}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono text-slate-700 ${
                  right?.isHeader
                    ? "bg-slate-50"
                    : right?.isTotal
                    ? "bg-amber-50"
                    : ""
                }`}
              >
                {right ? formatNumber(right.subValue) : ""}
              </td>
              <td
                className={`px-3 py-2 text-right font-mono ${
                  right?.isTotal ? "font-semibold bg-amber-50" : ""
                } ${right?.isHeader ? "bg-slate-50" : ""} text-slate-700`}
              >
                {right ? formatNumber(right.mainValue) : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
