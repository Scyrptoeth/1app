"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  insertWatermark,
  renderPageThumbnail,
  getPdfPageCount,
  getPageDimensions,
  type WatermarkPosition,
  type TextWatermarkConfig,
  type ImageWatermarkConfig,
  type InsertWatermarkResult,
  type ProcessingUpdate,
  type PageDimensions,
} from "@/lib/tools/pdf-insert-watermark";

type Stage = "upload" | "configure" | "processing" | "done";

const GRID_COLS = 3;

// ─── Constants ───────────────────────────────────────────────────────

const COLOR_PRESETS = [
  { hex: "#000000", r: 0, g: 0, b: 0 },
  { hex: "#FF0000", r: 1, g: 0, b: 0 },
  { hex: "#808080", r: 0.502, g: 0.502, b: 0.502 },
  { hex: "#0000FF", r: 0, g: 0, b: 1 },
  { hex: "#008000", r: 0, g: 0.502, b: 0 },
  { hex: "#FFFFFF", r: 1, g: 1, b: 1 },
];

const OPACITY_OPTIONS = [
  { label: "No transparency", value: 1 },
  { label: "25%", value: 0.75 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.25 },
];

const ROTATION_OPTIONS = [
  { label: "Do not rotate", value: 0 },
  { label: "45°", value: 45 },
  { label: "90°", value: 90 },
  { label: "135°", value: 135 },
  { label: "180°", value: 180 },
  { label: "225°", value: 225 },
  { label: "270°", value: 270 },
  { label: "315°", value: 315 },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(dims: PageDimensions): string {
  return `${Math.round(dims.width)} × ${Math.round(dims.height)} pts`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1], 16) / 255,
    g: parseInt(m[2], 16) / 255,
    b: parseInt(m[3], 16) / 255,
  };
}

// ─── Position Grid ───────────────────────────────────────────────────

const POSITIONS: WatermarkPosition[] = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
];

function PositionGrid({
  value,
  onChange,
  disabled,
}: {
  value: WatermarkPosition;
  onChange: (p: WatermarkPosition) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-grid grid-cols-3 gap-1.5 p-2.5 bg-slate-100 rounded-lg border border-slate-200">
      {POSITIONS.map((pos) => (
        <button
          key={pos}
          type="button"
          onClick={() => onChange(pos)}
          disabled={disabled}
          title={pos.replace(/-/g, " ")}
          className={`w-7 h-7 rounded transition-all ${
            value === pos && !disabled
              ? "bg-accent-500 shadow-sm"
              : "bg-white border border-slate-200 hover:border-slate-300"
          } ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span
            className={`block w-1.5 h-1.5 rounded-full mx-auto ${
              value === pos && !disabled ? "bg-white" : "bg-slate-300"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ─── Active Page Thumbnail ───────────────────────────────────────────

interface ActivePageThumbProps {
  pageIndex: number;
  thumbnailUrl?: string;
  dimensions?: PageDimensions;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ActivePageThumb({
  pageIndex,
  thumbnailUrl,
  dimensions,
  isFirst,
  isLast,
  canMoveUp,
  canMoveDown,
  canRemove,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: ActivePageThumbProps) {
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
      className="relative rounded-lg border-2 border-slate-200 hover:border-slate-300 cursor-grab active:cursor-grabbing transition-all"
    >
      <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold">
        Page {pageIndex + 1}
      </div>

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

      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {visible && thumbnailUrl ? (
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

        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="flex flex-col items-center gap-0.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={!canMoveUp}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm" aria-label="Move up">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
            </button>
            <div className="flex items-center gap-3">
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveLeft(); }} disabled={isFirst}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm" aria-label="Move left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveRight(); }} disabled={isLast}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm" aria-label="Move right">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={!canMoveDown}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm" aria-label="Move down">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-600">Page {pageIndex + 1}</p>
        {dimensions && <p className="text-[9px] text-slate-400">{formatDimensions(dimensions)}</p>}
      </div>
    </div>
  );
}

// ─── Removed Page Thumbnail ──────────────────────────────────────────

function RemovedPageThumb({
  pageIndex,
  thumbnailUrl,
  onRestore,
}: {
  pageIndex: number;
  thumbnailUrl?: string;
  onRestore: () => void;
}) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Page ${pageIndex + 1}`} className="w-full h-full object-contain" />
        ) : (
          <div className="text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        )}
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
        <p className="text-[10px] font-medium text-slate-500">Page {pageIndex + 1}</p>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function InsertPdfWatermarkPage() {
  const tool = getToolById("pdf-insert-watermark")!;

  // Stage
  const [stage, setStage] = useState<Stage>("upload");

  // File & PDF info
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [dimensions, setDimensions] = useState<PageDimensions[]>([]);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  // Page management
  const [activePages, setActivePages] = useState<number[]>([]);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const dragIndexRef = useRef<number>(-1);

  // Watermark config
  const [watermarkMode, setWatermarkMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [fontFamily, setFontFamily] = useState<"Helvetica" | "Times-Roman" | "Courier">("Helvetica");
  const [fontSize, setFontSize] = useState(48);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [fontColor, setFontColor] = useState({ r: 0, g: 0, b: 0 });
  const [colorHex, setColorHex] = useState("#000000");
  const [watermarkImage, setWatermarkImage] = useState<ArrayBuffer | null>(null);
  const [watermarkImageType, setWatermarkImageType] = useState<"png" | "jpg">("png");
  const [watermarkImagePreview, setWatermarkImagePreview] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(0.3);
  const [opacity, setOpacity] = useState(1);
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [mosaic, setMosaic] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [layer, setLayer] = useState<"over" | "below">("over");

  // Processing
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, stage: "" });
  const [result, setResult] = useState<InsertWatermarkResult | null>(null);

  // ─── Computed ──────────────────────────────────────────────────────

  const isDefaultOrder =
    activePages.length === pageCount &&
    removedPages.length === 0 &&
    activePages.every((v, i) => v === i);

  const canProcess =
    activePages.length > 0 &&
    ((watermarkMode === "text" && text.trim().length > 0) ||
      (watermarkMode === "image" && watermarkImage !== null));

  // ─── File handling ─────────────────────────────────────────────────

  const handleFileSelected = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;

    setFile(f);
    setStage("configure");
    setLoadingThumbnails(true);
    setThumbnails({});
    setRemovedPages([]);

    try {
      const [count, dims] = await Promise.all([
        getPdfPageCount(f),
        getPageDimensions(f),
      ]);
      setPageCount(count);
      setDimensions(dims);
      setActivePages(Array.from({ length: count }, (_, i) => i));

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

  // ─── Image watermark upload ────────────────────────────────────────

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const ext = f.name.split(".").pop()?.toLowerCase();
    setWatermarkImageType(ext === "png" ? "png" : "jpg");

    const reader = new FileReader();
    reader.onload = () => {
      setWatermarkImage(reader.result as ArrayBuffer);
      setWatermarkImagePreview(URL.createObjectURL(f));
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const clearWatermarkImage = useCallback(() => {
    if (watermarkImagePreview) URL.revokeObjectURL(watermarkImagePreview);
    setWatermarkImage(null);
    setWatermarkImagePreview(null);
  }, [watermarkImagePreview]);

  // ─── Page management ───────────────────────────────────────────────

  const movePage = useCallback((fromIdx: number, toIdx: number) => {
    setActivePages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const removePage = useCallback((posIdx: number) => {
    setActivePages((prev) => {
      if (prev.length <= 1) return prev;
      const pageIndex = prev[posIdx];
      const next = prev.filter((_, i) => i !== posIdx);
      setRemovedPages((rm) => [...rm, pageIndex]);
      return next;
    });
  }, []);

  const restorePage = useCallback((pageIndex: number) => {
    setRemovedPages((prev) => prev.filter((p) => p !== pageIndex));
    setActivePages((prev) => [...prev, pageIndex]);
  }, []);

  const resetOrder = useCallback(() => {
    setActivePages(Array.from({ length: pageCount }, (_, i) => i));
    setRemovedPages([]);
  }, [pageCount]);

  // ─── Drag & drop ──────────────────────────────────────────────────

  const onDragStartFactory = useCallback(
    (posIdx: number) => (e: React.DragEvent) => {
      dragIndexRef.current = posIdx;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(posIdx));
    },
    []
  );

  const onDragOverFactory = useCallback(
    () => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const onDropFactory = useCallback(
    (dropIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromIdx = dragIndexRef.current;
      if (fromIdx >= 0 && fromIdx !== dropIdx) movePage(fromIdx, dropIdx);
      dragIndexRef.current = -1;
    },
    [movePage]
  );

  // ─── Process & Download ────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!file || !canProcess) return;
    setStage("processing");

    try {
      const pdfData = await file.arrayBuffer();

      const watermarkConfig: TextWatermarkConfig | ImageWatermarkConfig =
        watermarkMode === "text"
          ? {
              mode: "text",
              text: text.trim(),
              fontFamily,
              fontSize,
              bold,
              italic,
              underline,
              color: fontColor,
              opacity,
            }
          : {
              mode: "image",
              imageData: watermarkImage!,
              imageType: watermarkImageType,
              scale: imageScale,
              opacity,
            };

      const res = await insertWatermark({
        pdfData,
        fileName: file.name,
        pageOrder: activePages,
        options: {
          watermark: watermarkConfig,
          position,
          mosaic,
          rotation,
          layer,
        },
        onProgress: (u) => setProgress(u),
      });

      setResult(res);
      setStage("done");
    } catch (err) {
      console.error("Watermark failed:", err);
      setStage("configure");
      alert("Failed to add watermark. The file may be corrupted or encrypted.");
    }
  }, [
    file, canProcess, watermarkMode, text, fontFamily, fontSize, bold, italic,
    underline, fontColor, opacity, watermarkImage, watermarkImageType, imageScale,
    activePages, position, mosaic, rotation, layer,
  ]);

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
    setFile(null);
    setPageCount(0);
    setThumbnails({});
    setDimensions([]);
    setActivePages([]);
    setRemovedPages([]);
    setProgress({ progress: 0, stage: "" });
    setResult(null);
  }, []);

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool}>
      {/* ─── Upload ──────────────────────────────────────────────── */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={200}
          onFilesSelected={handleFileSelected}
          title="Select a PDF to watermark"
          subtitle="Upload a PDF file — drag & drop or click to select"
        />
      )}

      {/* ─── Configure ───────────────────────────────────────────── */}
      {stage === "configure" && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span className="text-sm font-medium text-slate-700 truncate">{file?.name}</span>
              <span className="text-xs text-slate-400">{pageCount} pages</span>
              {file && <span className="text-xs text-slate-400">&middot; {formatFileSize(file.size)}</span>}
            </div>
            <button type="button" onClick={handleReset} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Change file
            </button>
          </div>

          {loadingThumbnails && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-blue-700">Loading page thumbnails...</span>
            </div>
          )}

          {/* Split layout: thumbnails + options panel */}
          <div className="flex flex-col lg:flex-row lg:gap-6">
            {/* Left: Thumbnail grid */}
            <div className="flex-1 space-y-4 mb-6 lg:mb-0">
              {/* Controls bar */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={resetOrder}
                  disabled={isDefaultOrder}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Reset Order
                </button>
                {removedPages.length > 0 && (
                  <button
                    type="button"
                    onClick={resetOrder}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-colors"
                  >
                    Restore All
                  </button>
                )}
                <span className="text-[10px] text-slate-400 ml-auto">
                  {activePages.length} of {pageCount} pages selected
                </span>
              </div>

              {/* Active pages grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {activePages.map((pageIdx, posIdx) => (
                  <ActivePageThumb
                    key={`active-${pageIdx}-${posIdx}`}
                    pageIndex={pageIdx}
                    thumbnailUrl={thumbnails[pageIdx]}
                    dimensions={dimensions[pageIdx]}
                    isFirst={posIdx === 0}
                    isLast={posIdx === activePages.length - 1}
                    canMoveUp={posIdx >= GRID_COLS}
                    canMoveDown={posIdx + GRID_COLS <= activePages.length - 1}
                    canRemove={activePages.length > 1}
                    onMoveLeft={() => { if (posIdx > 0) movePage(posIdx, posIdx - 1); }}
                    onMoveRight={() => { if (posIdx < activePages.length - 1) movePage(posIdx, posIdx + 1); }}
                    onMoveUp={() => { if (posIdx >= GRID_COLS) movePage(posIdx, Math.max(0, posIdx - GRID_COLS)); }}
                    onMoveDown={() => { if (posIdx + GRID_COLS <= activePages.length - 1) movePage(posIdx, Math.min(activePages.length - 1, posIdx + GRID_COLS)); }}
                    onRemove={() => removePage(posIdx)}
                    onDragStart={onDragStartFactory(posIdx)}
                    onDragOver={onDragOverFactory()}
                    onDrop={onDropFactory(posIdx)}
                  />
                ))}
              </div>

              {/* Removed pages */}
              {removedPages.length > 0 && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-slate-500">Removed Pages</h3>
                    <span className="text-[10px] text-slate-400">
                      {removedPages.length} page{removedPages.length !== 1 ? "s" : ""}
                    </span>
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
            </div>

            {/* Right: Watermark Options Panel */}
            <div className="lg:w-80 lg:shrink-0 lg:sticky lg:top-4 lg:self-start">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-5">
                <h3 className="text-sm font-semibold text-slate-900">Watermark Options</h3>

                {/* Mode toggle */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setWatermarkMode("text")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      watermarkMode === "text"
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Place Text
                  </button>
                  <button
                    type="button"
                    onClick={() => setWatermarkMode("image")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      watermarkMode === "image"
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Place Image
                  </button>
                </div>

                {/* ─── Text Options ─────────────────────────────── */}
                {watermarkMode === "text" && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Text</label>
                      <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Enter watermark text"
                        className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Font Family</label>
                      <select
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
                        className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                      >
                        <option value="Helvetica">Helvetica</option>
                        <option value="Times-Roman">Times Roman</option>
                        <option value="Courier">Courier</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Font Size ({fontSize}pt)</label>
                      <input
                        type="range"
                        min={8}
                        max={120}
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="w-full accent-accent-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Style</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setBold(!bold)}
                          className={`px-3 py-1.5 text-sm font-bold rounded border transition-colors ${
                            bold ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          }`}>B</button>
                        <button type="button" onClick={() => setItalic(!italic)}
                          className={`px-3 py-1.5 text-sm italic rounded border transition-colors ${
                            italic ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          }`}>I</button>
                        <button type="button" onClick={() => setUnderline(!underline)}
                          className={`px-3 py-1.5 text-sm underline rounded border transition-colors ${
                            underline ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          }`}>U</button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Color</label>
                      <div className="flex items-center gap-1.5">
                        {COLOR_PRESETS.map((c) => (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => {
                              setFontColor({ r: c.r, g: c.g, b: c.b });
                              setColorHex(c.hex);
                            }}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${
                              colorHex === c.hex ? "border-slate-900 scale-110" : "border-slate-200 hover:border-slate-300"
                            }`}
                            style={{ backgroundColor: c.hex }}
                          />
                        ))}
                        <input
                          type="color"
                          value={colorHex}
                          onChange={(e) => {
                            setColorHex(e.target.value);
                            const rgb = hexToRgb(e.target.value);
                            if (rgb) setFontColor(rgb);
                          }}
                          className="w-6 h-6 rounded cursor-pointer border border-slate-200 p-0"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── Image Options ────────────────────────────── */}
                {watermarkMode === "image" && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Image</label>
                      {watermarkImagePreview ? (
                        <div className="relative">
                          <img
                            src={watermarkImagePreview}
                            alt="Watermark"
                            className="w-full h-24 object-contain bg-slate-50 rounded-lg border border-slate-200"
                          />
                          <button
                            type="button"
                            onClick={clearWatermarkImage}
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-slate-400 hover:text-red-500 transition-colors shadow-sm"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-1.5 p-4 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          <span className="text-xs text-slate-500">Choose image (PNG/JPG)</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            onChange={handleImageUpload}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>

                    {watermarkImage && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-700">
                          Scale ({Math.round(imageScale * 100)}% of page width)
                        </label>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={imageScale * 100}
                          onChange={(e) => setImageScale(Number(e.target.value) / 100)}
                          className="w-full accent-accent-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* ─── Shared Options ───────────────────────────── */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Opacity</label>
                    <select
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                    >
                      {OPACITY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Position</label>
                    <div className="flex items-start gap-3">
                      <PositionGrid value={position} onChange={setPosition} disabled={mosaic} />
                      <label className="flex items-center gap-2 cursor-pointer mt-2">
                        <input
                          type="checkbox"
                          checked={mosaic}
                          onChange={(e) => setMosaic(e.target.checked)}
                          className="rounded border-slate-300 text-accent-500 focus:ring-accent-500"
                        />
                        <span className="text-xs text-slate-600">Mosaic</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Rotation</label>
                    <select
                      value={rotation}
                      onChange={(e) => setRotation(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
                    >
                      {ROTATION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Layer</label>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setLayer("over")}
                        className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          layer === "over" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Over content
                      </button>
                      <button
                        type="button"
                        onClick={() => setLayer("below")}
                        className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                          layer === "below" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        Below content
                      </button>
                    </div>
                  </div>
                </div>

                {/* Add Watermark button */}
                <button
                  type="button"
                  onClick={handleProcess}
                  disabled={!canProcess}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  Add Watermark
                </button>

                {!canProcess && activePages.length > 0 && (
                  <p className="text-[10px] text-amber-600 text-center">
                    {watermarkMode === "text" ? "Enter watermark text to continue." : "Upload a watermark image to continue."}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Processing ──────────────────────────────────────────── */}
      {stage === "processing" && (
        <ProcessingView
          fileName={file?.name || "PDF"}
          progress={progress.progress}
          status={progress.stage}
        />
      )}

      {/* ─── Done ────────────────────────────────────────────────── */}
      {stage === "done" && result && (
        <>
          <DownloadView
            fileName={result.fileName}
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
              <span>{result.totalPages} page{result.totalPages !== 1 ? "s" : ""} watermarked</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{formatFileSize(result.originalSize)} &rarr; {formatFileSize(result.processedSize)}</span>
            </div>
          </div>

          {/* Data Quality badge */}
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-xs font-medium text-emerald-700">
                {layer === "over" ? "Lossless — original quality preserved" : "Watermark placed below content"}
              </span>
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
              {layer === "over"
                ? "Pages are copied losslessly using copyPages(). The watermark is drawn as an overlay — original content, fonts, images, and layout are fully preserved."
                : "For \"below content\" mode, the original page is embedded as a form overlay. The watermark is only visible in areas without content (e.g. margins, gaps)."}
            </p>
          </div>
        </>
      )}

      {/* ─── How it works ────────────────────────────────────────── */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload PDF",
              desc: "Select a PDF document to add a watermark to.",
            },
            {
              step: "2",
              title: "Configure Watermark",
              desc: "Choose text or image, set position, opacity, rotation, and layer.",
            },
            {
              step: "3",
              title: "Select Pages",
              desc: "Reorder, exclude, or restore pages as needed.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Download your watermarked PDF — original quality preserved.",
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
