"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  mergePdfs,
  extractPageInfos,
  renderThumbnail,
  type ProcessingUpdate,
  type MergePdfResult,
  type PageInfo,
} from "@/lib/tools/pdf-merge";

type Stage = "upload" | "configure" | "processing" | "done";
type ViewMode = "file" | "page";

// Color palette for file badges
const FILE_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-pink-100 text-pink-700",
  "bg-lime-100 text-lime-700",
];

function getFileColor(index: number): string {
  return FILE_COLORS[index % FILE_COLORS.length];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── File-Level Card ───────────────────────────────────────────────

interface FileCardProps {
  file: File;
  index: number;
  pageCount: number;
  totalFiles: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  thumbnailUrl?: string;
}

function FileCard({
  file,
  index,
  pageCount,
  totalFiles,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  thumbnailUrl,
}: FileCardProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors cursor-grab active:cursor-grabbing"
    >
      {/* Drag handle */}
      <div className="text-slate-300 shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </div>

      {/* Thumbnail */}
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={`Preview of ${file.name}`}
          className="w-10 h-14 object-cover rounded border border-slate-100 shrink-0"
        />
      ) : (
        <div className="w-10 h-14 bg-slate-100 rounded border border-slate-100 shrink-0 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-300">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
      )}

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{file.name}</p>
        <p className="text-xs text-slate-500">
          {pageCount} page{pageCount !== 1 ? "s" : ""} &middot; {formatFileSize(file.size)}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move up"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === totalFiles - 1}
          className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move down"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
          aria-label="Remove file"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── Page Thumbnail Card ───────────────────────────────────────────

interface PageThumbProps {
  page: PageInfo;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleInclude: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function PageThumb({
  page,
  index,
  isFirst,
  isLast,
  canMoveUp,
  canMoveDown,
  onToggleInclude,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
}: PageThumbProps) {
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

  return (
    <div
      ref={observerRef}
      draggable={page.included}
      onDragStart={page.included ? onDragStart : undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative group rounded-lg border-2 transition-all ${
        page.included
          ? "border-slate-200 hover:border-slate-300 cursor-grab active:cursor-grabbing"
          : "border-dashed border-slate-200 opacity-40 cursor-default"
      }`}
    >
      {/* Thumbnail image */}
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden">
        {visible && page.thumbnailUrl ? (
          <img
            src={page.thumbnailUrl}
            alt={page.pageLabel}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        )}

        {/* Arrow controls — centered overlay on thumbnail */}
        {page.included && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-0.5">
              {/* Up */}
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
              {/* Left / Right row */}
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
              {/* Down */}
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
        )}

        {/* Exclude button — top right of thumbnail */}
        {page.included && (
          <button
            type="button"
            onClick={onToggleInclude}
            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 transition-all shadow-sm"
            aria-label="Exclude page"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {/* Excluded — restore button centered */}
        {!page.included && (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={onToggleInclude}
              className="p-2 rounded-full bg-white/90 text-slate-400 hover:text-emerald-500 transition-all shadow-sm"
              aria-label="Include page"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-700 truncate">
          Page {page.pageIndex + 1}
        </p>
        <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full ${getFileColor(page.fileIndex)}`}>
          {page.fileName.length > 20 ? page.fileName.slice(0, 18) + "..." : page.fileName}
        </span>
      </div>

      {/* Order number badge */}
      {page.included && (
        <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold flex items-center justify-center">
          {index + 1}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

export default function PdfMergePage() {
  const tool = getToolById("pdf-merge")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [fileOrder, setFileOrder] = useState<number[]>([]); // indices into files[]
  const [viewMode, setViewMode] = useState<ViewMode>("file");
  const [loadingPages, setLoadingPages] = useState(false);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<MergePdfResult | null>(null);

  // File thumbnails (first page of each file)
  const [fileThumbnails, setFileThumbnails] = useState<Record<number, string>>({});

  const dragIndexRef = useRef<number>(-1);

  // Derived: file page counts
  const filePageCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const p of pages) {
      counts[p.fileIndex] = (counts[p.fileIndex] || 0) + 1;
    }
    return counts;
  }, [pages]);

  // Derived: included page count
  const includedPageCount = useMemo(() => pages.filter((p) => p.included).length, [pages]);

  // Derived: pages ordered by file order (for file-level mode output)
  const pagesInFileOrder = useMemo(() => {
    const ordered: PageInfo[] = [];
    for (const fi of fileOrder) {
      ordered.push(...pages.filter((p) => p.fileIndex === fi));
    }
    return ordered;
  }, [pages, fileOrder]);

  const canMerge = files.length >= 2 && includedPageCount >= 1;

  // ─── File handling ─────────────────────────────────────────────

  const addFiles = useCallback(
    async (newFiles: File[]) => {
      const startIndex = files.length;
      const allFiles = [...files, ...newFiles];
      setFiles(allFiles);
      setFileOrder((prev) => [
        ...prev,
        ...newFiles.map((_, i) => startIndex + i),
      ]);
      setStage("configure");
      setLoadingPages(true);

      try {
        const newPageInfos = await extractPageInfos(newFiles);
        // Adjust file indices for newly added files
        const adjusted = newPageInfos.map((p) => ({
          ...p,
          fileIndex: p.fileIndex + startIndex,
        }));
        setPages((prev) => [...prev, ...adjusted]);

        // Render first-page thumbnails for new files
        for (let i = 0; i < newFiles.length; i++) {
          try {
            const url = await renderThumbnail(newFiles[i], 0, 100);
            setFileThumbnails((prev) => ({ ...prev, [startIndex + i]: url }));
          } catch {
            // Thumbnail failed — skip silently
          }
        }
      } catch (err) {
        console.error("Failed to extract page info:", err);
        alert("One or more files could not be read. They may be corrupted.");
      } finally {
        setLoadingPages(false);
      }
    },
    [files]
  );

  const handleFilesSelected = useCallback(
    (selected: File[]) => {
      addFiles(selected);
    },
    [addFiles]
  );

  // ─── File-level reorder ────────────────────────────────────────

  const moveFile = useCallback(
    (fromIdx: number, toIdx: number) => {
      setFileOrder((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    []
  );

  const removeFile = useCallback(
    (orderIdx: number) => {
      const fi = fileOrder[orderIdx];
      setFileOrder((prev) => prev.filter((_, i) => i !== orderIdx));
      setPages((prev) => prev.filter((p) => p.fileIndex !== fi));
      // Don't remove from files[] to keep indices stable
    },
    [fileOrder]
  );

  // ─── Page-level reorder ────────────────────────────────────────

  const movePage = useCallback(
    (fromIdx: number, toIdx: number) => {
      setPages((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
    },
    []
  );

  const togglePageInclude = useCallback((idx: number) => {
    setPages((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, included: !p.included } : p))
    );
  }, []);

  // ─── Lazy thumbnail loading for page-level view ────────────────

  useEffect(() => {
    if (viewMode !== "page") return;

    let cancelled = false;
    const loadThumbnails = async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled) break;
        if (pages[i].thumbnailUrl) continue;

        try {
          const file = files[pages[i].fileIndex];
          if (!file) continue;
          const url = await renderThumbnail(file, pages[i].pageIndex, 150);
          if (cancelled) break;
          setPages((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, thumbnailUrl: url } : p
            )
          );
        } catch {
          // Skip failed thumbnails
        }
      }
    };

    loadThumbnails();
    return () => {
      cancelled = true;
    };
  }, [viewMode, pages.length, files]);

  // ─── Merge ─────────────────────────────────────────────────────

  const handleMerge = useCallback(async () => {
    if (!canMerge) return;

    setStage("processing");

    const finalPages = viewMode === "file" ? pagesInFileOrder : pages;

    try {
      const mergeResult = await mergePdfs({
        files,
        pageOrder: finalPages,
        onProgress: (update) => setProgress(update),
      });
      setResult(mergeResult);
      setStage("done");
    } catch (err) {
      console.error("Merge failed:", err);
      setStage("configure");
      alert("Failed to merge PDFs. One or more files may be corrupted or encrypted.");
    }
  }, [canMerge, files, pages, pagesInFileOrder, viewMode]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFiles([]);
    setPages([]);
    setFileOrder([]);
    setFileThumbnails({});
    setViewMode("file");
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  const handleBackToConfigure = useCallback(() => {
    setStage("configure");
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  // ─── Drag handlers (shared) ────────────────────────────────────

  const onDragStartFactory = (idx: number) => (e: React.DragEvent) => {
    dragIndexRef.current = idx;
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOverFactory = () => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropFileFactory = (dropIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragIndexRef.current;
    if (fromIdx >= 0 && fromIdx !== dropIdx) {
      moveFile(fromIdx, dropIdx);
    }
    dragIndexRef.current = -1;
  };

  const onDropPageFactory = (dropIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragIndexRef.current;
    if (fromIdx >= 0 && fromIdx !== dropIdx) {
      movePage(fromIdx, dropIdx);
    }
    dragIndexRef.current = -1;
  };

  // ─── Render ────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool}>
      {/* Upload stage */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={200}
          multiple={true}
          onFilesSelected={handleFilesSelected}
          title="Select PDF files to merge"
          subtitle="Upload 2 or more PDFs — drag & drop or click to select"
        />
      )}

      {/* Configure stage */}
      {stage === "configure" && (
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Mode toggle + Add more */}
          <div className="flex items-center justify-between">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("file")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "file"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                File View
              </button>
              <button
                type="button"
                onClick={() => setViewMode("page")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === "page"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Page View
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add files
              <input
                type="file"
                accept=".pdf"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  if (selected.length > 0) addFiles(selected);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {loadingPages && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-blue-700">Loading pages...</span>
            </div>
          )}

          {/* File-level view */}
          {viewMode === "file" && (
            <div className="space-y-2">
              {fileOrder.map((fi, orderIdx) => {
                const file = files[fi];
                if (!file) return null;
                return (
                  <FileCard
                    key={`file-${fi}`}
                    file={file}
                    index={orderIdx}
                    pageCount={filePageCounts[fi] || 0}
                    totalFiles={fileOrder.length}
                    onMoveUp={() => moveFile(orderIdx, orderIdx - 1)}
                    onMoveDown={() => moveFile(orderIdx, orderIdx + 1)}
                    onRemove={() => removeFile(orderIdx)}
                    onDragStart={onDragStartFactory(orderIdx)}
                    onDragOver={onDragOverFactory()}
                    onDrop={onDropFileFactory(orderIdx)}
                    thumbnailUrl={fileThumbnails[fi]}
                  />
                );
              })}
            </div>
          )}

          {/* Page-level view */}
          {viewMode === "page" && (
            <div className="grid grid-cols-3 gap-3">
              {pages.map((page, idx) => (
                <PageThumb
                  key={`page-${page.fileIndex}-${page.pageIndex}-${idx}`}
                  page={page}
                  index={pages.slice(0, idx).filter((p) => p.included).length}
                  isFirst={idx === 0}
                  isLast={idx === pages.length - 1}
                  canMoveUp={idx >= 3}
                  canMoveDown={idx + 3 <= pages.length - 1}
                  onToggleInclude={() => togglePageInclude(idx)}
                  onMoveLeft={() => movePage(idx, idx - 1)}
                  onMoveRight={() => movePage(idx, idx + 1)}
                  onMoveUp={() => movePage(idx, Math.max(0, idx - 3))}
                  onMoveDown={() => movePage(idx, Math.min(pages.length - 1, idx + 3))}
                  onDragStart={onDragStartFactory(idx)}
                  onDragOver={onDragOverFactory()}
                  onDrop={onDropPageFactory(idx)}
                />
              ))}
            </div>
          )}

          {/* Summary + Merge button */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {fileOrder.length} file{fileOrder.length !== 1 ? "s" : ""} &middot;{" "}
                {includedPageCount} page{includedPageCount !== 1 ? "s" : ""} selected
                {pages.length !== includedPageCount && (
                  <span className="text-slate-400">
                    {" "}
                    ({pages.length - includedPageCount} excluded)
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {formatFileSize(files.reduce((sum, f) => sum + f.size, 0))} total
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
                onClick={handleMerge}
                disabled={!canMerge}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Merge PDF
              </button>
            </div>

            {files.length < 2 && files.length > 0 && (
              <p className="mt-2 text-xs text-amber-600 text-center">
                Upload at least 2 PDF files to merge.
              </p>
            )}
            {files.length >= 2 && includedPageCount === 0 && (
              <p className="mt-2 text-xs text-amber-600 text-center">
                At least 1 page must be included.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Processing stage */}
      {stage === "processing" && (
        <ProcessingView
          fileName={`${files.length} files`}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Done stage */}
      {stage === "done" && result && (
        <>
          <DownloadView
            fileName={result.fileName}
            fileSize={formatFileSize(result.mergedSize)}
            onDownload={handleDownload}
            onReset={handleReset}
          />

          {/* Modify button */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={handleBackToConfigure}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              Modify page order
            </button>
          </div>

          {/* Merge stats */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <span>{result.totalPages} pages</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>
                {formatFileSize(result.originalTotalSize)} &rarr;{" "}
                {formatFileSize(result.mergedSize)}
              </span>
            </div>
          </div>

          {/* Source files */}
          <div className="mt-4 mb-4 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <p className="text-xs font-medium text-slate-700 mb-2">
              Merged from {result.sourceFiles.length} files:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.sourceFiles.map((name, i) => (
                <span
                  key={name}
                  className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${getFileColor(i)}`}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Pages are copied as-is without recompression. Original quality, fonts, and layout are fully preserved.
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
              title: "Upload PDFs",
              desc: "Select two or more PDF files you want to combine.",
            },
            {
              step: "2",
              title: "Arrange Order",
              desc: "Drag & drop to reorder files or individual pages. Remove pages you don't need.",
            },
            {
              step: "3",
              title: "Download Merged PDF",
              desc: "Get a single PDF with all pages in your chosen order.",
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
