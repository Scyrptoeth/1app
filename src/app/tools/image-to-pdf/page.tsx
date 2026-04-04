"use client";

import { useState, useCallback, useRef } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  convertImagesToPdf,
  loadImageDimensions,
  PAGE_SIZES,
  type ImageItem,
  type PageSize,
  type MarginOption,
  type ConvertOptions,
  type ProcessingUpdate,
  type ImageToPdfResult,
} from "@/lib/tools/image-to-pdf";

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

let nextId = 0;
function generateId(): string {
  return `img-${Date.now()}-${nextId++}`;
}

// ─── Image Thumbnail ──────────────────────────────────────────────

interface ImageThumbProps {
  item: ImageItem;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

function ImageThumb({
  item,
  index,
  isFirst,
  isLast,
  canMoveUp,
  canMoveDown,
  canRemove,
  onRotateLeft,
  onRotateRight,
  onRemove,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
}: ImageThumbProps) {
  const transform = getRotationTransform(item.rotation);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative rounded-lg border-2 border-slate-200 hover:border-slate-300 cursor-grab active:cursor-grabbing transition-all group"
    >
      {/* Page number badge — top left */}
      <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold">
        {index + 1}
      </div>

      {/* Remove button — top right */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
        aria-label="Remove image"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Thumbnail */}
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        <img
          src={item.thumbnailUrl}
          alt={item.file.name}
          className="w-full h-full object-contain transition-transform duration-200"
          style={{ transform: transform || undefined }}
        />

        {/* Arrow controls — center overlay (visible on hover) */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              disabled={!canMoveUp}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm"
              aria-label="Move up"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom bar: file info + rotation controls */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-slate-100">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-slate-600 truncate" title={item.file.name}>
            {item.file.name}
          </p>
          <p className="text-[9px] text-slate-400">
            {item.width} × {item.height}
            {item.rotation !== 0 && ` · ${item.rotation}°`}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRotateLeft(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Rotate left"
            title="Rotate left 90°"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRotateRight(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Rotate right"
            title="Rotate right 90°"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Removed Image Thumbnail ──────────────────────────────────────

interface RemovedImageThumbProps {
  item: ImageItem;
  onRestore: () => void;
}

function RemovedImageThumb({ item, onRestore }: RemovedImageThumbProps) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        <img
          src={item.thumbnailUrl}
          alt={item.file.name}
          className="w-full h-full object-contain"
        />

        {/* Restore button — center */}
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={onRestore}
            className="p-2 rounded-full bg-white/90 text-slate-400 hover:text-emerald-500 transition-all shadow-sm"
            aria-label="Restore image"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-500 truncate">
          {item.file.name}
        </p>
      </div>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────

interface SettingsPanelProps {
  globalOrientation: "portrait" | "landscape";
  pageSize: PageSize;
  margin: MarginOption;
  mergeAll: boolean;
  onOrientationChange: (v: "portrait" | "landscape") => void;
  onPageSizeChange: (v: PageSize) => void;
  onMarginChange: (v: MarginOption) => void;
  onMergeAllChange: (v: boolean) => void;
  onAddImages: () => void;
}

function SettingsPanel({
  globalOrientation,
  pageSize,
  margin,
  mergeAll,
  onOrientationChange,
  onPageSizeChange,
  onMarginChange,
  onMergeAllChange,
  onAddImages,
}: SettingsPanelProps) {
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-slate-900">Page Settings</h3>

      {/* Orientation */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Page Orientation</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOrientationChange("portrait")}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all ${
              globalOrientation === "portrait"
                ? "border-accent-400 bg-accent-50/50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <svg width="20" height="26" viewBox="0 0 20 26" fill="none" className={globalOrientation === "portrait" ? "text-accent-500" : "text-slate-400"}>
              <rect x="1" y="1" width="18" height="24" rx="2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className={`text-[11px] font-medium ${globalOrientation === "portrait" ? "text-accent-600" : "text-slate-500"}`}>
              Portrait
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOrientationChange("landscape")}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all ${
              globalOrientation === "landscape"
                ? "border-accent-400 bg-accent-50/50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <svg width="26" height="20" viewBox="0 0 26 20" fill="none" className={globalOrientation === "landscape" ? "text-accent-500" : "text-slate-400"}>
              <rect x="1" y="1" width="24" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <span className={`text-[11px] font-medium ${globalOrientation === "landscape" ? "text-accent-600" : "text-slate-500"}`}>
              Landscape
            </span>
          </button>
        </div>
      </div>

      {/* Page size */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Page Size</label>
        <select
          value={pageSize.name}
          onChange={(e) => {
            const found = PAGE_SIZES.find((s) => s.name === e.target.value);
            if (found) onPageSizeChange(found);
          }}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-100 transition-colors"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}{s.width > 0 ? ` (${s.width} × ${s.height} mm)` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Margin */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-2">Margin</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: "none" as MarginOption, label: "No margin", icon: "none" },
            { value: "small" as MarginOption, label: "Small", icon: "small" },
            { value: "big" as MarginOption, label: "Big", icon: "big" },
          ]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onMarginChange(opt.value)}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all ${
                margin === opt.value
                  ? "border-accent-400 bg-accent-50/50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={margin === opt.value ? "text-accent-500" : "text-slate-400"}>
                <rect x="2" y="2" width="20" height="20" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray={opt.value === "none" ? "0" : "2 2"} />
                {opt.value === "none" && (
                  <rect x="2" y="2" width="20" height="20" rx="1" fill="currentColor" fillOpacity="0.15" />
                )}
                {opt.value === "small" && (
                  <rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" fillOpacity="0.15" />
                )}
                {opt.value === "big" && (
                  <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" fillOpacity="0.15" />
                )}
              </svg>
              <span className={`text-[10px] font-medium ${margin === opt.value ? "text-accent-600" : "text-slate-500"}`}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Merge checkbox */}
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={mergeAll}
          onChange={(e) => onMergeAllChange(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-accent-500 focus:ring-accent-400"
        />
        <span className="text-xs text-slate-600">Merge all images in one PDF file</span>
      </label>

      {/* Add images button */}
      <button
        type="button"
        onClick={onAddImages}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-accent-600 bg-accent-50 hover:bg-accent-100 rounded-lg border border-accent-200 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add Images
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────

export default function ImageToPdfPage() {
  const tool = getToolById("image-to-pdf")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [globalOrientation, setGlobalOrientation] = useState<"portrait" | "landscape">("portrait");
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]); // A4
  const [margin, setMargin] = useState<MarginOption>("none");
  const [mergeAll, setMergeAll] = useState(true);
  const [progress, setProgress] = useState<ProcessingUpdate>({ stage: "", progress: 0 });
  const [result, setResult] = useState<ImageToPdfResult | null>(null);

  const dragIndexRef = useRef<number>(-1);
  const addInputRef = useRef<HTMLInputElement>(null);

  // ─── Computed ──────────────────────────────────────────────────

  const activeImages = images.filter((img) => !img.removed);
  const removedImages = images.filter((img) => img.removed);

  // ─── File handling ─────────────────────────────────────────────

  const processFiles = useCallback(async (files: File[]) => {
    const newItems: ImageItem[] = [];

    for (const file of files) {
      try {
        const dims = await loadImageDimensions(file);
        newItems.push({
          file,
          id: generateId(),
          thumbnailUrl: dims.thumbnailUrl,
          width: dims.width,
          height: dims.height,
          rotation: 0,
          removed: false,
          orientation: "auto",
        });
      } catch (err) {
        console.error("Failed to load image:", file.name, err);
      }
    }

    return newItems;
  }, []);

  const handleFileSelected = useCallback(async (files: File[]) => {
    const items = await processFiles(files);
    if (items.length === 0) {
      alert("No valid images could be loaded.");
      return;
    }
    setImages(items);
    setStage("configure");
  }, [processFiles]);

  const handleAddImages = useCallback(() => {
    addInputRef.current?.click();
  }, []);

  const handleAddFilesInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const validExts = [".jpg", ".jpeg", ".png"];
    const maxBytes = 50 * 1024 * 1024;
    const validFiles: File[] = [];

    for (const file of Array.from(e.target.files)) {
      const ext = "." + file.name.split(".").pop()?.toLowerCase();
      if (!validExts.includes(ext)) continue;
      if (file.size > maxBytes) continue;
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    const newItems = await processFiles(validFiles);
    setImages((prev) => [...prev, ...newItems]);

    // Reset input so same files can be re-selected
    e.target.value = "";
  }, [processFiles]);

  // ─── Reorder ───────────────────────────────────────────────────

  const moveImage = useCallback((fromIdx: number, toIdx: number) => {
    setImages((prev) => {
      // Work only with active images for position mapping
      const activeIds = prev.filter((img) => !img.removed).map((img) => img.id);
      const [movedId] = activeIds.splice(fromIdx, 1);
      activeIds.splice(toIdx, 0, movedId);

      // Rebuild: removed stay in place, active reordered
      const removed = prev.filter((img) => img.removed);
      const reordered = activeIds.map((id) => prev.find((img) => img.id === id)!);
      return [...reordered, ...removed];
    });
  }, []);

  // ─── Rotate ────────────────────────────────────────────────────

  const rotateImage = useCallback((id: string, delta: number) => {
    setImages((prev) =>
      prev.map((img) =>
        img.id === id
          ? { ...img, rotation: normalizeAngle(img.rotation + delta) }
          : img
      )
    );
  }, []);

  const rotateAll = useCallback((delta: number) => {
    setImages((prev) =>
      prev.map((img) =>
        img.removed ? img : { ...img, rotation: normalizeAngle(img.rotation + delta) }
      )
    );
  }, []);

  // ─── Remove & Restore ─────────────────────────────────────────

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const activeCount = prev.filter((img) => !img.removed).length;
      if (activeCount <= 1) return prev;
      return prev.map((img) => (img.id === id ? { ...img, removed: true } : img));
    });
  }, []);

  const restoreImage = useCallback((id: string) => {
    setImages((prev) =>
      prev.map((img) => (img.id === id ? { ...img, removed: false } : img))
    );
  }, []);

  // ─── Drag & drop ──────────────────────────────────────────────

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
      if (fromIdx >= 0 && fromIdx !== dropIdx) {
        moveImage(fromIdx, dropIdx);
      }
      dragIndexRef.current = -1;
    },
    [moveImage]
  );

  // ─── Reset ─────────────────────────────────────────────────────

  const resetAll = useCallback(() => {
    setImages((prev) => prev.map((img) => ({ ...img, removed: false, rotation: 0 })));
  }, []);

  // ─── Process & Download ────────────────────────────────────────

  const handleConvert = useCallback(async () => {
    if (activeImages.length === 0) return;
    setStage("processing");

    try {
      const options: ConvertOptions = {
        pageSize,
        globalOrientation,
        margin,
        mergeAll,
      };

      const convertResult = await convertImagesToPdf(
        // Pass active images in their current order
        activeImages,
        options,
        (update) => setProgress(update),
      );
      setResult(convertResult);
      setStage("done");
    } catch (err) {
      console.error("Conversion failed:", err);
      setStage("configure");
      alert("Failed to convert images to PDF. Please try again.");
    }
  }, [activeImages, pageSize, globalOrientation, margin, mergeAll]);

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
    // Revoke all thumbnail URLs
    images.forEach((img) => URL.revokeObjectURL(img.thumbnailUrl));

    setStage("upload");
    setImages([]);
    setGlobalOrientation("portrait");
    setPageSize(PAGE_SIZES[0]);
    setMargin("none");
    setMergeAll(true);
    setProgress({ stage: "", progress: 0 });
    setResult(null);
  }, [images]);

  // ─── Render ────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool}>
      {/* Hidden input for adding more images */}
      <input
        ref={addInputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={handleAddFilesInput}
        className="hidden"
      />

      {/* Upload */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={50}
          multiple
          onFilesSelected={handleFileSelected}
          title="Select images to convert to PDF"
          subtitle="Upload one or more images — drag & drop or click to select"
        />
      )}

      {/* Configure */}
      {stage === "configure" && (
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
            >
              Reset All
            </button>
            <button
              type="button"
              onClick={() => rotateAll(-90)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Rotate All Left
            </button>
            <button
              type="button"
              onClick={() => rotateAll(90)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-slate-100 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Rotate All Right
            </button>

            <span className="text-[10px] text-slate-400 ml-auto">
              {activeImages.length} image{activeImages.length !== 1 ? "s" : ""}
              {removedImages.length > 0 && ` · ${removedImages.length} removed`}
            </span>
          </div>

          {/* 2-column layout: thumbnails (left) + settings (right) */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Thumbnail grid */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {activeImages.map((item, posIdx) => (
                  <ImageThumb
                    key={item.id}
                    item={item}
                    index={posIdx}
                    isFirst={posIdx === 0}
                    isLast={posIdx === activeImages.length - 1}
                    canMoveUp={posIdx >= GRID_COLS}
                    canMoveDown={posIdx + GRID_COLS <= activeImages.length - 1}
                    canRemove={activeImages.length > 1}
                    onRotateLeft={() => rotateImage(item.id, -90)}
                    onRotateRight={() => rotateImage(item.id, 90)}
                    onRemove={() => removeImage(item.id)}
                    onMoveLeft={() => { if (posIdx > 0) moveImage(posIdx, posIdx - 1); }}
                    onMoveRight={() => { if (posIdx < activeImages.length - 1) moveImage(posIdx, posIdx + 1); }}
                    onMoveUp={() => { if (posIdx >= GRID_COLS) moveImage(posIdx, Math.max(0, posIdx - GRID_COLS)); }}
                    onMoveDown={() => { if (posIdx + GRID_COLS <= activeImages.length - 1) moveImage(posIdx, Math.min(activeImages.length - 1, posIdx + GRID_COLS)); }}
                    onDragStart={onDragStartFactory(posIdx)}
                    onDragOver={onDragOverFactory()}
                    onDrop={onDropFactory(posIdx)}
                  />
                ))}
              </div>
            </div>

            {/* Settings panel */}
            <div className="lg:w-64 shrink-0">
              <div className="sticky top-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <SettingsPanel
                  globalOrientation={globalOrientation}
                  pageSize={pageSize}
                  margin={margin}
                  mergeAll={mergeAll}
                  onOrientationChange={setGlobalOrientation}
                  onPageSizeChange={setPageSize}
                  onMarginChange={setMargin}
                  onMergeAllChange={setMergeAll}
                  onAddImages={handleAddImages}
                />
              </div>
            </div>
          </div>

          {/* Removed images section */}
          {removedImages.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-500">Removed Images</h3>
                <span className="text-[10px] text-slate-400">
                  {removedImages.length} image{removedImages.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {removedImages.map((item) => (
                  <RemovedImageThumb
                    key={item.id}
                    item={item}
                    onRestore={() => restoreImage(item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Summary + Convert button */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {activeImages.length} image{activeImages.length !== 1 ? "s" : ""} ready
                {removedImages.length > 0 && (
                  <span className="text-slate-400"> · {removedImages.length} removed</span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {pageSize.name} · {globalOrientation} · {margin === "none" ? "no margin" : margin + " margin"}
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
                onClick={handleConvert}
                disabled={activeImages.length === 0}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Convert to PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing */}
      {stage === "processing" && (
        <ProcessingView
          fileName="images"
          progress={progress.progress}
          status={progress.stage}
        />
      )}

      {/* Done */}
      {stage === "done" && result && (
        <>
          <DownloadView
            fileName={result.fileName}
            fileSize={formatFileSize(result.totalSize)}
            onDownload={handleDownload}
            onReset={handleReset}
          />

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{result.originalImageCount} image{result.originalImageCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{result.pageCount} page{result.pageCount !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-slate-300">|</div>
            <div className="flex items-center gap-1.5">
              <span>{formatFileSize(result.totalSize)}</span>
            </div>
          </div>

          {/* Data Quality badge */}
          <div className="mt-6 flex items-center justify-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-xs font-medium text-emerald-700">High Quality — Original resolution preserved</span>
            </div>
          </div>

          {/* Info Notice */}
          <div className="mt-4 mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Images are embedded at full resolution. Original quality preserved.
            </p>
          </div>
        </>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload Images",
              desc: "Select one or more JPG or PNG images to convert.",
            },
            {
              step: "2",
              title: "Configure",
              desc: "Set page size, orientation, and margins. Reorder, rotate, or remove images.",
            },
            {
              step: "3",
              title: "Convert",
              desc: "Images are embedded into a PDF at full resolution — 100% client-side.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Download your PDF — original image quality fully preserved.",
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
