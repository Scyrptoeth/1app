"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  rotatePdf,
  renderPageThumbnail,
  getPdfPageCount,
  type ProcessingUpdate,
  type RotatePdfResult,
} from "@/lib/tools/pdf-rotator";

type Stage = "upload" | "configure" | "processing" | "done";

const GRID_COLS = 3;

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
  if (norm === 90) return "rotate(90deg) scale(0.75)";
  if (norm === 180) return "rotate(180deg)";
  if (norm === 270) return "rotate(270deg) scale(0.75)";
  return `rotate(${norm}deg)`;
}

// ─── Active Page Thumbnail ─────────────────────────────────────────

interface PageThumbnailProps {
  pageIndex: number;
  thumbnailUrl?: string;
  rotation: number;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onRotate180: () => void;
  onToggleSelect: () => void;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function PageThumbnail({
  pageIndex,
  thumbnailUrl,
  rotation,
  selected,
  isFirst,
  isLast,
  canMoveUp,
  canMoveDown,
  canRemove,
  onRotateLeft,
  onRotateRight,
  onRotate180,
  onToggleSelect,
  onRemove,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
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
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative rounded-lg border-2 transition-all cursor-grab active:cursor-grabbing ${
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

      {/* Remove button — top right */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
        aria-label="Remove page"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

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

        {/* Arrow controls — center overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              disabled={!canMoveUp}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
              aria-label="Move up"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMoveLeft(); }}
                disabled={isFirst}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
                aria-label="Move left"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMoveRight(); }}
                disabled={isLast}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
                aria-label="Move right"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              disabled={!canMoveDown}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
              aria-label="Move down"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Page label + rotation badge + rotation controls */}
      <div className="px-2 py-1.5 border-t border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-medium text-slate-600">
            Page {pageIndex + 1}
          </p>
          {normRotation !== 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {normRotation}°
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-1">
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

// ─── Removed Page Thumbnail ────────────────────────────────────────

interface RemovedPageThumbProps {
  pageIndex: number;
  thumbnailUrl?: string;
  rotation: number;
  onRestore: () => void;
}

function RemovedPageThumb({ pageIndex, thumbnailUrl, rotation, onRestore }: RemovedPageThumbProps) {
  const normRotation = normalizeAngle(rotation);
  const transform = getRotationTransform(rotation);

  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Page ${pageIndex + 1}`}
            className="w-full h-full object-contain"
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

        {/* Restore button — center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={onRestore}
            className="p-2 rounded-full bg-white/90 text-slate-400 hover:text-emerald-500 transition-all shadow-sm"
            aria-label="Restore page"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-medium text-slate-500">Page {pageIndex + 1}</p>
          {normRotation !== 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
              {normRotation}°
            </span>
          )}
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
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Map<number, number>>(new Map());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<RotatePdfResult | null>(null);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  const dragIndexRef = useRef<number>(-1);

  // ─── Computed values ───────────────────────────────────────────

  const isDefaultOrder = pageOrder.length === pageCount && removedPages.length === 0 && pageOrder.every((v, i) => v === i);
  const hasChanges = rotations.size > 0 || removedPages.length > 0 || !isDefaultOrder;
  const rotatedPageCount = rotations.size;

  // ─── File handling ─────────────────────────────────────────────

  const handleFileSelected = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;

    setFile(f);
    setStage("configure");
    setLoadingThumbnails(true);
    setRotations(new Map());
    setSelectedPages(new Set());
    setRemovedPages([]);
    setThumbnails({});

    try {
      const count = await getPdfPageCount(f);
      setPageCount(count);
      setPageOrder(Array.from({ length: count }, (_, i) => i));

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

  // ─── Reorder ───────────────────────────────────────────────────

  const movePage = useCallback((fromIdx: number, toIdx: number) => {
    setPageOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // ─── Drag & drop ──────────────────────────────────────────────

  const onDragStartFactory = useCallback((posIdx: number) => (e: React.DragEvent) => {
    dragIndexRef.current = posIdx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(posIdx));
  }, []);

  const onDragOverFactory = useCallback(() => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDropFactory = useCallback((dropIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragIndexRef.current;
    if (fromIdx >= 0 && fromIdx !== dropIdx) {
      movePage(fromIdx, dropIdx);
    }
    dragIndexRef.current = -1;
  }, [movePage]);

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
      : [...pageOrder];

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
  }, [selectedPages, pageOrder]);

  // ─── Remove & Restore ─────────────────────────────────────────

  const removePage = useCallback((posIdx: number) => {
    setPageOrder((prev) => {
      if (prev.length <= 1) return prev;
      const pageIndex = prev[posIdx];
      const next = prev.filter((_, i) => i !== posIdx);
      setRemovedPages((rm) => [...rm, pageIndex]);
      // Deselect removed page
      setSelectedPages((sp) => {
        const ns = new Set(sp);
        ns.delete(pageIndex);
        return ns;
      });
      return next;
    });
  }, []);

  const restorePage = useCallback((pageIndex: number) => {
    setRemovedPages((prev) => prev.filter((p) => p !== pageIndex));
    setPageOrder((prev) => [...prev, pageIndex]);
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

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(pageOrder));
  }, [pageOrder]);

  const deselectAll = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  // ─── Reset All ─────────────────────────────────────────────────

  const resetAll = useCallback(() => {
    setRotations(new Map());
    setRemovedPages([]);
    setSelectedPages(new Set());
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i));
  }, [pageCount]);

  // ─── Process & Download ────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!file || !hasChanges) return;
    setStage("processing");

    try {
      const processResult = await rotatePdf(file, pageOrder, rotations, (update) => setProgress(update));
      setResult(processResult);
      setStage("done");
    } catch (err) {
      console.error("Processing failed:", err);
      setStage("configure");
      alert("Failed to process PDF. The file may be corrupted or encrypted.");
    }
  }, [file, hasChanges, pageOrder, rotations]);

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
    setPageOrder([]);
    setRemovedPages([]);
    setRotations(new Map());
    setSelectedPages(new Set());
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

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
              onClick={selectAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={deselectAll}
              disabled={selectedPages.size === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Deselect All
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
              disabled={!hasChanges}
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

          {/* Active pages grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {pageOrder.map((pageIdx, posIdx) => (
              <PageThumbnail
                key={`${pageIdx}-${posIdx}`}
                pageIndex={pageIdx}
                thumbnailUrl={thumbnails[pageIdx]}
                rotation={rotations.get(pageIdx) || 0}
                selected={selectedPages.has(pageIdx)}
                isFirst={posIdx === 0}
                isLast={posIdx === pageOrder.length - 1}
                canMoveUp={posIdx >= GRID_COLS}
                canMoveDown={posIdx + GRID_COLS <= pageOrder.length - 1}
                canRemove={pageOrder.length > 1}
                onRotateLeft={() => rotatePage(pageIdx, -90)}
                onRotateRight={() => rotatePage(pageIdx, 90)}
                onRotate180={() => rotatePage(pageIdx, 180)}
                onToggleSelect={() => togglePageSelect(pageIdx)}
                onRemove={() => removePage(posIdx)}
                onMoveLeft={() => { if (posIdx > 0) movePage(posIdx, posIdx - 1); }}
                onMoveRight={() => { if (posIdx < pageOrder.length - 1) movePage(posIdx, posIdx + 1); }}
                onMoveUp={() => { if (posIdx >= GRID_COLS) movePage(posIdx, Math.max(0, posIdx - GRID_COLS)); }}
                onMoveDown={() => { if (posIdx + GRID_COLS <= pageOrder.length - 1) movePage(posIdx, Math.min(pageOrder.length - 1, posIdx + GRID_COLS)); }}
                onDragStart={onDragStartFactory(posIdx)}
                onDragOver={onDragOverFactory()}
                onDrop={onDropFactory(posIdx)}
              />
            ))}
          </div>

          {/* Removed pages section */}
          {removedPages.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-500">Removed Pages</h3>
                <span className="text-[10px] text-slate-400">{removedPages.length} page{removedPages.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {removedPages.map((pageIdx) => (
                  <RemovedPageThumb
                    key={`removed-${pageIdx}`}
                    pageIndex={pageIdx}
                    thumbnailUrl={thumbnails[pageIdx]}
                    rotation={rotations.get(pageIdx) || 0}
                    onRestore={() => restorePage(pageIdx)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Summary + action buttons */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {pageOrder.length} of {pageCount} page{pageCount !== 1 ? "s" : ""}
                {rotatedPageCount > 0 && (
                  <span> &middot; {rotatedPageCount} rotated</span>
                )}
                {removedPages.length > 0 && (
                  <span className="text-slate-400"> &middot; {removedPages.length} removed</span>
                )}
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
                disabled={!hasChanges}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Download PDF
              </button>
            </div>

            {!hasChanges && (
              <p className="mt-2 text-xs text-amber-600 text-center">
                Make changes to download — rotate, reorder, or remove pages.
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
          <div className="w-full max-w-lg mx-auto text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">Processing complete!</h3>
            <p className="text-sm text-slate-500 mb-6">Your file is ready to download.</p>
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{file.name.replace(/\.pdf$/i, "") + "-rotated.pdf"}</p>
                <p className="text-xs text-slate-500">{formatFileSize(result.processedSize)}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </button>
              <button onClick={() => setStage("configure")} className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Back to Edit
              </button>
              <button onClick={handleReset} className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Process Another
              </button>
            </div>
          </div>

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
              Pages are copied as-is without recompression. Rotation only changes orientation metadata. Original content, fonts, images, and quality are fully preserved.
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
              desc: "Select a PDF document whose pages you want to rotate or rearrange.",
            },
            {
              step: "2",
              title: "Rotate & Arrange",
              desc: "Rotate pages individually or in bulk, reorder with drag & drop or arrows, and remove pages you don't need.",
            },
            {
              step: "3",
              title: "Download",
              desc: "Download your modified PDF — original quality fully preserved.",
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
