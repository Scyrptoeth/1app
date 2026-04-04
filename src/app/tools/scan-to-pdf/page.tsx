"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  convertImagesToPdf,
  PAGE_SIZES,
  type PageSize,
  type ConvertOptions,
  type ProcessingUpdate,
  type ImageToPdfResult,
} from "@/lib/tools/image-to-pdf";
import {
  enhanceScannedImage,
  scanItemsToImageItems,
  type ScanItem,
} from "@/lib/tools/scan-to-pdf";

type Stage = "capture" | "configure" | "processing" | "done";
type InputMode = "camera" | "upload";

const MAX_CAPTURES = 100;
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

function computePageAspectRatio(
  pageSize: PageSize,
  orientation: "portrait" | "landscape",
  imgW: number,
  imgH: number,
  rotation: number,
): number {
  if (pageSize.name === "Fit to Image") {
    const rot = normalizeAngle(rotation);
    const effectiveW = rot === 90 || rot === 270 ? imgH : imgW;
    const effectiveH = rot === 90 || rot === 270 ? imgW : imgH;
    return effectiveW / effectiveH;
  }
  let w = pageSize.width;
  let h = pageSize.height;
  if (orientation === "landscape") [w, h] = [h, w];
  return w / h;
}

const CONTAINER_AR = 3 / 4;

function getPageMockStyle(pageAR: number): React.CSSProperties {
  if (pageAR >= CONTAINER_AR) {
    return { width: "100%", aspectRatio: String(pageAR) };
  }
  return { height: "100%", aspectRatio: String(pageAR) };
}

let nextId = 0;
function generateId(): string {
  return `scan-${Date.now()}-${nextId++}`;
}

// ─── Scan Thumbnail ──────────────────────────────────────────────

interface ScanThumbProps {
  item: ScanItem;
  index: number;
  pageAspectRatio: number;
  pageSizeLabel: string;
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

function ScanThumb({
  item,
  index,
  pageAspectRatio,
  pageSizeLabel,
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
}: ScanThumbProps) {
  const transform = getRotationTransform(item.rotation);
  const mockStyle = getPageMockStyle(pageAspectRatio);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative rounded-lg border-2 border-slate-200 hover:border-slate-300 cursor-grab active:cursor-grabbing transition-all group"
    >
      {/* Page number badge */}
      <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold">
        {index + 1}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
        aria-label="Remove scan"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Thumbnail page mock */}
      <div className="relative w-full aspect-[3/4] bg-slate-200/40 rounded-t-md overflow-hidden flex items-center justify-center p-2.5">
        <div
          className="relative bg-white shadow-md rounded-sm overflow-hidden flex items-center justify-center transition-all duration-200"
          style={mockStyle}
        >
          <img
            src={item.enhancedThumbnailUrl}
            alt={`Scan ${index + 1}`}
            className="max-w-full max-h-full object-contain transition-transform duration-200"
            style={{ transform: transform || undefined }}
          />
        </div>

        {/* Page size label */}
        <div className="absolute bottom-1.5 right-1.5 z-10 px-1.5 py-0.5 rounded bg-slate-700/60 text-white text-[8px] font-semibold tracking-wide">
          {pageSizeLabel}
        </div>

        {/* Arrow controls overlay */}
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

      {/* Bottom bar: info + rotation */}
      <div className="flex items-center justify-between px-2 py-1.5 border-t border-slate-100">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-slate-600 truncate">
            Scan {index + 1}
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

// ─── Removed Scan Thumbnail ──────────────────────────────────────

interface RemovedScanThumbProps {
  item: ScanItem;
  index: number;
  onRestore: () => void;
}

function RemovedScanThumb({ item, index, onRestore }: RemovedScanThumbProps) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        <img
          src={item.enhancedThumbnailUrl}
          alt={`Removed scan ${index + 1}`}
          className="w-full h-full object-contain"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={onRestore}
            className="p-2 rounded-full bg-white/90 text-slate-400 hover:text-emerald-500 transition-all shadow-sm"
            aria-label="Restore scan"
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
          Scan {index + 1}
        </p>
      </div>
    </div>
  );
}

// ─── Settings Panel ──────────────────────────────────────────────

interface SettingsPanelProps {
  globalOrientation: "portrait" | "landscape";
  pageSize: PageSize;
  mergeAll: boolean;
  onOrientationChange: (v: "portrait" | "landscape") => void;
  onPageSizeChange: (v: PageSize) => void;
  onMergeAllChange: (v: boolean) => void;
  onAddMore: () => void;
}

function SettingsPanel({
  globalOrientation,
  pageSize,
  mergeAll,
  onOrientationChange,
  onPageSizeChange,
  onMergeAllChange,
  onAddMore,
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

      {/* Merge checkbox */}
      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={mergeAll}
          onChange={(e) => onMergeAllChange(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-accent-500 focus:ring-accent-400"
        />
        <span className="text-xs text-slate-600">Merge all scans in one PDF file</span>
      </label>

      {/* Add more scans button */}
      <button
        type="button"
        onClick={onAddMore}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-accent-600 bg-accent-50 hover:bg-accent-100 rounded-lg border border-accent-200 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add More Scans
      </button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────

export default function ScanToPdfPage() {
  const tool = getToolById("scan-to-pdf")!;

  const [stage, setStage] = useState<Stage>("capture");
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [globalOrientation, setGlobalOrientation] = useState<"portrait" | "landscape">("portrait");
  const [pageSize, setPageSize] = useState<PageSize>(PAGE_SIZES[0]);
  const [mergeAll, setMergeAll] = useState(true);
  const [progress, setProgress] = useState<ProcessingUpdate>({ stage: "", progress: 0 });
  const [result, setResult] = useState<ImageToPdfResult | null>(null);
  const [enhancingCount, setEnhancingCount] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [viewfinderAspect, setViewfinderAspect] = useState("3/4");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dragIndexRef = useRef<number>(-1);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Computed ────────────────────────────────────────────────

  const activeScans = scans.filter((s) => !s.removed);
  const removedScans = scans.filter((s) => s.removed);

  // ─── Camera Management ───────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    stopCamera();
    setCameraError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera API not supported in this browser.");
        setInputMode("upload");
        return;
      }

      // Match constraints to device orientation so the stream is portrait when phone is upright
      const isPortrait = window.matchMedia("(orientation: portrait)").matches;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: isPortrait ? 2160 : 3840 },
          height: { ideal: isPortrait ? 3840 : 2160 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Set viewfinder aspect ratio to match the DISPLAYED orientation.
        // Camera sensors report intrinsic (landscape) dimensions via videoWidth/Height
        // even when the browser auto-rotates the rendered video to portrait.
        // Detect the mismatch and swap so the container matches what the user sees.
        const vw = videoRef.current.videoWidth;
        const vh = videoRef.current.videoHeight;
        if (vw && vh) {
          const streamIsLandscape = vw > vh;
          // Swap when device and stream orientations conflict:
          // portrait device + landscape stream → swap to portrait container
          // landscape device + portrait stream → swap to landscape container
          const needsSwap = isPortrait === streamIsLandscape;
          setViewfinderAspect(needsSwap ? `${vh}/${vw}` : `${vw}/${vh}`);
        }
      }

      setCameraReady(true);

      // Check for multiple cameras
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(videoDevices.length > 1);
    } catch {
      setCameraError("Camera access denied or unavailable.");
      setInputMode("upload");
    }
  }, [stopCamera]);

  // Init camera on mount / stage change to capture
  useEffect(() => {
    if (stage === "capture" && inputMode === "camera") {
      startCamera(facingMode);
    }

    return () => {
      if (stage !== "capture") {
        stopCamera();
      }
    };
  }, [stage, inputMode, facingMode, startCamera, stopCamera]);

  // Restart camera when device orientation changes (portrait ↔ landscape)
  useEffect(() => {
    if (stage !== "capture" || inputMode !== "camera") return;

    const mql = window.matchMedia("(orientation: portrait)");
    const handleOrientationChange = () => {
      startCamera(facingMode);
    };
    mql.addEventListener("change", handleOrientationChange);
    return () => mql.removeEventListener("change", handleOrientationChange);
  }, [stage, inputMode, facingMode, startCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [stopCamera]);

  // ─── Capture ─────────────────────────────────────────────────

  const captureFrame = useCallback(async () => {
    if (!videoRef.current || !streamRef.current) return;
    if (scans.length >= MAX_CAPTURES) return;

    // ─── Triple capture feedback ───
    // 1. Haptic vibration (Android; graceful no-op on iOS/desktop)
    navigator.vibrate?.(50);

    // 2. White flash on viewfinder
    setShowFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setShowFlash(false), 200);

    // 3. Toast notification
    setToastMessage("Picture taken!");
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 1500);

    const video = videoRef.current;
    const rawW = video.videoWidth;
    const rawH = video.videoHeight;

    // ─── WYSIWYG capture: crop to match viewfinder's object-cover ───
    // Camera sensors report landscape dimensions (e.g. 1920×1080) even when
    // the phone is portrait. The viewfinder displays a portrait crop via
    // CSS object-cover. We replicate that exact crop here so the captured
    // image matches what the user sees — portrait capture → portrait image.
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    const streamIsLandscape = rawW > rawH;
    const needsCrop = isPortrait === streamIsLandscape;

    let captureW: number;
    let captureH: number;
    let sx = 0;
    let sy = 0;

    if (needsCrop && streamIsLandscape) {
      // Portrait device + landscape stream → crop sides to portrait
      // Visible width = rawH × (rawH / rawW) — replicates object-cover math
      captureH = rawH;
      captureW = Math.round((rawH * rawH) / rawW);
      sx = Math.round((rawW - captureW) / 2);
    } else if (needsCrop && !streamIsLandscape) {
      // Landscape device + portrait stream → crop top/bottom to landscape
      captureW = rawW;
      captureH = Math.round((rawW * rawW) / rawH);
      sy = Math.round((rawH - captureH) / 2);
    } else {
      captureW = rawW;
      captureH = rawH;
    }

    const canvas = document.createElement("canvas");
    canvas.width = captureW;
    canvas.height = captureH;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, sx, sy, captureW, captureH, 0, 0, captureW, captureH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Capture failed"))),
        "image/png",
      );
    });

    const thumbnailUrl = URL.createObjectURL(blob);
    const id = generateId();

    const newScan: ScanItem = {
      id,
      blob,
      thumbnailUrl,
      enhancedBlob: blob,
      enhancedThumbnailUrl: thumbnailUrl,
      width: captureW,
      height: captureH,
      rotation: 0,
      removed: false,
      orientation: "auto",
    };

    setScans((prev) => [...prev, newScan]);

    // Enhance in background
    setEnhancingCount((c) => c + 1);
    try {
      const { enhancedBlob, enhancedUrl } = await enhanceScannedImage(blob);
      setScans((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, enhancedBlob: enhancedBlob, enhancedThumbnailUrl: enhancedUrl }
            : s,
        ),
      );
    } catch (err) {
      console.error("Enhancement failed for scan:", id, err);
    } finally {
      setEnhancingCount((c) => c - 1);
    }
  }, [scans.length]);

  const switchCamera = useCallback(() => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
  }, [facingMode]);

  // ─── File Upload Fallback ────────────────────────────────────

  const handleUploadFiles = useCallback(async (files: File[]) => {
    const newScans: ScanItem[] = [];

    for (const file of files) {
      if (scans.length + newScans.length >= MAX_CAPTURES) break;

      try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap;
        bitmap.close();

        const blob = file;
        const thumbnailUrl = URL.createObjectURL(blob);
        const id = generateId();

        newScans.push({
          id,
          blob,
          thumbnailUrl,
          enhancedBlob: blob,
          enhancedThumbnailUrl: thumbnailUrl,
          width,
          height,
          rotation: 0,
          removed: false,
          orientation: "auto",
        });
      } catch (err) {
        console.error("Failed to load image:", file.name, err);
      }
    }

    if (newScans.length === 0) return;

    setScans((prev) => [...prev, ...newScans]);

    // Enhance all in background
    for (const scan of newScans) {
      setEnhancingCount((c) => c + 1);
      enhanceScannedImage(scan.blob)
        .then(({ enhancedBlob, enhancedUrl }) => {
          setScans((prev) =>
            prev.map((s) =>
              s.id === scan.id
                ? { ...s, enhancedBlob, enhancedThumbnailUrl: enhancedUrl }
                : s,
            ),
          );
        })
        .catch((err) => console.error("Enhancement failed:", scan.id, err))
        .finally(() => setEnhancingCount((c) => c - 1));
    }

    // Go to configure after upload
    stopCamera();
    setStage("configure");
  }, [scans.length, stopCamera]);

  // ─── Reorder ─────────────────────────────────────────────────

  const moveScan = useCallback((fromIdx: number, toIdx: number) => {
    setScans((prev) => {
      const activeIds = prev.filter((s) => !s.removed).map((s) => s.id);
      const [movedId] = activeIds.splice(fromIdx, 1);
      activeIds.splice(toIdx, 0, movedId);

      const removed = prev.filter((s) => s.removed);
      const reordered = activeIds.map((id) => prev.find((s) => s.id === id)!);
      return [...reordered, ...removed];
    });
  }, []);

  // ─── Rotate ──────────────────────────────────────────────────

  const rotateScan = useCallback((id: string, delta: number) => {
    setScans((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, rotation: normalizeAngle(s.rotation + delta) } : s,
      ),
    );
  }, []);

  const rotateAll = useCallback((delta: number) => {
    setScans((prev) =>
      prev.map((s) =>
        s.removed ? s : { ...s, rotation: normalizeAngle(s.rotation + delta) },
      ),
    );
  }, []);

  // ─── Remove & Restore ───────────────────────────────────────

  const removeScan = useCallback((id: string) => {
    setScans((prev) => {
      const activeCount = prev.filter((s) => !s.removed).length;
      if (activeCount <= 1) return prev;
      return prev.map((s) => (s.id === id ? { ...s, removed: true } : s));
    });
  }, []);

  const restoreScan = useCallback((id: string) => {
    setScans((prev) =>
      prev.map((s) => (s.id === id ? { ...s, removed: false } : s)),
    );
  }, []);

  // ─── Drag & drop ────────────────────────────────────────────

  const onDragStartFactory = useCallback(
    (posIdx: number) => (e: React.DragEvent) => {
      dragIndexRef.current = posIdx;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(posIdx));
    },
    [],
  );

  const onDragOverFactory = useCallback(
    () => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    [],
  );

  const onDropFactory = useCallback(
    (dropIdx: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const fromIdx = dragIndexRef.current;
      if (fromIdx >= 0 && fromIdx !== dropIdx) {
        moveScan(fromIdx, dropIdx);
      }
      dragIndexRef.current = -1;
    },
    [moveScan],
  );

  // ─── Reset ──────────────────────────────────────────────────

  const resetAll = useCallback(() => {
    setScans((prev) => prev.map((s) => ({ ...s, removed: false, rotation: 0 })));
  }, []);

  // ─── Process & Download ─────────────────────────────────────

  const handleConvert = useCallback(async () => {
    if (activeScans.length === 0) return;
    setStage("processing");

    try {
      const imageItems = scanItemsToImageItems(activeScans);
      const options: ConvertOptions = {
        pageSize,
        globalOrientation,
        mergeAll,
      };

      const convertResult = await convertImagesToPdf(
        imageItems,
        options,
        (update) => setProgress(update),
      );

      // Override filename
      convertResult.fileName = mergeAll || activeScans.length === 1
        ? "scanned-documents.pdf"
        : "scanned-documents.zip";

      setResult(convertResult);
      setStage("done");
    } catch (err) {
      console.error("Conversion failed:", err);
      setStage("configure");
      alert("Failed to convert scans to PDF. Please try again.");
    }
  }, [activeScans, pageSize, globalOrientation, mergeAll]);

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

  const handleFullReset = useCallback(() => {
    stopCamera();
    scans.forEach((s) => {
      URL.revokeObjectURL(s.thumbnailUrl);
      if (s.enhancedThumbnailUrl !== s.thumbnailUrl) {
        URL.revokeObjectURL(s.enhancedThumbnailUrl);
      }
    });

    setStage("capture");
    setScans([]);
    setInputMode("camera");
    setPreviewIndex(null);
    setGlobalOrientation("portrait");
    setPageSize(PAGE_SIZES[0]);
    setMergeAll(true);
    setProgress({ stage: "", progress: 0 });
    setResult(null);
  }, [scans, stopCamera]);

  // ─── Render ─────────────────────────────────────────────────

  return (
    <ToolPageLayout
      tool={tool}
      privacyMessage="Photos are processed locally — nothing is uploaded"
    >
      {/* ───── Stage: Capture ───── */}
      {stage === "capture" && (
        <div className="w-full max-w-2xl mx-auto space-y-4">
          {/* Mode toggle */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => {
                if (inputMode === "camera") {
                  stopCamera();
                  setInputMode("upload");
                } else {
                  setInputMode("camera");
                }
              }}
              className="text-xs font-medium text-accent-600 hover:text-accent-700 transition-colors"
            >
              {inputMode === "camera" ? "Switch to file upload" : "Switch to camera"}
            </button>
          </div>

          {inputMode === "camera" && !cameraError ? (
            (() => {
              // Clamp previewIndex to valid range after removals
              const clampedIdx = previewIndex !== null
                ? Math.min(previewIndex, activeScans.length - 1)
                : null;
              const previewScan = clampedIdx !== null && clampedIdx >= 0
                ? activeScans[clampedIdx]
                : null;
              const isPreview = previewScan !== null;

              return (
                <>
                  {/* Camera viewfinder / Image preview */}
                  <div
                    className={`relative rounded-2xl overflow-hidden ${isPreview ? "bg-slate-900" : "bg-black"}`}
                    style={{ aspectRatio: viewfinderAspect }}
                  >
                    {/* Video — hidden during preview */}
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={`w-full h-full object-cover ${isPreview ? "hidden" : ""}`}
                    />

                    {/* Image preview */}
                    {isPreview && (
                      <>
                        <div className="absolute inset-0 flex items-center justify-center p-3">
                          <img
                            src={previewScan.enhancedThumbnailUrl}
                            alt={`Scan ${clampedIdx! + 1}`}
                            className="max-w-full max-h-full object-contain transition-transform duration-200"
                            style={{ transform: getRotationTransform(previewScan.rotation) || undefined }}
                          />
                        </div>

                        {/* Preview counter */}
                        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium">
                          {clampedIdx! + 1} / {activeScans.length}
                        </div>

                        {/* Close preview */}
                        <button
                          type="button"
                          onClick={() => setPreviewIndex(null)}
                          className="absolute top-3 right-3 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                          aria-label="Close preview"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>

                        {/* Dimensions info */}
                        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-[10px] font-medium">
                          {previewScan.width} × {previewScan.height}
                          {previewScan.rotation !== 0 && ` · ${previewScan.rotation}°`}
                        </div>
                      </>
                    )}

                    {/* Camera overlays — only when camera active */}
                    {!isPreview && (
                      <>
                        {!cameraReady && (
                          <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                            <div className="text-center">
                              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3" />
                              <p className="text-sm text-white/70">Starting camera...</p>
                            </div>
                          </div>
                        )}

                        {/* Capture count */}
                        <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium">
                          {activeScans.length}/{MAX_CAPTURES} captures
                        </div>

                        {/* Switch camera */}
                        {hasMultipleCameras && (
                          <button
                            type="button"
                            onClick={switchCamera}
                            className="absolute top-3 right-3 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                            aria-label="Switch camera"
                          >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
                              <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
                              <polyline points="16 3 19 6 16 9" />
                              <polyline points="8 21 5 18 8 15" />
                            </svg>
                          </button>
                        )}

                        {/* Enhancing indicator */}
                        {enhancingCount > 0 && (
                          <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-amber-500/80 backdrop-blur-sm text-white text-xs font-medium animate-pulse">
                            Enhancing {enhancingCount}...
                          </div>
                        )}
                      </>
                    )}

                    {/* Capture flash effect */}
                    <div
                      className={`absolute inset-0 bg-white z-30 pointer-events-none transition-opacity duration-200 ${
                        showFlash ? "opacity-70" : "opacity-0"
                      }`}
                    />

                    {/* Toast notification */}
                    <div
                      className={`absolute top-12 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-full bg-black/70 backdrop-blur-sm text-white text-sm font-medium pointer-events-none transition-all duration-300 ${
                        toastMessage
                          ? "opacity-100 translate-y-0"
                          : "opacity-0 -translate-y-2"
                      }`}
                    >
                      {toastMessage || ""}
                    </div>
                  </div>

                  {/* Capture button — only when camera active */}
                  {!isPreview && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={captureFrame}
                        disabled={!cameraReady || activeScans.length + removedScans.length >= MAX_CAPTURES}
                        className="w-16 h-16 rounded-full bg-white border-4 border-slate-300 hover:border-accent-400 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg flex items-center justify-center"
                        aria-label="Take picture"
                      >
                        <div className="w-12 h-12 rounded-full bg-accent-500 hover:bg-accent-600 transition-colors" />
                      </button>
                    </div>
                  )}

                  {/* Preview controls — rotate + delete */}
                  {isPreview && (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(null)}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        Back to Camera
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateScan(previewScan.id, -90)}
                        className="p-2 text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-700 transition-colors"
                        aria-label="Rotate left"
                        title="Rotate left 90°"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 4v6h6" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => rotateScan(previewScan.id, 90)}
                        className="p-2 text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-700 transition-colors"
                        aria-label="Rotate right"
                        title="Rotate right 90°"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 4v6h-6" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeScans.length <= 1) return;
                          removeScan(previewScan.id);
                          // If removed the last visible item, clamp
                          if (clampedIdx! >= activeScans.length - 1) {
                            setPreviewIndex(Math.max(0, activeScans.length - 2));
                          }
                        }}
                        disabled={activeScans.length <= 1}
                        className="p-2 text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:text-red-500 hover:border-red-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        aria-label="Delete scan"
                        title="Delete"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Thumbnail strip — active scans */}
                  {activeScans.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
                      {activeScans.map((scan, i) => (
                        <div
                          key={scan.id}
                          onClick={() => setPreviewIndex(i)}
                          className={`relative shrink-0 w-16 h-20 rounded-md overflow-hidden cursor-pointer transition-all ${
                            isPreview && clampedIdx === i
                              ? "border-2 border-accent-500 ring-2 ring-accent-200"
                              : "border border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <img
                            src={scan.enhancedThumbnailUrl}
                            alt={`Scan ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded bg-black/50 text-white text-[8px] font-bold">
                            {i + 1}
                          </div>
                          {/* Remove button on thumbnail */}
                          {activeScans.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeScan(scan.id);
                                if (isPreview && clampedIdx !== null && clampedIdx >= activeScans.length - 1) {
                                  setPreviewIndex(Math.max(0, activeScans.length - 2));
                                }
                              }}
                              className="absolute top-0.5 left-0.5 p-0.5 rounded-full bg-black/50 text-white/80 hover:bg-red-500 hover:text-white transition-colors"
                              aria-label="Remove scan"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Removed scans — restore strip */}
                  {removedScans.length > 0 && (
                    <div>
                      <p className="text-[10px] text-slate-400 mb-1.5">
                        Removed · {removedScans.length} scan{removedScans.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex gap-2 overflow-x-auto pb-2 -mx-2 px-2">
                        {removedScans.map((scan, i) => (
                          <div
                            key={scan.id}
                            className="relative shrink-0 w-14 h-18 rounded-md overflow-hidden border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all"
                          >
                            <img
                              src={scan.enhancedThumbnailUrl}
                              alt={`Removed scan ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                            {/* Restore button */}
                            <button
                              type="button"
                              onClick={() => restoreScan(scan.id)}
                              className="absolute inset-0 flex items-center justify-center bg-black/20"
                              aria-label="Restore scan"
                            >
                              <div className="p-1 rounded-full bg-white/90 text-emerald-500">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                  <line x1="12" y1="5" x2="12" y2="19" />
                                  <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                              </div>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Continue button */}
                  {activeScans.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        setPreviewIndex(null);
                        setStage("configure");
                      }}
                      className="w-full py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors"
                    >
                      Continue to Edit ({activeScans.length} scan{activeScans.length !== 1 ? "s" : ""})
                    </button>
                  )}
                </>
              );
            })()
          ) : (
            /* File upload fallback */
            <FileUploader
              acceptedFormats={[".jpg", ".jpeg", ".png"]}
              maxSizeMB={50}
              multiple
              onFilesSelected={handleUploadFiles}
              title={cameraError ? "Camera not available — upload images instead" : "Upload images to scan"}
              subtitle="Select photos from your device to create a PDF"
            />
          )}
        </div>
      )}

      {/* ───── Stage: Configure ───── */}
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
              {activeScans.length} scan{activeScans.length !== 1 ? "s" : ""}
              {removedScans.length > 0 && ` · ${removedScans.length} removed`}
            </span>
          </div>

          {/* 2-column layout: thumbnails + settings */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Thumbnail grid */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {activeScans.map((item, posIdx) => {
                  const effectiveOrientation = item.orientation !== "auto" ? item.orientation : globalOrientation;
                  const pageAR = computePageAspectRatio(pageSize, effectiveOrientation, item.width, item.height, item.rotation);
                  const label = pageSize.name === "Fit to Image" ? "Fit" : pageSize.name;
                  return (
                    <ScanThumb
                      key={item.id}
                      item={item}
                      index={posIdx}
                      pageAspectRatio={pageAR}
                      pageSizeLabel={`${label} · ${effectiveOrientation === "landscape" ? "L" : "P"}`}
                      isFirst={posIdx === 0}
                      isLast={posIdx === activeScans.length - 1}
                      canMoveUp={posIdx >= GRID_COLS}
                      canMoveDown={posIdx + GRID_COLS <= activeScans.length - 1}
                      canRemove={activeScans.length > 1}
                      onRotateLeft={() => rotateScan(item.id, -90)}
                      onRotateRight={() => rotateScan(item.id, 90)}
                      onRemove={() => removeScan(item.id)}
                      onMoveLeft={() => { if (posIdx > 0) moveScan(posIdx, posIdx - 1); }}
                      onMoveRight={() => { if (posIdx < activeScans.length - 1) moveScan(posIdx, posIdx + 1); }}
                      onMoveUp={() => { if (posIdx >= GRID_COLS) moveScan(posIdx, Math.max(0, posIdx - GRID_COLS)); }}
                      onMoveDown={() => { if (posIdx + GRID_COLS <= activeScans.length - 1) moveScan(posIdx, Math.min(activeScans.length - 1, posIdx + GRID_COLS)); }}
                      onDragStart={onDragStartFactory(posIdx)}
                      onDragOver={onDragOverFactory()}
                      onDrop={onDropFactory(posIdx)}
                    />
                  );
                })}
              </div>
            </div>

            {/* Settings panel */}
            <div className="lg:w-64 shrink-0">
              <div className="sticky top-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <SettingsPanel
                  globalOrientation={globalOrientation}
                  pageSize={pageSize}
                  mergeAll={mergeAll}
                  onOrientationChange={setGlobalOrientation}
                  onPageSizeChange={setPageSize}
                  onMergeAllChange={setMergeAll}
                  onAddMore={() => setStage("capture")}
                />
              </div>
            </div>
          </div>

          {/* Removed scans section */}
          {removedScans.length > 0 && (
            <div className="pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-500">Removed Scans</h3>
                <span className="text-[10px] text-slate-400">
                  {removedScans.length} scan{removedScans.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {removedScans.map((item, i) => (
                  <RemovedScanThumb
                    key={item.id}
                    item={item}
                    index={i}
                    onRestore={() => restoreScan(item.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Summary + Convert button */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-500">
                {activeScans.length} scan{activeScans.length !== 1 ? "s" : ""} ready
                {removedScans.length > 0 && (
                  <span className="text-slate-400"> · {removedScans.length} removed</span>
                )}
              </div>
              <div className="text-xs text-slate-400">
                {pageSize.name} · {globalOrientation}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleFullReset}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConvert}
                disabled={activeScans.length === 0}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Convert to PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Stage: Processing ───── */}
      {stage === "processing" && (
        <ProcessingView
          fileName="scanned-documents"
          progress={progress.progress}
          status={progress.stage}
        />
      )}

      {/* ───── Stage: Done ───── */}
      {stage === "done" && result && (
        <>
          <div className="w-full max-w-lg mx-auto text-center">
            {/* Success icon */}
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1">Conversion complete!</h3>
            <p className="text-sm text-slate-500 mb-6">Your PDF is ready to download.</p>

            {/* File info card */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{result.fileName}</p>
                <p className="text-xs text-slate-500">{formatFileSize(result.totalSize)}</p>
              </div>
            </div>

            {/* 3 action buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
              <button
                onClick={() => setStage("configure")}
                className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Back to Edit
              </button>
              <button
                onClick={handleFullReset}
                className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Process Another
              </button>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>{result.originalImageCount} scan{result.originalImageCount !== 1 ? "s" : ""}</span>
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
              <span className="text-xs font-medium text-emerald-700">High Quality — Enhanced scan with original resolution</span>
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
              Scanned images are auto-enhanced and embedded at full resolution.
            </p>
          </div>
        </>
      )}

      {/* ───── How it works ───── */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Scan",
              desc: "Use your camera to capture document pages.",
            },
            {
              step: "2",
              title: "Enhance",
              desc: "Images are automatically enhanced for optimal quality.",
            },
            {
              step: "3",
              title: "Configure",
              desc: "Reorder, rotate, or remove pages. Set page size and orientation.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Download your PDF — enhanced quality preserved.",
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
