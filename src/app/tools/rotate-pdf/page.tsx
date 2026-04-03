"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  rotatePdf,
  renderPageThumbnail,
  getPdfPageCount,
  type ProcessingUpdate,
  type RotatePdfResult,
} from "@/lib/tools/pdf-rotator";

type Stage = "upload" | "configure" | "processing" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function getRotationTransform(degrees: number): string {
  const norm = normalizeAngle(degrees);
  if (norm === 0) return "";
  // Scale down for 90/270 so rotated image fits the portrait container
  if (norm === 90) return "rotate(90deg) scale(0.75)";
  if (norm === 180) return "rotate(180deg)";
  if (norm === 270) return "rotate(270deg) scale(0.75)";
  return `rotate(${norm}deg)`;
}

// ─── Page Thumbnail ────────────────────────────────────────────────

interface PageThumbnailProps {
  pageIndex: number;
  thumbnailUrl?: string;
  rotation: number;
  selected: boolean;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onRotate180: () => void;
  onToggleSelect: () => void;
}

function PageThumbnail({
  pageIndex,
  thumbnailUrl,
  rotation,
  selected,
  onRotateLeft,
  onRotateRight,
  onRotate180,
  onToggleSelect,
}: PageThumbnailProps) {
  const observerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const normRotation = normalizeAngle(rotation);
  const transform = getRotationTransform(rotation);

  return (
    <div
      ref={observerRef}
      className={`relative rounded-lg border-2 transition-all ${
        selected
          ? "border-accent-400 ring-2 ring-accent-100"
          : "border-slate-200 hover:border-slate-300"
      }`}
    >
      {/* Checkbox — top left */}
      <button
        type="button"
        onClick={onToggleSelect}
        className={`absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
          selected
            ? "bg-accent-500 border-accent-500"
            : "bg-white/80 border-slate-300 hover:border-slate-400"
        }`}
        aria-label={`Select page ${pageIndex + 1}`}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      {/* Rotation badge — top right */}
      {normRotation !== 0 && (
        <div className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
          {normRotation}°
        </div>
      )}

      {/* Thumbnail with CSS rotation */}
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {visible && thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Page ${pageIndex + 1}`}
            className="w-full h-full object-contain transition-transform duration-200"
            style={transform ? { transform } : undefined}
          />
        ) : (
          <div className="text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        )}
      </div>

      {/* Page label + rotation controls */}
      <div className="px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-600 text-center mb-1.5">
          Page {pageIndex + 1}
        </p>
        <div className="flex items-center justify-center gap-1">
          {/* Rotate Left 90° */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRotateLeft(); }}
            className="p-1 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-all"
            aria-label="Rotate left 90°"
            title="Rotate left 90°"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>

          {/* Rotate Right 90° */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRotateRight(); }}
            className="p-1 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-all"
            aria-label="Rotate right 90°"
            title="Rotate right 90°"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>

          {/* Rotate 180° */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRotate180(); }}
            className="p-1 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-all"
            aria-label="Rotate 180°"
            title="Rotate 180°"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 12a9 9 0 1 1-9-9" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

export default function RotatePdfPage() {
  const tool = getToolById("rotate-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [rotations, setRotations] = useState<Map<number, number>>(new Map());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<RotatePdfResult | null>(null);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  // ─── File handling ─────────────────────────────────────────────

  const handleFileSelected = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;

    setFile(f);
    setStage("configure");
    setLoadingThumbnails(true);
    setRotations(new Map());
    setSelectedPages(new Set());
    setThumbnails({});

    try {
      const count = await getPdfPageCount(f);
      setPageCount(count);

      for (let i = 0; i < count; i++) {
        try {
          const url = await renderPageThumbnail(f, i, 150);
          setThumbnails((prev) => ({ ...prev, [i]: url }));
        } catch {
          // Skip failed thumbnails
        }
      }
    } catch (err) {
      console.error("Failed to load PDF:", err);
      alert("Failed to read the PDF file. It may be corrupted or encrypted.");
      setStage("upload");
    } finally {
      setLoadingThumbnails(false);
    }
  }, []);

  // ─── Rotation ──────────────────────────────────────────────────

  const rotatePage = useCallback((pageIndex: number, degrees: number) => {
    setRotations((prev) => {
      const next = new Map(prev);
      const current = next.get(pageIndex) || 0;
      const newAngle = normalizeAngle(current + degrees);
      if (newAngle === 0) {
        next.delete(pageIndex);
      } else {
        next.set(pageIndex, newAngle);
      }
      return next;
    });
  }, []);

  const rotateSelected = useCallback((degrees: number) => {
    const targets = selectedPages.size > 0
      ? Array.from(selectedPages)
      : Array.from({ length: pageCount }, (_, i) => i);

    setRotations((prev) => {
      const next = new Map(prev);
      for (const idx of targets) {
        const current = next.get(idx) || 0;
        const newAngle = normalizeAngle(current + degrees);
        if (newAngle === 0) {
          next.delete(idx);
        } else {
          next.set(idx, newAngle);
        }
      }
      return next;
    });
  }, [selectedPages, pageCount]);

  const resetAll = useCallback(() => {
    setRotations(new Map());
  }, []);

  // ─── Selection ─────────────────────────────────────────────────

  const togglePageSelect = useCallback((pageIndex: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageIndex)) {
        next.delete(pageIndex);
      } else {
        next.add(pageIndex);
      }
      return next;
    });
  }, []);

  const allSelected = selectedPages.size === pageCount && pageCount > 0;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
    }
  }, [allSelected, pageCount]);

  // ─── Process & Download ────────────────────────────────────────

  const hasRotations = rotations.size > 0;

  const handleProcess = useCallback(async () => {
    if (!file || !hasRotations) return;
    setStage("processing");

    try {
      const processResult = await rotatePdf(file, rotations, (update) => setProgress(update));
      setResult(processResult);
      setStage("done");
    } catch (err) {
      console.error("Rotation failed:", err);
      setStage("configure");
      alert("Failed to rotate PDF. The file may be corrupted or encrypted.");
    }
  }, [file, rotations, hasRotations]);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.pdf$/i, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `${baseName}-rotated.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    setPageCount(0);
    setThumbnails({});
    setRotations(new Map());
    setSelectedPages(new Set());
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  const rotatedPageCount = rotations.size;

  // ─── Render ────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool}>
      {/* Upload */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={200}
          onFilesSelected={handleFileSelected}
          title="Select a PDF to rotate"
          subtitle="Upload a PDF file — drag & drop or click to select"
        />
      )}

      {/* Configure */}
      {stage === "configure" && (
        <div className="max-w-4xl mx-auto space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-sm font-medium text-slate-700 truncate">{file?.name}</span>
              <span className="text-xs text-slate-400">{pageCount} pages</span>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              Change file
            </button>
          </div>

          {loadingThumbnails && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-blue-700">Loading page thumbnails...</span>
            </div>
          )}

          {/* Bulk controls */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              {allSelected ? "Deselect All" : "Select All"}
            </button>

            <div className="w-px h-5 bg-slate-200" />

            <button
              type="button"
              onClick={() => rotateSelected(-90)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              title={selectedPages.size > 0 ? "Rotate selected left 90°" : "Rotate all left 90°"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Left 90°
            </button>

            <button
              type="button"
              onClick={() => rotateSelected(90)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              title={selectedPages.size > 0 ? "Rotate selected right 90°" : "Rotate all right 90°"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Right 90°
            </button>

            <button
              type="button"
              onClick={() => rotateSelected(180)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
              title={selectedPages.size > 0 ? "Rotate selected 180°" : "Rotate all 180°"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-9-9" />
                <polyline points="21 3 21 9 15 9" />
              </svg>
              180°
            </button>

            <div className="w-px h-5 bg-slate-200" />

            <button
              type="button"
              onClick={resetAll}
              disabled={!hasRotations}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reset All
            </button>

            {selectedPages.size > 0 && (
              <span className="text-[10px] text-slate-400 ml-auto">
                {selectedPages.size} selected
              </span>
            )}
          </div>

          {/* Thumbnail grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: pageCount }, (_, i) => (
              <PageThumbnail
                key={i}
                pageIndex={i}
                thumbnailUrl={thumbnails[i]}
                rotation={rotations.get(i) || 0}
                selected={selectedPages.has(i)}
                onRotateLeft={() => rotatePage(i, -90)}
                onRotateRight={() => rotatePage(i, 90)}
                onRotate180={() => rotatePage(i, 180)}
                onToggleSelect={() => togglePageSelect(i)}
              />
            ))}
          </div>

          {/* Summary + action buttons */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {rotatedPageCount} of {pageCount} page{pageCount !== 1 ? "s" : ""} rotated
              </div>
              <div className="text-xs text-slate-400">
                {file ? formatFileSize(file.size) : ""}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleReset}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleProcess}
                disabled={!hasRotations}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download Rotated PDF
              </button>
            </div>

            {!hasRotations && (
              <p className="mt-2 text-xs text-amber-600 text-center">
                Rotate at least one page to download.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Processing */}
      {stage === "processing" && (
        <ProcessingView
          fileName={file?.name || "PDF"}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Done */}
      {stage === "done" && result && file && (
        <>
          <DownloadView
            fileName={file.name.replace(/\.pdf$/i, "") + "-rotated.pdf"}
            fileSize={formatFileSize(result.processedSize)}
            onDownload={handleDownload}
            onReset={handleReset}
          />

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span>{result.pageCount} page{result.pageCount > 1 ? "s" : ""}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{rotatedPageCount} rotated</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{formatFileSize(result.originalSize)} &rarr; {formatFileSize(result.processedSize)}</span>
            </div>
          </div>

          <div className="mt-6 mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Rotation is lossless — only page orientation metadata is changed. Original content, fonts, images, and quality are fully preserved.
            </p>
          </div>
        </>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select a PDF document whose pages you want to rotate.",
            },
            {
              step: "2",
              title: "Rotate Pages",
              desc: "Rotate individual pages or use bulk controls to rotate multiple pages at once.",
            },
            {
              step: "3",
              title: "Download",
              desc: "Download your rotated PDF — original quality fully preserved.",
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
