"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertExcelToPdf,
  type ProcessingUpdate,
  type ExcelToPdfResult,
} from "@/lib/tools/excel-to-pdf";
import { renderPageThumbnail } from "@/lib/tools/pdf-splitter";

type Stage = "upload" | "processing" | "configure" | "done";

export default function ExcelToPdfPage() {
  const tool = getToolById("excel-to-pdf")!;

  // Core state
  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<ExcelToPdfResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Configure state
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Map<number, number>>(new Map());
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [finalResult, setFinalResult] = useState<{ url: string; size: number; pages: number } | null>(null);
  const dragIdx = useRef<number>(-1);

  // Load thumbnails when entering configure stage
  useEffect(() => {
    if (stage !== "configure" || !result) return;
    const total = result.pageCount;
    setPageOrder(Array.from({ length: total }, (_, i) => i));
    setRotations(new Map());
    setRemovedPages([]);
    setSelectedPages(new Set());
    setThumbnails({});
    setFinalResult(null);

    const pdfFile = new File([result.blob], "output.pdf", { type: "application/pdf" });
    let cancelled = false;

    (async () => {
      for (let i = 0; i < total; i++) {
        if (cancelled) break;
        try {
          const thumb = await renderPageThumbnail(pdfFile, i, 150);
          if (!cancelled) setThumbnails((prev) => ({ ...prev, [i]: thumb }));
        } catch { /* skip failed thumbnail */ }
      }
    })();

    return () => { cancelled = true; };
  }, [stage, result]);

  // Handlers
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selected = files[0];
    setFile(selected);
    setErrorMessage(null);
    setStage("processing");
    try {
      const res = await convertExcelToPdf(selected, (u) => setProgress(u));
      setResult(res);
      setStage("configure");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(
        msg.includes("No worksheets") ? "The file appears to be empty or contains no worksheets."
          : msg.includes("empty") ? "All worksheets in this file are empty."
          : "Failed to convert the Excel file. It may be corrupted, encrypted, or in an unsupported format."
      );
      setStage("upload");
    }
  }, []);

  const handleReset = useCallback(() => {
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    if (finalResult?.url) URL.revokeObjectURL(finalResult.url);
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
    setFinalResult(null);
    setErrorMessage(null);
  }, [result, finalResult]);

  // --- Configure actions ---
  const movePage = (fromIdx: number, toIdx: number) => {
    setPageOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const rotatePage = (pageIdx: number, delta: number) => {
    setRotations((prev) => {
      const next = new Map(prev);
      const cur = next.get(pageIdx) || 0;
      next.set(pageIdx, ((cur + delta) % 360 + 360) % 360);
      return next;
    });
  };

  const rotateBulk = (delta: number) => {
    const targets = selectedPages.size > 0 ? selectedPages : new Set(pageOrder);
    setRotations((prev) => {
      const next = new Map(prev);
      for (const p of targets) {
        const cur = next.get(p) || 0;
        next.set(p, ((cur + delta) % 360 + 360) % 360);
      }
      return next;
    });
  };

  const removePage = (pageIdx: number) => {
    setPageOrder((prev) => prev.filter((p) => p !== pageIdx));
    setRemovedPages((prev) => [...prev, pageIdx]);
    setSelectedPages((prev) => { const n = new Set(prev); n.delete(pageIdx); return n; });
  };

  const restorePage = (pageIdx: number) => {
    setRemovedPages((prev) => prev.filter((p) => p !== pageIdx));
    setPageOrder((prev) => {
      const next = [...prev];
      // Insert at original position or end
      const insertAt = next.findIndex((p) => p > pageIdx);
      if (insertAt === -1) next.push(pageIdx);
      else next.splice(insertAt, 0, pageIdx);
      return next;
    });
  };

  const toggleSelect = (pageIdx: number) => {
    setSelectedPages((prev) => {
      const n = new Set(prev);
      if (n.has(pageIdx)) n.delete(pageIdx); else n.add(pageIdx);
      return n;
    });
  };

  const selectAll = () => setSelectedPages(new Set(pageOrder));
  const deselectAll = () => setSelectedPages(new Set());

  // --- Apply changes and go to done ---
  const hasChanges = result && (
    pageOrder.length !== result.pageCount ||
    pageOrder.some((p, i) => p !== i) ||
    Array.from(rotations.values()).some((r) => r !== 0) ||
    removedPages.length > 0
  );

  const applyAndDownload = async () => {
    if (!result || !file) return;
    setApplying(true);
    try {
      const { PDFDocument, degrees } = await import("pdf-lib");
      const srcDoc = await PDFDocument.load(await result.blob.arrayBuffer(), { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();

      for (const srcIdx of pageOrder) {
        const [copied] = await newDoc.copyPages(srcDoc, [srcIdx]);
        const rot = rotations.get(srcIdx) || 0;
        if (rot !== 0) {
          const cur = copied.getRotation().angle;
          copied.setRotation(degrees(((cur + rot) % 360 + 360) % 360));
        }
        newDoc.addPage(copied);
      }

      const pdfBytes = await newDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setFinalResult({ url, size: blob.size, pages: pageOrder.length });
      setStage("done");
    } catch {
      setErrorMessage("Failed to apply page changes.");
    }
    setApplying(false);
  };

  const skipToDownload = () => {
    if (!result) return;
    setFinalResult({ url: result.previewUrl, size: result.processedSize, pages: result.pageCount });
    setStage("done");
  };

  const handleDownload = useCallback(() => {
    if (!file) return;
    const url = finalResult?.url || result?.previewUrl;
    if (!url) return;
    const baseName = file.name.replace(/\.(xlsx|xls)$/i, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}-converted.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [finalResult, result, file]);

  const fmtSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // --- Drag handlers ---
  const onDragStart = (idx: number) => { dragIdx.current = idx; };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (targetIdx: number) => {
    if (dragIdx.current >= 0 && dragIdx.current !== targetIdx) {
      movePage(dragIdx.current, targetIdx);
    }
    dragIdx.current = -1;
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

      {/* Upload */}
      {stage === "upload" && (
        <>
          <FileUploader
            acceptedFormats={[".xlsx", ".xls"]}
            maxSizeMB={50}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            title="Select an Excel file to convert to PDF"
            subtitle="Supports .xlsx and .xls files up to 50 MB"
          />
          <div className="mt-4 flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-amber-700 leading-relaxed">
              <strong>.xlsx (Excel 2007+)</strong> preserves full styling — colors, borders, fonts, images.
              Legacy <strong>.xls</strong> files are supported with data and formatting, but visual styles may be limited.
            </p>
          </div>
        </>
      )}

      {/* Processing */}
      {stage === "processing" && file && (
        <ProcessingView fileName={file.name} progress={progress.progress} status={progress.status} />
      )}

      {/* Configure — reorder, rotate, remove pages */}
      {stage === "configure" && result && (
        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Configure Pages</h3>
              <p className="text-sm text-slate-500">
                {pageOrder.length} of {result.pageCount} pages &middot; Drag to reorder, rotate, or remove pages
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={skipToDownload} className="px-4 py-2 text-sm text-slate-600 font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                Skip
              </button>
              <button
                onClick={applyAndDownload}
                disabled={applying}
                className="px-4 py-2 text-sm bg-accent-500 text-white font-semibold rounded-lg hover:bg-accent-600 disabled:opacity-50 transition-colors shadow-sm"
              >
                {applying ? "Applying..." : hasChanges ? "Apply & Download" : "Download"}
              </button>
            </div>
          </div>

          {/* Bulk controls */}
          <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <button onClick={selectAll} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50">Select All</button>
            <button onClick={deselectAll} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50">Deselect</button>
            <div className="w-px h-5 bg-slate-200 mx-1" />
            <button onClick={() => rotateBulk(-90)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50">↺ 90°</button>
            <button onClick={() => rotateBulk(90)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50">↻ 90°</button>
            <button onClick={() => rotateBulk(180)} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white rounded-lg border border-slate-200 hover:bg-slate-50">180°</button>
            {selectedPages.size > 0 && (
              <span className="text-xs text-slate-400 ml-2">{selectedPages.size} selected</span>
            )}
          </div>

          {/* Page grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
            {pageOrder.map((pageIdx, orderIdx) => {
              const rot = rotations.get(pageIdx) || 0;
              const isSelected = selectedPages.has(pageIdx);
              return (
                <div
                  key={pageIdx}
                  draggable
                  onDragStart={() => onDragStart(orderIdx)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(orderIdx)}
                  className={`relative group rounded-xl border-2 transition-all cursor-grab active:cursor-grabbing ${
                    isSelected ? "border-accent-400 bg-accent-50/50" : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleSelect(pageIdx)}
                    className={`absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center text-xs transition-colors ${
                      isSelected ? "bg-accent-500 border-accent-500 text-white" : "bg-white/80 border-slate-300 text-transparent group-hover:border-slate-400"
                    }`}
                  >
                    ✓
                  </button>

                  {/* Page number */}
                  <span className="absolute top-1.5 right-1.5 z-10 bg-slate-800/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                    {pageIdx + 1}
                  </span>

                  {/* Rotation badge */}
                  {rot !== 0 && (
                    <span className="absolute top-7 right-1.5 z-10 bg-amber-500 text-white text-[9px] font-bold px-1 rounded">
                      {rot}°
                    </span>
                  )}

                  {/* Thumbnail */}
                  <div className="p-2 pt-7 pb-1 flex justify-center" style={{ minHeight: 130 }}>
                    {thumbnails[pageIdx] ? (
                      <img
                        src={thumbnails[pageIdx]}
                        alt={`Page ${pageIdx + 1}`}
                        className="max-h-[110px] rounded shadow-sm object-contain"
                        style={{ transform: `rotate(${rot}deg)` }}
                        draggable={false}
                      />
                    ) : (
                      <div className="w-20 h-[100px] bg-slate-100 rounded animate-pulse" />
                    )}
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between px-2 pb-2">
                    <div className="flex gap-0.5">
                      <button onClick={() => rotatePage(pageIdx, -90)} className="p-1 text-slate-400 hover:text-slate-600 text-xs" title="Rotate left">↺</button>
                      <button onClick={() => rotatePage(pageIdx, 90)} className="p-1 text-slate-400 hover:text-slate-600 text-xs" title="Rotate right">↻</button>
                    </div>
                    <button
                      onClick={() => removePage(pageIdx)}
                      disabled={pageOrder.length <= 1}
                      className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-30 transition-colors"
                      title="Remove page"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Removed pages */}
          {removedPages.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700">Removed Pages ({removedPages.length})</h4>
                <button
                  onClick={() => {
                    const all = [...pageOrder, ...removedPages].sort((a, b) => a - b);
                    setPageOrder(all);
                    setRemovedPages([]);
                  }}
                  className="text-xs text-accent-600 hover:text-accent-700 font-medium"
                >
                  Restore All
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {removedPages.map((pageIdx) => (
                  <div key={pageIdx} className="relative rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 opacity-60 hover:opacity-100 transition-opacity">
                    <span className="absolute top-1 left-1 z-10 bg-slate-500/70 text-white text-[9px] px-1 rounded">{pageIdx + 1}</span>
                    <div className="p-2 flex justify-center" style={{ minHeight: 80 }}>
                      {thumbnails[pageIdx] ? (
                        <img src={thumbnails[pageIdx]} alt={`Removed ${pageIdx + 1}`} className="max-h-[60px] rounded object-contain" draggable={false} />
                      ) : (
                        <div className="w-12 h-[60px] bg-slate-100 rounded" />
                      )}
                    </div>
                    <button
                      onClick={() => restorePage(pageIdx)}
                      className="absolute inset-0 flex items-center justify-center bg-white/40 opacity-0 hover:opacity-100 transition-opacity rounded-lg"
                      title="Restore page"
                    >
                      <span className="w-7 h-7 rounded-full bg-accent-500 text-white flex items-center justify-center text-lg font-bold shadow">+</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Done */}
      {stage === "done" && result && file && (
        <div className="w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Conversion Complete</h3>
              <p className="text-sm text-slate-500">
                {result.sheetCount} sheet{result.sheetCount !== 1 ? "s" : ""} &middot;{" "}
                {finalResult?.pages ?? result.pageCount} page{(finalResult?.pages ?? result.pageCount) !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleDownload} className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download .pdf
              </button>
              <button onClick={() => setStage("configure")} className="px-4 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Back to Edit
              </button>
              <button onClick={handleReset} className="px-4 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Convert Another
              </button>
            </div>
          </div>

          {/* Quality badge */}
          {(() => {
            const s = result.qualityScore;
            const label = s >= 90 ? "Excellent" : s >= 70 ? "Good" : s >= 50 ? "Fair" : "Poor";
            const cls = s >= 90 ? "bg-emerald-50 text-emerald-700" : s >= 70 ? "bg-blue-50 text-blue-700" : s >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700";
            return (
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${cls}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  Conversion Quality: {label} ({s}/100)
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Score reflects how many sheets were successfully rendered.
                </p>
              </div>
            );
          })()}

          {/* Info notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Converted 100% in your browser — no files are sent to any server.
              Text in the PDF is searchable and selectable.
            </p>
          </div>

          {/* PDF Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">PDF Preview</span>
              <span className="text-xs text-slate-400">{finalResult?.pages ?? result.pageCount} pages</span>
            </div>
            <iframe src={finalResult?.url || result.previewUrl} className="w-full" style={{ height: "600px" }} title="PDF Preview" />
          </div>

          <div className="mt-4 flex items-center justify-center gap-6 text-sm text-slate-500">
            <span>Excel {fmtSize(result.originalSize)} → PDF {fmtSize(finalResult?.size ?? result.processedSize)}</span>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-5 gap-6">
          {[
            { step: "1", title: "Upload Excel", desc: "Select an .xlsx or .xls file." },
            { step: "2", title: "Parse & Render", desc: "Sheets, styles, charts extracted and rendered to PDF." },
            { step: "3", title: "Configure Pages", desc: "Reorder, rotate, or remove pages before download." },
            { step: "4", title: "Apply Changes", desc: "Page modifications applied losslessly via pdf-lib." },
            { step: "5", title: "Download", desc: "Download directly — no data sent to any server." },
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
