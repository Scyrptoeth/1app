"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import CropEditor from "@/components/CropEditor";
import { getToolById } from "@/config/tools";
import { rotateImage } from "@/lib/tools/rotate-image";
import { cropImage, type CropArea } from "@/lib/tools/crop-image";
import {
  removeImageBackground,
  addColorBackground,
  addImageBackground,
  type BgPosition,
} from "@/lib/tools/remove-and-change-background";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type Stage = "upload" | "editor" | "crop" | "processing" | "done";
type BgMode = "transparent" | "color" | "image";

interface DoneData {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  width: number;
  height: number;
}

const COLOR_PRESETS = [
  { label: "White", value: "#FFFFFF" },
  { label: "Black", value: "#000000" },
  { label: "Red", value: "#FF0000" },
  { label: "Blue", value: "#0000FF" },
  { label: "Green", value: "#00FF00" },
  { label: "Yellow", value: "#FFFF00" },
  { label: "Gray", value: "#808080" },
  { label: "Navy", value: "#000080" },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RemoveAndChangeBackgroundPage() {
  const tool = getToolById("remove-and-change-background")!;

  // Stage
  const [stage, setStage] = useState<Stage>("upload");

  // File & original image
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });

  // BG removal
  const [bgRemoved, setBgRemoved] = useState(false);
  const [bgRemoving, setBgRemoving] = useState(false);
  const [bgRemoveProgress, setBgRemoveProgress] = useState({
    stage: "",
    progress: 0,
  });
  const [foregroundBlob, setForegroundBlob] = useState<Blob | null>(null);
  const [foregroundUrl, setForegroundUrl] = useState("");

  // Background replacement
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [bgColor, setBgColor] = useState("#FFFFFF");
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgScale, setBgScale] = useState(100);
  const [bgPosition, setBgPosition] = useState<BgPosition>("center");
  const [compositeUrl, setCompositeUrl] = useState("");
  const [compositeBlob, setCompositeBlob] = useState<Blob | null>(null);
  const [compositing, setCompositing] = useState(false);

  // Transforms (CSS-only preview, baked at Process time)
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Crop mode
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [cropUrl, setCropUrl] = useState("");
  const [cropDims, setCropDims] = useState({ width: 0, height: 0 });
  const [cropLoading, setCropLoading] = useState(false);

  // Processing & result
  const [progress, setProgress] = useState({ progress: 0, stage: "" });
  const [doneData, setDoneData] = useState<DoneData | null>(null);

  // Scale for preview
  const [scale, setScale] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);

  // Hidden file input for bg image
  const bgImageInputRef = useRef<HTMLInputElement>(null);

  // Derived
  const hasTransform = rotation !== 0 || flipH || flipV;
  const isSwapped = rotation === 90 || rotation === 270;
  const displayW = isSwapped ? imageDims.height : imageDims.width;
  const displayH = isSwapped ? imageDims.width : imageDims.height;

  // Current preview source
  const previewSrc = !bgRemoved
    ? imageUrl
    : bgMode === "transparent"
      ? foregroundUrl
      : compositeUrl || foregroundUrl;

  const showCheckerboard = bgRemoved && bgMode === "transparent";

  // ---- Scale calculation ----
  useEffect(() => {
    if (!previewRef.current || displayW === 0 || displayH === 0) return;
    const update = () => {
      if (!previewRef.current) return;
      const maxW = previewRef.current.clientWidth;
      const maxH = 500;
      setScale(Math.min(maxW / displayW, maxH / displayH, 4));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [displayW, displayH, stage]);

  // ---- File selection ----
  const handleFileSelected = useCallback((files: File[]) => {
    const f = files[0];
    setFile(f);
    const url = URL.createObjectURL(f);
    setImageUrl(url);
    const img = new Image();
    img.onload = () => {
      setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      setStage("editor");
    };
    img.src = url;
  }, []);

  // ---- Remove background ----
  const handleRemoveBackground = useCallback(async () => {
    if (!file) return;
    setBgRemoving(true);
    setBgRemoveProgress({ stage: "Starting...", progress: 0 });
    try {
      const result = await removeImageBackground(file, (u) => {
        setBgRemoveProgress({ stage: u.stage, progress: u.progress });
      });
      setForegroundBlob(result.blob);
      setForegroundUrl(result.previewUrl);
      setImageDims({ width: result.width, height: result.height });
      setBgRemoved(true);
      setBgMode("transparent");
    } catch (err) {
      console.error("Background removal failed:", err);
      alert("Failed to remove background. Please try again.");
    }
    setBgRemoving(false);
  }, [file]);

  // ---- Add color background ----
  const handleColorSelect = useCallback(
    async (color: string) => {
      if (!foregroundBlob) return;
      setBgColor(color);
      setBgMode("color");
      setCompositing(true);
      try {
        if (compositeUrl) URL.revokeObjectURL(compositeUrl);
        const result = await addColorBackground(
          foregroundBlob,
          color,
          imageDims.width,
          imageDims.height
        );
        setCompositeUrl(result.previewUrl);
        setCompositeBlob(result.blob);
      } catch (err) {
        console.error("Color composite failed:", err);
      }
      setCompositing(false);
    },
    [foregroundBlob, imageDims, compositeUrl]
  );

  // ---- Add image background ----
  const handleBgImageSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const bgFile = e.target.files?.[0];
      if (!bgFile || !foregroundBlob) return;
      setBgImageFile(bgFile);
      setBgMode("image");
      setBgScale(100);
      setBgPosition("center");
      setCompositing(true);
      try {
        if (compositeUrl) URL.revokeObjectURL(compositeUrl);
        const result = await addImageBackground(
          foregroundBlob,
          bgFile,
          imageDims.width,
          imageDims.height,
          { scale: 100, position: "center" }
        );
        setCompositeUrl(result.previewUrl);
        setCompositeBlob(result.blob);
      } catch (err) {
        console.error("Image composite failed:", err);
      }
      setCompositing(false);
      if (bgImageInputRef.current) bgImageInputRef.current.value = "";
    },
    [foregroundBlob, imageDims, compositeUrl]
  );

  // ---- Recomposite image background on scale/position change (debounced) ----
  const recompositeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (bgMode !== "image" || !bgImageFile || !foregroundBlob) return;

    if (recompositeTimer.current) clearTimeout(recompositeTimer.current);
    recompositeTimer.current = setTimeout(async () => {
      setCompositing(true);
      try {
        if (compositeUrl) URL.revokeObjectURL(compositeUrl);
        const result = await addImageBackground(
          foregroundBlob,
          bgImageFile,
          imageDims.width,
          imageDims.height,
          { scale: bgScale, position: bgPosition }
        );
        setCompositeUrl(result.previewUrl);
        setCompositeBlob(result.blob);
      } catch (err) {
        console.error("Recomposite failed:", err);
      }
      setCompositing(false);
    }, 150);

    return () => {
      if (recompositeTimer.current) clearTimeout(recompositeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgScale, bgPosition]);

  // ---- Set transparent ----
  const handleSetTransparent = useCallback(() => {
    setBgMode("transparent");
    setBgImageFile(null);
    setBgScale(100);
    setBgPosition("center");
    if (compositeUrl) {
      URL.revokeObjectURL(compositeUrl);
      setCompositeUrl("");
      setCompositeBlob(null);
    }
  }, [compositeUrl]);

  // ---- Rotate handlers ----
  const handleRotateCW = useCallback(() => {
    setRotation((prev) => (((prev + 90) % 360) as 0 | 90 | 180 | 270));
  }, []);

  const handleRotateCCW = useCallback(() => {
    setRotation(
      (prev) => (((prev - 90 + 360) % 360) as 0 | 90 | 180 | 270)
    );
  }, []);

  const handleFlipH = useCallback(() => {
    if (rotation === 90 || rotation === 270) {
      setFlipV((v) => !v);
    } else {
      setFlipH((h) => !h);
    }
  }, [rotation]);

  const handleFlipV = useCallback(() => {
    if (rotation === 90 || rotation === 270) {
      setFlipH((h) => !h);
    } else {
      setFlipV((v) => !v);
    }
  }, [rotation]);

  // ---- Enter crop mode ----
  const handleEnterCropMode = useCallback(async () => {
    const workingBlob =
      bgMode !== "transparent" && compositeBlob
        ? compositeBlob
        : foregroundBlob;

    if (!workingBlob) return;
    setCropLoading(true);

    try {
      if (hasTransform) {
        const tempFile = new File([workingBlob], "temp.png", {
          type: "image/png",
        });
        const result = await rotateImage(tempFile, {
          rotation,
          flipHorizontal: flipH,
          flipVertical: flipV,
        });
        const cf = new File([result.blob], "crop-source.png", {
          type: "image/png",
        });
        setCropFile(cf);
        setCropUrl(result.previewUrl);
        setCropDims({ width: result.width, height: result.height });
      } else {
        const url = URL.createObjectURL(workingBlob);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = url;
        });
        const cf = new File([workingBlob], "crop-source.png", {
          type: "image/png",
        });
        setCropFile(cf);
        setCropUrl(url);
        setCropDims({ width: img.naturalWidth, height: img.naturalHeight });
      }
      setStage("crop");
    } catch (err) {
      console.error("Failed to prepare crop:", err);
      alert("Failed to prepare image for cropping.");
    }
    setCropLoading(false);
  }, [
    foregroundBlob,
    compositeBlob,
    bgMode,
    hasTransform,
    rotation,
    flipH,
    flipV,
  ]);

  // ---- Crop: apply and stay in crop view ----
  const handleCropApply = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!cropFile) return;
      const isFullCrop =
        cropArea.x === 0 &&
        cropArea.y === 0 &&
        cropArea.width === cropDims.width &&
        cropArea.height === cropDims.height;
      if (isFullCrop && cropRotation === 0) return;

      setCropLoading(true);
      try {
        const result = await cropImage(cropFile, {
          cropArea,
          rotation: cropRotation,
        });
        if (cropUrl) URL.revokeObjectURL(cropUrl);
        const newFile = new File([result.blob], "cropped.png", {
          type: "image/png",
        });
        setCropFile(newFile);
        setCropUrl(result.previewUrl);
        setCropDims({
          width: result.croppedWidth,
          height: result.croppedHeight,
        });
      } catch (err) {
        console.error("Crop failed:", err);
      }
      setCropLoading(false);
    },
    [cropFile, cropDims, cropUrl]
  );

  // ---- Crop: apply and return to editor ----
  const handleCropAndReturn = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!cropFile) return;
      setCropLoading(true);
      try {
        const isFullCrop =
          cropArea.x === 0 &&
          cropArea.y === 0 &&
          cropArea.width === cropDims.width &&
          cropArea.height === cropDims.height;

        let finalBlob: Blob;
        let finalW: number;
        let finalH: number;
        let finalUrl: string;

        if (isFullCrop && cropRotation === 0) {
          finalBlob = cropFile;
          finalW = cropDims.width;
          finalH = cropDims.height;
          finalUrl = cropUrl;
        } else {
          const result = await cropImage(cropFile, {
            cropArea,
            rotation: cropRotation,
          });
          finalBlob = result.blob;
          finalW = result.croppedWidth;
          finalH = result.croppedHeight;
          finalUrl = result.previewUrl;
          if (cropUrl) URL.revokeObjectURL(cropUrl);
        }

        // Update working state — crop is destructive, resets bg mode
        if (foregroundUrl) URL.revokeObjectURL(foregroundUrl);
        if (compositeUrl) URL.revokeObjectURL(compositeUrl);

        const newBlob = new Blob([await finalBlob.arrayBuffer()], {
          type: "image/png",
        });
        setForegroundBlob(newBlob);
        setForegroundUrl(finalUrl);
        setCompositeUrl("");
        setCompositeBlob(null);
        setBgMode("transparent");
        setBgImageFile(null);
        setImageDims({ width: finalW, height: finalH });
        setRotation(0);
        setFlipH(false);
        setFlipV(false);
        setCropFile(null);
        setCropUrl("");
        setCropDims({ width: 0, height: 0 });
        setStage("editor");
      } catch (err) {
        console.error("Crop failed:", err);
        alert("Failed to apply crop.");
      }
      setCropLoading(false);
    },
    [cropFile, cropDims, cropUrl, foregroundUrl, compositeUrl]
  );

  // ---- Crop: apply and go to done stage ----
  const handleCropAndProcess = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!cropFile || !file) return;
      setCropLoading(true);
      try {
        const isFullCrop =
          cropArea.x === 0 &&
          cropArea.y === 0 &&
          cropArea.width === cropDims.width &&
          cropArea.height === cropDims.height;

        let finalBlob: Blob;
        let finalW: number;
        let finalH: number;

        if (isFullCrop && cropRotation === 0) {
          finalBlob = cropFile;
          finalW = cropDims.width;
          finalH = cropDims.height;
        } else {
          const result = await cropImage(cropFile, {
            cropArea,
            rotation: cropRotation,
          });
          finalBlob = result.blob;
          finalW = result.croppedWidth;
          finalH = result.croppedHeight;
        }

        const resultUrl = URL.createObjectURL(finalBlob);
        setDoneData({
          blob: finalBlob,
          previewUrl: resultUrl,
          originalSize: file.size,
          processedSize: finalBlob.size,
          width: finalW,
          height: finalH,
        });
        setStage("done");
      } catch (err) {
        console.error("Process failed:", err);
        alert("Failed to process the image.");
      }
      setCropLoading(false);
    },
    [cropFile, cropDims, file]
  );

  // ---- Process (finalize all edits) ----
  const handleProcess = useCallback(async () => {
    if (!file || !bgRemoved) return;
    setStage("processing");
    setProgress({ stage: "Finalizing...", progress: 10 });

    try {
      const workingBlob =
        bgMode !== "transparent" && compositeBlob
          ? compositeBlob
          : foregroundBlob;

      if (!workingBlob) throw new Error("No image to process");

      let finalBlob: Blob;
      let finalW: number;
      let finalH: number;

      if (hasTransform) {
        setProgress({ stage: "Applying transformations...", progress: 30 });
        const tempFile = new File([workingBlob], "temp.png", {
          type: "image/png",
        });
        const result = await rotateImage(tempFile, {
          rotation,
          flipHorizontal: flipH,
          flipVertical: flipV,
          onProgress: (u) =>
            setProgress({
              stage: u.stage,
              progress: 30 + u.progress * 0.6,
            }),
        });
        finalBlob = result.blob;
        finalW = result.width;
        finalH = result.height;
      } else {
        finalBlob = workingBlob;
        finalW = imageDims.width;
        finalH = imageDims.height;
      }

      setProgress({ stage: "Complete!", progress: 100 });

      const resultUrl = URL.createObjectURL(finalBlob);
      setDoneData({
        blob: finalBlob,
        previewUrl: resultUrl,
        originalSize: file.size,
        processedSize: finalBlob.size,
        width: finalW,
        height: finalH,
      });
      setStage("done");
    } catch (err) {
      console.error("Processing failed:", err);
      alert("Failed to process image. Please try again.");
      setStage("editor");
    }
  }, [
    file,
    bgRemoved,
    bgMode,
    compositeBlob,
    foregroundBlob,
    hasTransform,
    rotation,
    flipH,
    flipV,
    imageDims,
  ]);

  // ---- Reset all (with confirmation) ----
  const handleResetAll = useCallback(() => {
    if (!confirm("Reset all changes? This will undo background removal and all edits.")) return;

    if (foregroundUrl) URL.revokeObjectURL(foregroundUrl);
    if (compositeUrl) URL.revokeObjectURL(compositeUrl);

    setBgRemoved(false);
    setBgRemoving(false);
    setForegroundBlob(null);
    setForegroundUrl("");
    setBgMode("transparent");
    setBgColor("#FFFFFF");
    setBgImageFile(null);
    setBgScale(100);
    setBgPosition("center");
    setCompositeUrl("");
    setCompositeBlob(null);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);

    // Restore original image
    if (file) {
      const url = URL.createObjectURL(file);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(url);
      const img = new Image();
      img.onload = () => {
        setImageDims({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = url;
    }
  }, [file, foregroundUrl, compositeUrl, imageUrl]);

  // ---- Download result ----
  const handleDownloadResult = useCallback(() => {
    if (!doneData || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const suffix = bgMode === "transparent" ? "no-bg" : "new-bg";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(doneData.blob);
    a.download = `${baseName}-${suffix}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [doneData, file, bgMode]);

  // ---- Back to edit ----
  const handleBackToEdit = useCallback(() => {
    if (doneData?.previewUrl) URL.revokeObjectURL(doneData.previewUrl);
    setDoneData(null);
    setProgress({ progress: 0, stage: "" });
    setStage("editor");
  }, [doneData]);

  // ---- Start over ----
  const handleStartOver = useCallback(() => {
    if (doneData?.previewUrl) URL.revokeObjectURL(doneData.previewUrl);
    if (foregroundUrl) URL.revokeObjectURL(foregroundUrl);
    if (compositeUrl) URL.revokeObjectURL(compositeUrl);
    if (imageUrl) URL.revokeObjectURL(imageUrl);

    setStage("upload");
    setFile(null);
    setImageUrl("");
    setImageDims({ width: 0, height: 0 });
    setBgRemoved(false);
    setBgRemoving(false);
    setForegroundBlob(null);
    setForegroundUrl("");
    setBgMode("transparent");
    setBgColor("#FFFFFF");
    setBgImageFile(null);
    setBgScale(100);
    setBgPosition("center");
    setCompositeUrl("");
    setCompositeBlob(null);
    setCompositing(false);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setCropFile(null);
    setCropUrl("");
    setCropDims({ width: 0, height: 0 });
    setProgress({ progress: 0, stage: "" });
    setDoneData(null);
  }, [doneData, foregroundUrl, compositeUrl, imageUrl]);

  // CSS transform
  const cssTransform = `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <ToolPageLayout tool={tool}>
      {/* ---- Upload ---- */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={50}
          multiple={false}
          onFilesSelected={handleFileSelected}
          title="Select an image to remove background"
          subtitle="Supports JPG, JPEG, and PNG files up to 50MB"
        />
      )}

      {/* ---- Editor ---- */}
      {stage === "editor" && file && (
        <div className="w-full">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left — Preview */}
            <div className="flex-1 min-w-0" ref={previewRef}>
              <div
                className={`relative mx-auto select-none overflow-hidden rounded-lg border border-slate-200 ${
                  showCheckerboard
                    ? "bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
                    : "bg-slate-100"
                }`}
                style={{
                  width: displayW * scale,
                  height: displayH * scale,
                }}
              >
                {previewSrc && (
                  <img
                    src={previewSrc}
                    alt="Preview"
                    draggable={false}
                    className="pointer-events-none"
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: imageDims.width * scale,
                      height: imageDims.height * scale,
                      transform: cssTransform,
                    }}
                  />
                )}

                {/* BG removal loading overlay */}
                {bgRemoving && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center z-10">
                    <div className="w-48 h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-accent-500 rounded-full transition-all duration-300"
                        style={{ width: `${bgRemoveProgress.progress}%` }}
                      />
                    </div>
                    <p className="text-sm text-slate-600 font-medium">
                      {bgRemoveProgress.stage}
                    </p>
                  </div>
                )}

                {/* Compositing spinner */}
                {compositing && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
                    <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Info below preview */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm text-slate-500">
                <span>
                  {displayW} &times; {displayH}px
                </span>
                {bgRemoved && (
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Background removed
                  </span>
                )}
                {hasTransform && (
                  <span className="text-orange-600 font-medium">Modified</span>
                )}
              </div>
            </div>

            {/* Right — Controls */}
            <div className="w-full lg:w-72 shrink-0 space-y-5">
              {/* Remove Background button (shown before removal) */}
              {!bgRemoved && (
                <button
                  onClick={handleRemoveBackground}
                  disabled={bgRemoving}
                  className={`w-full py-3 font-semibold rounded-xl transition-colors text-sm ${
                    bgRemoving
                      ? "bg-accent-300 text-white cursor-not-allowed"
                      : "bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700 shadow-md shadow-accent-500/25"
                  }`}
                >
                  {bgRemoving ? "Removing..." : "Remove Background"}
                </button>
              )}

              {/* Controls after BG removal */}
              {bgRemoved && (
                <>
                  {/* Background options */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Background
                    </h3>

                    {/* Transparent toggle */}
                    <button
                      onClick={handleSetTransparent}
                      className={`w-full mb-3 px-3 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 ${
                        bgMode === "transparent"
                          ? "bg-blue-50 border-blue-500 text-blue-700"
                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <span className="w-5 h-5 rounded border border-slate-300 bg-[repeating-conic-gradient(#d1d5db_0%_25%,#fff_0%_50%)] bg-[length:8px_8px] shrink-0" />
                      Transparent
                    </button>

                    {/* Color presets */}
                    <div className="mb-3">
                      <p className="text-xs text-slate-500 mb-2">Add Color</p>
                      <div className="grid grid-cols-4 gap-2">
                        {COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.value}
                            onClick={() => handleColorSelect(preset.value)}
                            title={preset.label}
                            className={`aspect-square rounded-lg border-2 transition-all ${
                              bgMode === "color" && bgColor === preset.value
                                ? "border-blue-500 ring-2 ring-blue-500/20 scale-110"
                                : "border-slate-200 hover:border-slate-400"
                            }`}
                            style={{ backgroundColor: preset.value }}
                          />
                        ))}
                      </div>
                      {/* Custom color picker */}
                      <div className="mt-2">
                        <label className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:border-slate-300 cursor-pointer">
                          <input
                            type="color"
                            value={bgColor}
                            onChange={(e) => handleColorSelect(e.target.value)}
                            className="w-5 h-5 rounded border-0 cursor-pointer"
                          />
                          <span className="text-slate-600">Custom</span>
                          <span className="text-xs text-slate-400 ml-auto">
                            {bgColor}
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Image background */}
                    <div>
                      <p className="text-xs text-slate-500 mb-2">Add Image</p>
                      <input
                        ref={bgImageInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png"
                        onChange={handleBgImageSelected}
                        className="hidden"
                      />
                      <button
                        onClick={() => bgImageInputRef.current?.click()}
                        className={`w-full px-3 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2 ${
                          bgMode === "image"
                            ? "bg-blue-50 border-blue-500 text-blue-700"
                            : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                        }`}
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
                          <rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            ry="2"
                          />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        <span className="truncate">
                          {bgMode === "image" && bgImageFile
                            ? bgImageFile.name
                            : "Upload background image"}
                        </span>
                      </button>

                      {/* Scale & Position controls (shown when image bg is active) */}
                      {bgMode === "image" && bgImageFile && (
                        <div className="mt-3 space-y-3">
                          {/* Scale slider */}
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <p className="text-xs text-slate-500">Scale</p>
                              <span className="text-xs font-medium text-slate-700">
                                {bgScale}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={50}
                              max={300}
                              step={5}
                              value={bgScale}
                              onChange={(e) =>
                                setBgScale(parseInt(e.target.value))
                              }
                              className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                              <span>50%</span>
                              <span>300%</span>
                            </div>
                          </div>

                          {/* 9-point position grid */}
                          <div>
                            <p className="text-xs text-slate-500 mb-1.5">
                              Position
                            </p>
                            <div className="grid grid-cols-3 gap-1 w-24 mx-auto">
                              {(
                                [
                                  "top-left",
                                  "top-center",
                                  "top-right",
                                  "center-left",
                                  "center",
                                  "center-right",
                                  "bottom-left",
                                  "bottom-center",
                                  "bottom-right",
                                ] as BgPosition[]
                              ).map((pos) => (
                                <button
                                  key={pos}
                                  onClick={() => setBgPosition(pos)}
                                  title={pos}
                                  className={`w-7 h-7 rounded border-2 transition-all flex items-center justify-center ${
                                    bgPosition === pos
                                      ? "border-blue-500 bg-blue-500"
                                      : "border-slate-300 bg-white hover:border-slate-400"
                                  }`}
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      bgPosition === pos
                                        ? "bg-white"
                                        : "bg-slate-300"
                                    }`}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Transform */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">
                      Transform
                    </h3>
                    <div className="grid grid-cols-4 gap-2">
                      <button
                        onClick={handleRotateCW}
                        title="Rotate 90° CW"
                        className="flex items-center justify-center p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38" />
                        </svg>
                      </button>
                      <button
                        onClick={handleRotateCCW}
                        title="Rotate 90° CCW"
                        className="flex items-center justify-center p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                          <path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-8.38" />
                        </svg>
                      </button>
                      <button
                        onClick={handleFlipH}
                        title="Flip Horizontal"
                        className="flex items-center justify-center p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                          <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
                          <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
                          <line x1="12" y1="20" x2="12" y2="4" />
                        </svg>
                      </button>
                      <button
                        onClick={handleFlipV}
                        title="Flip Vertical"
                        className="flex items-center justify-center p-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                          <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3" />
                          <path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3" />
                          <line x1="4" y1="12" x2="20" y2="12" />
                        </svg>
                      </button>
                    </div>

                    {/* Crop */}
                    <button
                      onClick={handleEnterCropMode}
                      disabled={cropLoading}
                      className="w-full mt-3 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors flex items-center justify-center gap-2"
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
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h2" />
                        <path d="M18 22l3-4V4a2 2 0 0 0-2-2h-2" />
                        <rect x="7" y="6" width="10" height="12" rx="1" />
                      </svg>
                      {cropLoading ? "Preparing..." : "Crop"}
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div className="space-y-3 pt-2">
                    <button
                      onClick={handleProcess}
                      disabled={compositing}
                      className="w-full py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Process
                    </button>
                    <button
                      onClick={handleResetAll}
                      className="w-full py-2.5 text-slate-600 font-medium border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm"
                    >
                      Reset All
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---- Crop mode ---- */}
      {stage === "crop" && cropFile && (
        <CropEditor
          imageUrl={cropUrl}
          naturalWidth={cropDims.width}
          naturalHeight={cropDims.height}
          showRotation={false}
          onCrop={handleCropApply}
          actionLabel="Crop"
          onNavigateRotate={handleCropAndReturn}
          navigateLabel="Back to Background & Rotate"
          onDownload={handleCropAndProcess}
          downloadLabel="Process"
          isProcessing={cropLoading}
        />
      )}

      {/* ---- Processing ---- */}
      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.stage}
        />
      )}

      {/* ---- Done ---- */}
      {stage === "done" && doneData && file && (
        <div className="w-full max-w-lg mx-auto text-center">
          {/* Success icon */}
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-500"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <h3 className="text-xl font-bold text-slate-900 mb-1">
            Background processed!
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Your image is ready to download.
          </p>

          {/* Preview — tight wrap, no empty space on sides */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-xl overflow-hidden border border-slate-100 shadow-sm inline-block">
              <img
                src={doneData.previewUrl}
                alt="Result"
                className="block max-w-full max-h-80 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
              />
            </div>
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Original</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(doneData.originalSize)}
              </p>
            </div>
            <div className="p-3 bg-blue-50 rounded-xl">
              <p className="text-xs text-blue-600 mb-1">Processed</p>
              <p className="text-sm font-semibold text-blue-700">
                {formatFileSize(doneData.processedSize)}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Format</p>
              <p className="text-sm font-semibold text-slate-900">PNG</p>
              <p className="text-xs text-slate-400 mt-0.5">Max quality</p>
            </div>
          </div>

          {/* Quality badge */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 bg-emerald-50 text-emerald-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              Resolution preserved
            </span>
            <p className="text-xs text-slate-500 leading-relaxed text-left">
              Output maintains original resolution ({doneData.width} &times;{" "}
              {doneData.height}px).
            </p>
          </div>

          {/* Info notice */}
          <div className="mb-6 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl text-left">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-blue-500 shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Background was removed using AI entirely in your browser. No data
              was uploaded to any server.
            </p>
          </div>

          {/* Actions — 3 buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDownloadResult}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 text-sm"
            >
              <svg
                width="18"
                height="18"
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
              Download
            </button>
            <button
              onClick={handleBackToEdit}
              className="flex-1 px-4 py-3 text-accent-600 font-semibold rounded-xl border border-accent-200 hover:bg-accent-50 transition-colors text-sm"
            >
              Back to Edit
            </button>
            <button
              onClick={handleStartOver}
              className="flex-1 px-4 py-3 text-slate-600 font-semibold rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
            >
              Process Another
            </button>
          </div>
        </div>
      )}

      {/* ---- How it works ---- */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          How it works
        </h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload",
              desc: "Select a JPG, JPEG, or PNG image you want to process.",
            },
            {
              step: "2",
              title: "Remove Background",
              desc: "AI removes the background automatically using on-device processing.",
            },
            {
              step: "3",
              title: "Customize",
              desc: "Optionally add a new color or image background, rotate, or crop.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Download your processed image in PNG format with maximum quality.",
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
