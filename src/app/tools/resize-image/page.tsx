"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Wand2,
  Download,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Check,
  Crop,
  Upload,
  X,
  ImagePlus,
  RotateCcw as ResetIcon,
} from "lucide-react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import CropEditor from "@/components/CropEditor";
import { getToolById } from "@/config/tools";
import {
  PHOTO_PRESETS,
  PRINT_DPI,
  resizeImage,
  type PhotoPreset,
  type CropRect,
  type ResizeImageResult,
} from "@/lib/tools/resize-image";
import {
  removeImageBackground,
  addColorBackground,
  addImageBackground,
  type BgPosition,
} from "@/lib/tools/remove-and-change-background";
import { rotateImage } from "@/lib/tools/rotate-image";
import { cropImage, type CropArea } from "@/lib/tools/crop-image";

const tool = getToolById("resize-image")!;

type Stage = "upload" | "editor" | "crop" | "processing" | "done";

const BG_COLORS = [
  { color: "#DC2626", label: "Red" },
  { color: "#1D4ED8", label: "Blue" },
  { color: "#FFFFFF", label: "White" },
  { color: "#60A5FA", label: "Light Blue" },
  { color: "#9CA3AF", label: "Gray" },
  { color: "#15803D", label: "Green" },
];

const POSITION_GRID: { pos: BgPosition; label: string }[] = [
  { pos: "top-left", label: "TL" },
  { pos: "top-center", label: "TC" },
  { pos: "top-right", label: "TR" },
  { pos: "center-left", label: "CL" },
  { pos: "center", label: "C" },
  { pos: "center-right", label: "CR" },
  { pos: "bottom-left", label: "BL" },
  { pos: "bottom-center", label: "BC" },
  { pos: "bottom-right", label: "BR" },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export default function ResizeImagePage() {
  // ──── Stage ────
  const [stage, setStage] = useState<Stage>("upload");

  // ──── Working image (current state after all transforms) ────
  const [imageUrl, setImageUrl] = useState("");
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  // ──── Preset selection ────
  const [selectedPreset, setSelectedPreset] = useState<PhotoPreset>(
    PHOTO_PRESETS[1]
  );

  // ──── Viewport crop (pan + zoom) ────
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0); // image-pixel offset from center
  const [offsetY, setOffsetY] = useState(0);

  // ──── Background removal ────
  const [bgRemoved, setBgRemoved] = useState(false);
  const [bgRemoving, setBgRemoving] = useState(false);
  const [bgProgress, setBgProgress] = useState({ stage: "", progress: 0 });
  const [foregroundBlob, setForegroundBlob] = useState<Blob | null>(null);
  const [preBgImage, setPreBgImage] = useState<{
    blob: Blob;
    url: string;
    dims: { width: number; height: number };
  } | null>(null);
  const [bgColor, setBgColor] = useState("#DC2626");
  const [showBgPanel, setShowBgPanel] = useState(false);

  // ──── Background image mode ────
  const [bgMode, setBgMode] = useState<"color" | "image">("color");
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgScale, setBgScale] = useState(100);
  const [bgPosition, setBgPosition] = useState<BgPosition>("center");
  const [compositing, setCompositing] = useState(false);

  // ──── Rotate state ────
  const [rotating, setRotating] = useState(false);

  // ──── Crop sub-feature ────
  const [cropLoading, setCropLoading] = useState(false);

  // ──── Processing & result ────
  const [progress, setProgress] = useState({ stage: "", progress: 0 });
  const [result, setResult] = useState<ResizeImageResult | null>(null);

  // ──── Drag ref ────
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  // ══════════════════════════════════════════════════════════
  //  COMPUTED VALUES
  // ══════════════════════════════════════════════════════════

  const presetAR = selectedPreset.widthPx / selectedPreset.heightPx;
  const imageAR =
    imageDims.width > 0 ? imageDims.width / imageDims.height : 1;

  // Frame display size (px on screen)
  const FRAME_MAX_H = 380;
  const FRAME_MAX_W = 460;
  let frameH = FRAME_MAX_H;
  let frameW = Math.round(frameH * presetAR);
  if (frameW > FRAME_MAX_W) {
    frameW = FRAME_MAX_W;
    frameH = Math.round(frameW / presetAR);
  }

  // Cover-fit base scale
  const baseScale = useMemo(() => {
    if (imageDims.width === 0) return 1;
    return imageAR > presetAR
      ? frameH / imageDims.height
      : frameW / imageDims.width;
  }, [imageDims.width, imageDims.height, frameW, frameH, imageAR, presetAR]);

  const scale = baseScale * zoom;
  const imgDisplayW = imageDims.width * scale;
  const imgDisplayH = imageDims.height * scale;
  const imgLeft = (frameW - imgDisplayW) / 2 - offsetX * scale;
  const imgTop = (frameH - imgDisplayH) / 2 - offsetY * scale;

  // Max pan offsets (image pixels)
  const maxOffset = useMemo(() => {
    if (imageDims.width === 0) return { x: 0, y: 0 };
    let baseW: number, baseH: number;
    if (imageAR > presetAR) {
      baseH = imageDims.height;
      baseW = imageDims.height * presetAR;
    } else {
      baseW = imageDims.width;
      baseH = imageDims.width / presetAR;
    }
    const cropW = baseW / zoom;
    const cropH = baseH / zoom;
    return {
      x: Math.max(0, (imageDims.width - cropW) / 2),
      y: Math.max(0, (imageDims.height - cropH) / 2),
    };
  }, [imageDims, imageAR, presetAR, zoom]);

  // Low resolution warning
  const isLowRes =
    imageDims.width > 0 &&
    (imageDims.width < selectedPreset.widthPx ||
      imageDims.height < selectedPreset.heightPx);

  // ══════════════════════════════════════════════════════════
  //  CROP RECT COMPUTATION
  // ══════════════════════════════════════════════════════════

  function getCropRect(): CropRect {
    let baseW: number, baseH: number;
    if (imageAR > presetAR) {
      baseH = imageDims.height;
      baseW = imageDims.height * presetAR;
    } else {
      baseW = imageDims.width;
      baseH = imageDims.width / presetAR;
    }
    const cropW = baseW / zoom;
    const cropH = baseH / zoom;
    const cropX = (imageDims.width - cropW) / 2 + offsetX;
    const cropY = (imageDims.height - cropH) / 2 + offsetY;
    return {
      x: clamp(cropX, 0, imageDims.width - cropW),
      y: clamp(cropY, 0, imageDims.height - cropH),
      width: cropW,
      height: cropH,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════════════

  function resetViewport() {
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
  }

  function updateWorkingImage(
    blob: Blob,
    url: string,
    width: number,
    height: number
  ) {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageBlob(blob);
    setImageUrl(url);
    setImageDims({ width, height });
  }

  function toFile(blob: Blob, name = "image.png"): File {
    return new File([blob], name, { type: blob.type || "image/png" });
  }

  // ══════════════════════════════════════════════════════════
  //  FILE UPLOAD
  // ══════════════════════════════════════════════════════════

  function handleFileSelected(files: File[]) {
    const f = files[0];
    if (!f) return;
    resetAll();
    setOriginalFile(f);
    setImageBlob(f);

    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      setImageUrl(url);
      resetViewport();
      setStage("editor");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // ══════════════════════════════════════════════════════════
  //  PRESET CHANGE
  // ══════════════════════════════════════════════════════════

  function handlePresetChange(preset: PhotoPreset) {
    setSelectedPreset(preset);
    resetViewport();
  }

  // ══════════════════════════════════════════════════════════
  //  PAN / ZOOM
  // ══════════════════════════════════════════════════════════

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: offsetX,
      startOffsetY: offsetY,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    // Dragging image right → offset decreases (crop moves left)
    const newX = dragRef.current.startOffsetX - dx / scale;
    const newY = dragRef.current.startOffsetY - dy / scale;
    setOffsetX(clamp(newX, -maxOffset.x, maxOffset.x));
    setOffsetY(clamp(newY, -maxOffset.y, maxOffset.y));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  function handleZoomChange(newZoom: number) {
    const z = clamp(newZoom, 1, 5);
    setZoom(z);
    // Re-constrain offset for new zoom (computed in next render via maxOffset)
  }

  // Constrain offset when zoom changes
  useEffect(() => {
    setOffsetX((prev) => clamp(prev, -maxOffset.x, maxOffset.x));
    setOffsetY((prev) => clamp(prev, -maxOffset.y, maxOffset.y));
  }, [maxOffset]);

  // ══════════════════════════════════════════════════════════
  //  ROTATE / FLIP (bake immediately)
  // ══════════════════════════════════════════════════════════

  async function applyTransform(opts: {
    rotation: 0 | 90 | 180 | 270;
    flipHorizontal: boolean;
    flipVertical: boolean;
  }) {
    if (!imageBlob || rotating) return;
    setRotating(true);
    try {
      const res = await rotateImage(toFile(imageBlob), opts);
      updateWorkingImage(res.blob, res.previewUrl, res.width, res.height);

      if (foregroundBlob) {
        const fgRes = await rotateImage(toFile(foregroundBlob, "fg.png"), opts);
        setForegroundBlob(fgRes.blob);
      }
      resetViewport();
    } finally {
      setRotating(false);
    }
  }

  const handleRotateCW = () =>
    applyTransform({
      rotation: 90,
      flipHorizontal: false,
      flipVertical: false,
    });
  const handleRotateCCW = () =>
    applyTransform({
      rotation: 270,
      flipHorizontal: false,
      flipVertical: false,
    });
  const handleFlipH = () =>
    applyTransform({
      rotation: 0,
      flipHorizontal: true,
      flipVertical: false,
    });
  const handleFlipV = () =>
    applyTransform({
      rotation: 0,
      flipHorizontal: false,
      flipVertical: true,
    });

  // ══════════════════════════════════════════════════════════
  //  BACKGROUND REMOVAL
  // ══════════════════════════════════════════════════════════

  async function handleRemoveBg() {
    if (!imageBlob || bgRemoving) return;
    setBgRemoving(true);
    setShowBgPanel(true);
    try {
      // Save pre-BG state for reset
      setPreBgImage({
        blob: imageBlob,
        url: imageUrl,
        dims: { ...imageDims },
      });

      const f = toFile(imageBlob, originalFile?.name || "image.png");
      const res = await removeImageBackground(f, (u) => setBgProgress(u));
      setForegroundBlob(res.blob);
      setBgRemoved(true);

      // Default: apply red background
      const comp = await addColorBackground(
        res.blob,
        bgColor,
        res.width,
        res.height
      );
      updateWorkingImage(comp.blob, comp.previewUrl, res.width, res.height);
      setBgMode("color");
    } finally {
      setBgRemoving(false);
    }
  }

  async function handleBgColorSelect(color: string) {
    if (!foregroundBlob) return;
    setBgColor(color);
    setBgMode("color");
    setCompositing(true);
    try {
      const comp = await addColorBackground(
        foregroundBlob,
        color,
        imageDims.width,
        imageDims.height
      );
      updateWorkingImage(
        comp.blob,
        comp.previewUrl,
        imageDims.width,
        imageDims.height
      );
    } finally {
      setCompositing(false);
    }
  }

  async function handleBgImageSelected(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file || !foregroundBlob) return;
    setBgImageFile(file);
    setBgMode("image");
    setBgScale(100);
    setBgPosition("center");
    setCompositing(true);
    try {
      const comp = await addImageBackground(
        foregroundBlob,
        file,
        imageDims.width,
        imageDims.height,
        { scale: 100, position: "center" }
      );
      updateWorkingImage(
        comp.blob,
        comp.previewUrl,
        imageDims.width,
        imageDims.height
      );
    } finally {
      setCompositing(false);
    }
  }

  // Debounced re-composite for scale/position changes
  const compositeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (bgMode !== "image" || !foregroundBlob || !bgImageFile) return;
    if (compositeTimerRef.current) clearTimeout(compositeTimerRef.current);
    compositeTimerRef.current = setTimeout(async () => {
      setCompositing(true);
      try {
        const comp = await addImageBackground(
          foregroundBlob,
          bgImageFile,
          imageDims.width,
          imageDims.height,
          { scale: bgScale, position: bgPosition }
        );
        updateWorkingImage(
          comp.blob,
          comp.previewUrl,
          imageDims.width,
          imageDims.height
        );
      } finally {
        setCompositing(false);
      }
    }, 150);
    return () => {
      if (compositeTimerRef.current) clearTimeout(compositeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgScale, bgPosition]);

  function handleResetBg() {
    if (!preBgImage) return;
    updateWorkingImage(
      preBgImage.blob,
      preBgImage.url,
      preBgImage.dims.width,
      preBgImage.dims.height
    );
    setBgRemoved(false);
    setForegroundBlob(null);
    setPreBgImage(null);
    setBgImageFile(null);
    setBgMode("color");
    resetViewport();
  }

  // ══════════════════════════════════════════════════════════
  //  CROP SUB-FEATURE (CropEditor)
  // ══════════════════════════════════════════════════════════

  async function handleCropApply(
    cropArea: CropArea,
    rotation: 0 | 90 | 180 | 270
  ) {
    if (!imageBlob) return;
    setCropLoading(true);
    try {
      const res = await cropImage(toFile(imageBlob), { cropArea, rotation });
      updateWorkingImage(
        res.blob,
        res.previewUrl,
        res.croppedWidth,
        res.croppedHeight
      );

      if (foregroundBlob) {
        const fgRes = await cropImage(toFile(foregroundBlob, "fg.png"), {
          cropArea,
          rotation,
        });
        setForegroundBlob(fgRes.blob);
      }

      resetViewport();
      setStage("editor");
    } finally {
      setCropLoading(false);
    }
  }

  function handleCropCancel() {
    setStage("editor");
  }

  // ══════════════════════════════════════════════════════════
  //  PROCESS
  // ══════════════════════════════════════════════════════════

  async function handleProcess() {
    if (!imageBlob) return;
    setStage("processing");
    try {
      const cropRect = getCropRect();
      const res = await resizeImage(imageBlob, selectedPreset, cropRect, (u) =>
        setProgress(u)
      );
      setResult(res);
      setStage("done");
    } catch (err) {
      console.error("Resize failed:", err);
      setStage("editor");
    }
  }

  // ══════════════════════════════════════════════════════════
  //  DOWNLOAD / RESET
  // ══════════════════════════════════════════════════════════

  function handleDownload() {
    if (!result) return;
    const ext = "jpg";
    const baseName = originalFile?.name.replace(/\.[^.]+$/, "") || "photo";
    const fileName = `${baseName}_${selectedPreset.id}_${result.resizedWidth}x${result.resizedHeight}.${ext}`;
    const a = document.createElement("a");
    a.href = result.previewUrl;
    a.download = fileName;
    a.click();
  }

  function handleBackToEdit() {
    setResult(null);
    setStage("editor");
  }

  function resetAll() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    setImageUrl("");
    setImageBlob(null);
    setImageDims({ width: 0, height: 0 });
    setOriginalFile(null);
    setSelectedPreset(PHOTO_PRESETS[1]);
    resetViewport();
    setBgRemoved(false);
    setBgRemoving(false);
    setForegroundBlob(null);
    setPreBgImage(null);
    setBgColor("#DC2626");
    setShowBgPanel(false);
    setBgMode("color");
    setBgImageFile(null);
    setBgScale(100);
    setBgPosition("center");
    setRotating(false);
    setCropLoading(false);
    setResult(null);
    setProgress({ stage: "", progress: 0 });
  }

  function handleResetToOriginal() {
    if (!originalFile) return;
    // Reset all edits but keep original file loaded
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setBgRemoved(false);
    setBgRemoving(false);
    setForegroundBlob(null);
    setPreBgImage(null);
    setBgColor("#DC2626");
    setShowBgPanel(false);
    setBgMode("color");
    setBgImageFile(null);
    setBgScale(100);
    setBgPosition("center");
    setSelectedPreset(PHOTO_PRESETS[1]);
    setResult(null);

    const url = URL.createObjectURL(originalFile);
    const img = new Image();
    img.onload = () => {
      setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      setImageUrl(url);
      setImageBlob(originalFile);
      resetViewport();
    };
    img.src = url;
  }

  function handleProcessAnother() {
    resetAll();
    setStage("upload");
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <ToolPageLayout tool={tool}>
      {/* ─── UPLOAD ─── */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFileSelected}
          title="Select an image to resize"
          subtitle="Resize photos to standard formal sizes (2\u00d73, 3\u00d74, 4\u00d76 cm) for documents, passports, and visas"
        />
      )}

      {/* ─── EDITOR ─── */}
      {stage === "editor" && (
        <div className="space-y-6">
          {/* Preset buttons */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">
              Photo Size
            </h3>
            <div className="flex flex-wrap gap-2">
              {PHOTO_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePresetChange(p)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-all ${
                    selectedPreset.id === p.id
                      ? "border-amber-500 bg-amber-50 text-amber-800 ring-1 ring-amber-500"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-xs text-slate-500 ml-1">cm</span>
                  <br />
                  <span className="text-xs text-slate-400">
                    {p.widthPx}\u00d7{p.heightPx}px
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {selectedPreset.description} &middot; {selectedPreset.widthPx}
              \u00d7{selectedPreset.heightPx} px &middot; {PRINT_DPI} DPI
            </p>
          </div>

          {/* Preview frame */}
          <div className="flex flex-col items-center gap-3">
            <div
              data-testid="resize-frame"
              className="relative border-2 border-slate-300 bg-slate-100 overflow-hidden cursor-grab active:cursor-grabbing select-none"
              style={{
                width: frameW,
                height: frameH,
                touchAction: "none",
                maxWidth: "100%",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt="Preview"
                  draggable={false}
                  className="absolute pointer-events-none"
                  style={{
                    width: imgDisplayW,
                    height: imgDisplayH,
                    left: imgLeft,
                    top: imgTop,
                  }}
                />
              )}
              {/* Frame border overlay */}
              <div className="absolute inset-0 border border-white/40 pointer-events-none" />
              {/* Corner markers */}
              {[
                "top-0 left-0",
                "top-0 right-0",
                "bottom-0 left-0",
                "bottom-0 right-0",
              ].map((pos) => (
                <div
                  key={pos}
                  className={`absolute ${pos} w-4 h-4 pointer-events-none`}
                >
                  <div
                    className={`absolute ${pos.includes("top") ? "top-0" : "bottom-0"} ${pos.includes("left") ? "left-0" : "right-0"} w-4 h-0.5 bg-white/80`}
                  />
                  <div
                    className={`absolute ${pos.includes("top") ? "top-0" : "bottom-0"} ${pos.includes("left") ? "left-0" : "right-0"} w-0.5 h-4 bg-white/80`}
                  />
                </div>
              ))}
              {rotating && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
            </div>

            {/* Zoom slider */}
            <div className="flex items-center gap-3 w-full max-w-xs">
              <span className="text-xs text-slate-500">1\u00d7</span>
              <input
                type="range"
                min={1}
                max={5}
                step={0.1}
                value={zoom}
                onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                className="flex-1 accent-amber-500"
              />
              <span className="text-xs text-slate-500">5\u00d7</span>
              <span className="text-xs font-medium text-slate-600 w-10 text-right">
                {zoom.toFixed(1)}\u00d7
              </span>
            </div>

            {/* Drag hint */}
            <p className="text-xs text-slate-400">
              Drag the image to position your face within the frame
            </p>

            {/* Low res warning */}
            {isLowRes && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Image resolution may be too low for optimal print quality at
                this size
              </div>
            )}
          </div>

          {/* ─── SUB-FEATURES ─── */}
          <div className="space-y-4 border-t border-slate-100 pt-4">
            {/* Rotate & Crop row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-700 mr-1">
                Adjust
              </span>
              <button
                onClick={handleRotateCCW}
                disabled={rotating}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                title="Rotate counterclockwise"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={handleRotateCW}
                disabled={rotating}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                title="Rotate clockwise"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={handleFlipH}
                disabled={rotating}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                title="Flip horizontal"
              >
                <FlipHorizontal2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleFlipV}
                disabled={rotating}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40"
                title="Flip vertical"
              >
                <FlipVertical2 className="w-4 h-4" />
              </button>

              <div className="w-px h-6 bg-slate-200 mx-1" />

              <button
                onClick={() => setStage("crop")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm"
              >
                <Crop className="w-4 h-4" />
                Crop
              </button>
            </div>

            {/* Background section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-slate-700">
                  Background
                </span>
                {!bgRemoved && !bgRemoving && (
                  <button
                    onClick={handleRemoveBg}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-700 transition"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Remove Background
                  </button>
                )}
                {bgRemoved && (
                  <button
                    onClick={handleResetBg}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm hover:bg-slate-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reset
                  </button>
                )}
              </div>

              {/* BG removal progress */}
              {bgRemoving && (
                <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg">
                  <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                  <div className="flex-1">
                    <div className="text-xs text-slate-600 mb-1">
                      {bgProgress.stage}
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-200 rounded-full"
                        style={{ width: `${bgProgress.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* BG options (after removal) */}
              {bgRemoved && !bgRemoving && (
                <div className="space-y-3 pl-0">
                  {/* Color mode */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => setBgMode("color")}
                        className={`text-xs px-2 py-1 rounded ${bgMode === "color" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                      >
                        Color
                      </button>
                      <button
                        onClick={() => setBgMode("image")}
                        className={`text-xs px-2 py-1 rounded ${bgMode === "image" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}
                      >
                        Image
                      </button>
                    </div>

                    {bgMode === "color" && (
                      <div className="flex flex-wrap items-center gap-2">
                        {BG_COLORS.map(({ color, label }) => (
                          <button
                            key={color}
                            onClick={() => handleBgColorSelect(color)}
                            className={`w-8 h-8 rounded-full border-2 transition-all ${
                              bgColor === color && bgMode === "color"
                                ? "border-amber-500 ring-2 ring-amber-200 scale-110"
                                : "border-slate-300 hover:scale-105"
                            }`}
                            style={{ backgroundColor: color }}
                            title={label}
                          />
                        ))}
                        <label className="relative">
                          <input
                            type="color"
                            value={bgColor}
                            onChange={(e) =>
                              handleBgColorSelect(e.target.value)
                            }
                            className="absolute inset-0 opacity-0 cursor-pointer w-8 h-8"
                          />
                          <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center hover:border-slate-400 cursor-pointer">
                            <span className="text-xs text-slate-400">+</span>
                          </div>
                        </label>
                        {compositing && (
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        )}
                      </div>
                    )}

                    {bgMode === "image" && (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-slate-400 text-sm text-slate-600">
                          <ImagePlus className="w-4 h-4" />
                          {bgImageFile
                            ? bgImageFile.name
                            : "Choose background image"}
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png"
                            onChange={handleBgImageSelected}
                            className="hidden"
                          />
                        </label>
                        {bgImageFile && (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 w-10">
                                Scale
                              </span>
                              <input
                                type="range"
                                min={10}
                                max={300}
                                value={bgScale}
                                onChange={(e) =>
                                  setBgScale(parseInt(e.target.value))
                                }
                                className="flex-1 accent-amber-500"
                              />
                              <span className="text-xs font-medium text-slate-600 w-10 text-right">
                                {bgScale}%
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500 w-10">
                                Position
                              </span>
                              <div className="grid grid-cols-3 gap-1">
                                {POSITION_GRID.map(({ pos }) => (
                                  <button
                                    key={pos}
                                    onClick={() => setBgPosition(pos)}
                                    className={`w-5 h-5 rounded-sm border transition-all ${
                                      bgPosition === pos
                                        ? "bg-amber-500 border-amber-500"
                                        : "bg-slate-100 border-slate-300 hover:bg-slate-200"
                                    }`}
                                  />
                                ))}
                              </div>
                              {compositing && (
                                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Process + Reset All buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleProcess}
              disabled={rotating || bgRemoving || compositing}
              className="flex-1 py-3 rounded-xl bg-amber-500 text-white font-semibold text-lg hover:bg-amber-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Process
            </button>
            <button
              onClick={handleResetToOriginal}
              disabled={rotating || bgRemoving}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition disabled:opacity-40"
              title="Reset all changes to original image"
            >
              <ResetIcon className="w-4 h-4" />
              Reset All
            </button>
          </div>
        </div>
      )}

      {/* ─── CROP (CropEditor sub-feature) ─── */}
      {stage === "crop" && imageBlob && (
        <CropEditor
          imageUrl={imageUrl}
          naturalWidth={imageDims.width}
          naturalHeight={imageDims.height}
          showRotation={false}
          onCrop={handleCropApply}
          actionLabel="Apply Crop"
          onNavigateRotate={handleCropCancel}
          navigateLabel="Cancel"
          isProcessing={cropLoading}
        />
      )}

      {/* ─── PROCESSING ─── */}
      {stage === "processing" && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
          <p className="text-slate-600 font-medium">{progress.stage}</p>
          <div className="w-64 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-200 rounded-full"
              style={{ width: `${progress.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ─── DONE ─── */}
      {stage === "done" && result && (
        <div className="space-y-6">
          {/* Success header */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 mb-3">
              <Check className="w-6 h-6 text-emerald-600" />
            </div>
            <h2 className="text-xl font-semibold text-slate-800">
              Resize Complete!
            </h2>
          </div>

          {/* Preview */}
          <div className="flex justify-center">
            <img
              src={result.previewUrl}
              alt="Resized"
              className="max-h-64 border border-slate-200 rounded-lg shadow-sm"
            />
          </div>

          {/* Info card */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Size</span>
              <span className="font-medium text-slate-700">
                {result.preset.label} cm ({result.preset.widthCm}\u00d7
                {result.preset.heightCm} cm)
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Dimensions</span>
              <span className="font-medium text-slate-700">
                {result.resizedWidth}\u00d7{result.resizedHeight} px
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">DPI</span>
              <span className="font-medium text-slate-700">{PRINT_DPI}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">File Size</span>
              <span className="font-medium text-slate-700">
                {formatSize(result.resizedSize)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Format</span>
              <span className="font-medium text-slate-700">JPEG</span>
            </div>
          </div>

          {/* Data Quality badge */}
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
            <Check className="w-4 h-4 shrink-0" />
            Print-ready at {PRINT_DPI} DPI &middot; Optimal quality
          </div>

          {/* Info Notice */}
          <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            Output is JPEG at maximum quality with {PRINT_DPI} DPI metadata
            embedded. Ready for professional printing.
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition"
            >
              <Download className="w-5 h-5" />
              Download
            </button>
            <button
              onClick={handleBackToEdit}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Edit
            </button>
            <button
              onClick={handleProcessAnother}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition"
            >
              <Upload className="w-5 h-5" />
              Resize Another
            </button>
          </div>

          {/* How it works */}
          <div className="border-t border-slate-100 pt-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              How it works
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-slate-500">
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="font-semibold text-slate-600 mb-1">
                  1. Upload
                </div>
                Select a JPG or PNG image from your device
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="font-semibold text-slate-600 mb-1">
                  2. Choose Size
                </div>
                Pick a standard photo size preset (2\u00d73, 3\u00d74, 4\u00d76
                cm, etc.)
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="font-semibold text-slate-600 mb-1">
                  3. Position
                </div>
                Drag to position your face, zoom to adjust, optionally
                change background
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <div className="font-semibold text-slate-600 mb-1">
                  4. Download
                </div>
                Get your {PRINT_DPI} DPI JPEG ready for professional printing
              </div>
            </div>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}
