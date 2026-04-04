"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  splitPdf,
  createZip,
  getPdfPageCount,
  renderPageThumbnail,
  type ProcessingUpdate,
  type SplitGroup,
  type SplitPdfResult,
} from "@/lib/tools/pdf-splitter";

type Stage = "upload" | "configure" | "processing" | "done";

// Color palette for groups
const GROUP_COLORS = [
  { border: "border-blue-300", bg: "bg-blue-50", header: "bg-blue-100 text-blue-800", badge: "bg-blue-100 text-blue-700" },
  { border: "border-emerald-300", bg: "bg-emerald-50", header: "bg-emerald-100 text-emerald-800", badge: "bg-emerald-100 text-emerald-700" },
  { border: "border-violet-300", bg: "bg-violet-50", header: "bg-violet-100 text-violet-800", badge: "bg-violet-100 text-violet-700" },
  { border: "border-amber-300", bg: "bg-amber-50", header: "bg-amber-100 text-amber-800", badge: "bg-amber-100 text-amber-700" },
  { border: "border-rose-300", bg: "bg-rose-50", header: "bg-rose-100 text-rose-800", badge: "bg-rose-100 text-rose-700" },
  { border: "border-cyan-300", bg: "bg-cyan-50", header: "bg-cyan-100 text-cyan-800", badge: "bg-cyan-100 text-cyan-700" },
  { border: "border-pink-300", bg: "bg-pink-50", header: "bg-pink-100 text-pink-800", badge: "bg-pink-100 text-pink-700" },
  { border: "border-lime-300", bg: "bg-lime-50", header: "bg-lime-100 text-lime-800", badge: "bg-lime-100 text-lime-700" },
];

function getGroupColor(index: number) {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let groupIdCounter = 0;
function nextGroupId(): string {
  return `group-${++groupIdCounter}`;
}

// Grid columns constant for up/down arrow movement
const GRID_COLS = 3;

function normalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360;
}

function getRotationTransform(deg: number): string {
  const n = normalizeAngle(deg);
  if (n === 0) return "";
  if (n === 90) return "rotate(90deg) scale(0.75)";
  if (n === 180) return "rotate(180deg)";
  if (n === 270) return "rotate(270deg) scale(0.75)";
  return `rotate(${n}deg)`;
}

// ─── Page Thumbnail in a Group ─────────────────────────────────────

interface PageThumbInGroupProps {
  pageIndex: number; // 0-based original page index
  thumbnailUrl?: string;
  rotation: number;
  canRemove: boolean;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function PageThumbInGroup({
  pageIndex,
  thumbnailUrl,
  rotation,
  canRemove,
  isFirst,
  isLast,
  canMoveUp,
  canMoveDown,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onRemove,
  onRotateLeft,
  onRotateRight,
  onDragStart,
  onDragOver,
  onDrop,
}: PageThumbInGroupProps) {
  const transform = getRotationTransform(rotation);
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
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative group rounded-lg border-2 border-slate-200 hover:border-slate-300 cursor-grab active:cursor-grabbing transition-all"
    >
      {/* Thumbnail */}
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden">
        {visible && thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Page ${pageIndex + 1}`}
            className="w-full h-full object-contain transition-transform duration-200"
            style={{ transform: transform || undefined }}
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

        {/* Remove button — top right of thumbnail */}
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
          aria-label="Remove page"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Page number + rotation controls */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-600">
          Page {pageIndex + 1}{rotation !== 0 && <span className="text-slate-400"> · {normalizeAngle(rotation)}°</span>}
        </p>
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={(e) => { e.stopPropagation(); onRotateLeft(); }} className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Rotate left" title="Rotate left 90°">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onRotateRight(); }} className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors" aria-label="Rotate right" title="Rotate right 90°">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
        </div>
      </div>

      {/* Order badge */}
      <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold flex items-center justify-center">
        {pageIndex + 1}
      </div>
    </div>
  );
}

// ─── Removed Page Thumbnail ────────────────────────────────────────

interface RemovedPageThumbProps {
  pageIndex: number;
  thumbnailUrl?: string;
  onRestore: () => void;
}

function RemovedPageThumb({ pageIndex, thumbnailUrl, onRestore }: RemovedPageThumbProps) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Page ${pageIndex + 1}`}
            className="w-full h-full object-contain"
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

      <div className="px-2 py-1.5 border-t border-slate-100 text-center">
        <p className="text-[10px] font-medium text-slate-500">
          Page {pageIndex + 1}
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────

export default function SplitPdfPage() {
  const tool = getToolById("split-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [groups, setGroups] = useState<SplitGroup[]>([]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<SplitPdfResult | null>(null);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Map<number, number>>(new Map());

  const dragDataRef = useRef<{ pageIndex: number; fromGroupId: string } | null>(null);

  // ─── Computed ─────────────────────────────────────────────────

  // Total active pages across all groups
  const totalActivePages = groups.reduce((sum, g) => sum + g.pageIndices.length, 0);

  // ─── File handling ─────────────────────────────────────────────

  const handleFileSelected = useCallback(async (selected: File[]) => {
    const f = selected[0];
    if (!f) return;

    setFile(f);
    setStage("configure");
    setLoadingThumbnails(true);

    try {
      const count = await getPdfPageCount(f);
      setPageCount(count);

      // Create default group with all pages
      const defaultGroup: SplitGroup = {
        id: nextGroupId(),
        label: "PDF 1",
        pageIndices: Array.from({ length: count }, (_, i) => i),
      };
      setGroups([defaultGroup]);
      setRemovedPages([]);

      // Render thumbnails lazily
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

  // ─── Group management ──────────────────────────────────────────

  const addGroup = useCallback(() => {
    setGroups((prev) => [
      ...prev,
      {
        id: nextGroupId(),
        label: `PDF ${prev.length + 1}`,
        pageIndices: [],
      },
    ]);
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const group = prev.find((g) => g.id === groupId);
      if (!group) return prev;

      // Move pages back to first group
      const remaining = prev.filter((g) => g.id !== groupId);
      if (remaining.length === 0) return prev; // Can't remove last group

      const updated = [...remaining];
      updated[0] = {
        ...updated[0],
        pageIndices: [...updated[0].pageIndices, ...group.pageIndices],
      };
      return updated;
    });
  }, []);

  const renameGroup = useCallback((groupId: string, newLabel: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, label: newLabel } : g))
    );
  }, []);

  const movePageWithinGroup = useCallback(
    (groupId: string, fromIdx: number, toIdx: number) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const pages = [...g.pageIndices];
          const [moved] = pages.splice(fromIdx, 1);
          pages.splice(toIdx, 0, moved);
          return { ...g, pageIndices: pages };
        })
      );
    },
    []
  );

  const movePageToGroup = useCallback(
    (pageIndex: number, fromGroupId: string, toGroupId: string, insertIdx?: number) => {
      setGroups((prev) => {
        return prev.map((g) => {
          if (g.id === fromGroupId) {
            return {
              ...g,
              pageIndices: g.pageIndices.filter((pi) => pi !== pageIndex),
            };
          }
          if (g.id === toGroupId) {
            const pages = [...g.pageIndices];
            const idx = insertIdx !== undefined ? insertIdx : pages.length;
            pages.splice(idx, 0, pageIndex);
            return { ...g, pageIndices: pages };
          }
          return g;
        });
      });
    },
    []
  );

  // ─── Rotate ────────────────────────────────────────────────────

  const rotatePage = useCallback((pageIdx: number, delta: number) => {
    setRotations(prev => {
      const next = new Map(prev);
      const cur = next.get(pageIdx) || 0;
      next.set(pageIdx, normalizeAngle(cur + delta));
      return next;
    });
  }, []);

  // ─── Remove / Restore pages ─────────────────────────────────────

  const removePageFromGroup = useCallback((groupId: string, posIdx: number) => {
    setGroups((prev) => {
      const group = prev.find((g) => g.id === groupId);
      if (!group) return prev;
      const pageIndex = group.pageIndices[posIdx];
      if (pageIndex === undefined) return prev;

      setRemovedPages((rm) => [...rm, pageIndex]);

      return prev.map((g) => {
        if (g.id !== groupId) return g;
        const pages = [...g.pageIndices];
        pages.splice(posIdx, 1);
        return { ...g, pageIndices: pages };
      });
    });
  }, []);

  const restorePage = useCallback((pageIndex: number) => {
    setRemovedPages((prev) => prev.filter((p) => p !== pageIndex));
    setGroups((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[0] = {
        ...updated[0],
        pageIndices: [...updated[0].pageIndices, pageIndex],
      };
      return updated;
    });
  }, []);

  // ─── Drag and drop between groups ──────────────────────────────

  const onPageDragStart = useCallback(
    (pageIndex: number, fromGroupId: string) => (e: React.DragEvent) => {
      dragDataRef.current = { pageIndex, fromGroupId };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(pageIndex));
    },
    []
  );

  const onGroupDragOver = useCallback(() => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onGroupDrop = useCallback(
    (toGroupId: string) => (e: React.DragEvent) => {
      e.preventDefault();
      const data = dragDataRef.current;
      if (!data) return;

      const { pageIndex, fromGroupId } = data;

      if (fromGroupId === toGroupId) {
        // Reorder within same group
        const group = groups.find((g) => g.id === toGroupId);
        if (!group) return;
        const fromIdx = group.pageIndices.indexOf(pageIndex);
        if (fromIdx < 0) return;
        // Drop at end
        movePageWithinGroup(toGroupId, fromIdx, group.pageIndices.length - 1);
      } else {
        movePageToGroup(pageIndex, fromGroupId, toGroupId);
      }

      dragDataRef.current = null;
    },
    [groups, movePageWithinGroup, movePageToGroup]
  );

  // ─── Within-group page drag ────────────────────────────────────

  const onPageDragOverInGroup = useCallback(() => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onPageDropInGroup = useCallback(
    (groupId: string, dropIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const data = dragDataRef.current;
      if (!data) return;

      const { pageIndex, fromGroupId } = data;

      if (fromGroupId === groupId) {
        const group = groups.find((g) => g.id === groupId);
        if (!group) return;
        const fromIdx = group.pageIndices.indexOf(pageIndex);
        if (fromIdx >= 0 && fromIdx !== dropIdx) {
          movePageWithinGroup(groupId, fromIdx, dropIdx);
        }
      } else {
        movePageToGroup(pageIndex, fromGroupId, groupId, dropIdx);
      }

      dragDataRef.current = null;
    },
    [groups, movePageWithinGroup, movePageToGroup]
  );

  // ─── Split ────────────────────────────────────────────────────

  // Groups already only contain active pages — no filtering needed
  const canSplit = groups.some((g) => g.pageIndices.length > 0);

  const handleSplit = useCallback(async () => {
    if (!file || !canSplit) return;

    setStage("processing");

    try {
      const splitResult = await splitPdf({
        file,
        groups,
        rotations: rotations.size > 0 ? rotations : undefined,
        onProgress: (update) => setProgress(update),
      });
      setResult(splitResult);
      setStage("done");
    } catch (err) {
      console.error("Split failed:", err);
      setStage("configure");
      alert("Failed to split PDF. The file may be corrupted or encrypted.");
    }
  }, [file, groups, canSplit]);

  const handleDownloadFile = useCallback((blob: Blob, fileName: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, []);

  const handleDownloadZip = useCallback(async () => {
    if (!result) return;

    try {
      const zipBlob = await createZip(result.files);
      const baseName = file?.name.replace(/\.pdf$/i, "") || "split";
      handleDownloadFile(zipBlob, `${baseName}-split.zip`);
    } catch (err) {
      console.error("ZIP creation failed:", err);
      alert("Failed to create ZIP file.");
    }
  }, [result, file, handleDownloadFile]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    setPageCount(0);
    setThumbnails({});
    setGroups([]);
    setRemovedPages([]);
    setEditingLabelId(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
    groupIdCounter = 0;
  }, []);

  const handleBackToConfigure = useCallback(() => {
    setStage("configure");
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  // ─── Render ────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool}>
      {/* Upload stage */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={200}
          onFilesSelected={handleFileSelected}
          title="Select a PDF to split"
          subtitle="Upload a PDF file — drag & drop or click to select"
        />
      )}

      {/* Configure stage */}
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

          {/* Groups */}
          <div className="space-y-4">
            {groups.map((group, gi) => {
              const colors = getGroupColor(gi);
              return (
                <div
                  key={group.id}
                  onDragOver={onGroupDragOver()}
                  onDrop={onGroupDrop(group.id)}
                  className={`border-2 ${colors.border} ${colors.bg} rounded-xl overflow-hidden transition-colors`}
                >
                  {/* Group header */}
                  <div className={`flex items-center justify-between px-3 py-2 ${colors.header}`}>
                    <div className="flex items-center gap-2">
                      {editingLabelId === group.id ? (
                        <input
                          autoFocus
                          type="text"
                          value={group.label}
                          onChange={(e) => renameGroup(group.id, e.target.value)}
                          onBlur={() => setEditingLabelId(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") setEditingLabelId(null);
                          }}
                          className="px-2 py-0.5 text-sm font-semibold bg-white/60 rounded border-0 outline-none focus:ring-2 focus:ring-white/50 w-40"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingLabelId(group.id)}
                          className="text-sm font-semibold hover:opacity-70 transition-opacity"
                          title="Click to rename"
                        >
                          {group.label}
                        </button>
                      )}
                      <span className="text-xs opacity-60">
                        {group.pageIndices.length} page{group.pageIndices.length !== 1 ? "s" : ""}
                      </span>
                    </div>

                    {groups.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeGroup(group.id)}
                        className="p-1 rounded hover:bg-white/30 transition-colors"
                        aria-label={`Remove ${group.label}`}
                        title="Remove group (pages move to first group)"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Page thumbnails grid */}
                  <div className="p-3">
                    {group.pageIndices.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                        Drag pages here
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {group.pageIndices.map((pageIdx, posIdx) => (
                          <PageThumbInGroup
                            key={`${group.id}-${pageIdx}`}
                            pageIndex={pageIdx}
                            thumbnailUrl={thumbnails[pageIdx]}
                            rotation={rotations.get(pageIdx) || 0}
                            canRemove={totalActivePages > 1}
                            isFirst={posIdx === 0}
                            isLast={posIdx === group.pageIndices.length - 1}
                            canMoveUp={posIdx >= GRID_COLS}
                            canMoveDown={posIdx + GRID_COLS <= group.pageIndices.length - 1}
                            onMoveLeft={() => {
                              if (posIdx > 0) movePageWithinGroup(group.id, posIdx, posIdx - 1);
                            }}
                            onMoveRight={() => {
                              if (posIdx < group.pageIndices.length - 1)
                                movePageWithinGroup(group.id, posIdx, posIdx + 1);
                            }}
                            onMoveUp={() => {
                              if (posIdx >= GRID_COLS)
                                movePageWithinGroup(group.id, posIdx, Math.max(0, posIdx - GRID_COLS));
                            }}
                            onMoveDown={() => {
                              if (posIdx + GRID_COLS <= group.pageIndices.length - 1)
                                movePageWithinGroup(group.id, posIdx, Math.min(group.pageIndices.length - 1, posIdx + GRID_COLS));
                            }}
                            onRemove={() => removePageFromGroup(group.id, posIdx)}
                            onRotateLeft={() => rotatePage(pageIdx, -90)}
                            onRotateRight={() => rotatePage(pageIdx, 90)}
                            onDragStart={onPageDragStart(pageIdx, group.id)}
                            onDragOver={onPageDragOverInGroup()}
                            onDrop={onPageDropInGroup(group.id, posIdx)}
                          />
                        ))}
                      </div>
                    )}

                    {/* Move to group buttons */}
                    {groups.length > 1 && group.pageIndices.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="text-[10px] text-slate-400 self-center mr-1">Move all to:</span>
                        {groups
                          .filter((g) => g.id !== group.id)
                          .map((targetGroup) => {
                            const tc = getGroupColor(groups.indexOf(targetGroup));
                            return (
                              <button
                                key={targetGroup.id}
                                type="button"
                                onClick={() => {
                                  setGroups((prev) =>
                                    prev.map((g) => {
                                      if (g.id === group.id) return { ...g, pageIndices: [] };
                                      if (g.id === targetGroup.id)
                                        return {
                                          ...g,
                                          pageIndices: [...g.pageIndices, ...group.pageIndices],
                                        };
                                      return g;
                                    })
                                  );
                                }}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${tc.badge} hover:opacity-80 transition-opacity`}
                              >
                                {targetGroup.label}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add group button */}
          <button
            type="button"
            onClick={addGroup}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add PDF group
          </button>

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
                    onRestore={() => restorePage(pageIdx)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Summary + Split button */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {groups.filter((g) => g.pageIndices.length > 0).length} PDF file{groups.filter((g) => g.pageIndices.length > 0).length !== 1 ? "s" : ""} &middot;{" "}
                {totalActivePages} pages
                {removedPages.length > 0 && (
                  <span className="text-slate-400"> ({removedPages.length} removed)</span>
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
                onClick={handleSplit}
                disabled={!canSplit}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Split PDF
              </button>
            </div>

            {groups.filter((g) => g.pageIndices.length > 0).length < 2 && (
              <p className="mt-2 text-xs text-amber-600 text-center">
                Create at least 2 PDF groups with pages to split.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Processing stage */}
      {stage === "processing" && (
        <ProcessingView
          fileName={file?.name || "PDF"}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {/* Done stage */}
      {stage === "done" && result && (
        <div className="max-w-lg mx-auto">
          {/* Success icon */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">Split complete!</h3>
            <p className="text-sm text-slate-500">
              {result.files.length} file{result.files.length !== 1 ? "s" : ""} created from {result.originalPageCount} pages
            </p>
          </div>

          {/* Individual file downloads */}
          <div className="space-y-2 mb-4">
            {result.files.map((f, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{f.label}.pdf</p>
                    <p className="text-xs text-slate-500">
                      {f.pageCount} page{f.pageCount !== 1 ? "s" : ""} &middot; {formatFileSize(f.blob.size)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadFile(f.blob, `${f.label}.pdf`)}
                  className="shrink-0 p-2 text-slate-400 hover:text-accent-600 transition-colors"
                  aria-label={`Download ${f.label}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Download All as ZIP + actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={handleDownloadZip}
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download All as ZIP
            </button>
            <button
              onClick={handleReset}
              className="w-full sm:w-auto px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Split Another
            </button>
          </div>

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
              Modify groups
            </button>
          </div>

          {/* Stats */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <span>{result.originalPageCount} pages</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{formatFileSize(result.originalSize)} original</span>
            </div>
          </div>

          {/* Info Notice */}
          <div className="mt-6 mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Pages are copied as-is without recompression. Original quality, fonts, images, and layout are fully preserved.
            </p>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select the PDF file you want to split into multiple files.",
            },
            {
              step: "2",
              title: "Organize Groups",
              desc: "Create output groups and drag pages between them. Reorder and rename as needed.",
            },
            {
              step: "3",
              title: "Download Files",
              desc: "Get individual PDFs or download all at once as a ZIP file.",
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
