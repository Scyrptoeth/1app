"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import CropEditor from "@/components/CropEditor";
import { getToolById } from "@/config/tools";
import { rotateImage } from "@/lib/tools/rotate-image";
import { cropImage, type CropArea } from "@/lib/tools/crop-image";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Stage = "upload" | "editor" | "crop" | "processing" | "done";

interface DoneData {
  blob: Blob;
  previewUrl: string;
  originalSize: number;
  processedSize: number;
  newWidth: number;
  newHeight: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getOutputExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
  if (ext === "png") return "png";
  if (ext === "jpeg") return "jpeg";
  return "jpg";
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function RotateImagePage() {
  const tool = getToolById("rotate-image")!;

  // Stage
  const [stage, setStage] = useState<Stage>("upload");

  // File & image
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  // Transform state
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Crop mode intermediate data
  const [transformedFile, setTransformedFile] = useState<File | null>(null);
  const [transformedUrl, setTransformedUrl] = useState("");
  const [transformedSize, setTransformedSize] = useState({
    width: 0,
    height: 0,
  });
  const [cropLoading, setCropLoading] = useState(false);

  // Processing & result
  const [progress, setProgress] = useState({ progress: 0, stage: "" });
  const [doneData, setDoneData] = useState<DoneData | null>(null);

  // Scale for editor preview
  const [scale, setScale] = useState(1);
  const editorRef = useRef<HTMLDivElement>(null);

  // Derived dimensions
  const isSwapped = rotation === 90 || rotation === 270;
  const displayW = isSwapped ? naturalSize.height : naturalSize.width;
  const displayH = isSwapped ? naturalSize.width : naturalSize.height;
  const hasTransform = rotation !== 0 || flipH || flipV;

  // ---- Scale calculation ----
  useEffect(() => {
    if (!editorRef.current || displayW === 0 || displayH === 0) return;

    const update = () => {
      if (!editorRef.current) return;
      const maxW = editorRef.current.clientWidth;
      const maxH = 500;
      setScale(Math.min(maxW / displayW, maxH / displayH, 4));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(editorRef.current);
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
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setRotation(0);
      setFlipH(false);
      setFlipV(false);
      setStage("editor");
    };
    img.src = url;
  }, []);

  // ---- Rotate handlers ----
  const handleRotateCW = useCallback(() => {
    setRotation(
      (prev) => (((prev + 90) % 360) as 0 | 90 | 180 | 270)
    );
  }, []);

  const handleRotateCCW = useCallback(() => {
    setRotation(
      (prev) => (((prev - 90 + 360) % 360) as 0 | 90 | 180 | 270)
    );
  }, []);

  const handleRotate180 = useCallback(() => {
    setRotation(
      (prev) => (((prev + 180) % 360) as 0 | 90 | 180 | 270)
    );
  }, []);

  // Flip handlers — compensate for rotation so the flip applies visually
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

  const handleResetAll = useCallback(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  }, []);

  // ---- Download (rotate/flip only) ----
  const handleDownload = useCallback(async () => {
    if (!file) return;
    setStage("processing");

    try {
      const res = await rotateImage(file, {
        rotation,
        flipHorizontal: flipH,
        flipVertical: flipV,
        onProgress: (u) =>
          setProgress({ progress: u.progress, stage: u.stage }),
      });
      setDoneData({
        blob: res.blob,
        previewUrl: res.previewUrl,
        originalSize: res.originalSize,
        processedSize: res.processedSize,
        newWidth: res.width,
        newHeight: res.height,
      });
      setStage("done");
    } catch (err) {
      console.error("Rotate failed:", err);
      setStage("editor");
      alert("Failed to process the image. Please try again.");
    }
  }, [file, rotation, flipH, flipV]);

  // ---- Enter crop mode ----
  const handleEnterCropMode = useCallback(async () => {
    if (!file) return;

    // If no transforms, use original file directly (avoid re-encoding)
    if (!hasTransform) {
      const url = imageUrl;
      setTransformedFile(file);
      setTransformedUrl(url);
      setTransformedSize({
        width: naturalSize.width,
        height: naturalSize.height,
      });
      setStage("crop");
      return;
    }

    setCropLoading(true);
    try {
      const res = await rotateImage(file, {
        rotation,
        flipHorizontal: flipH,
        flipVertical: flipV,
      });
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const tf = new File([res.blob], `transformed.${ext}`, {
        type: res.blob.type,
      });
      setTransformedFile(tf);
      setTransformedUrl(res.previewUrl);
      setTransformedSize({ width: res.width, height: res.height });
      setStage("crop");
    } catch (err) {
      console.error("Transform failed:", err);
      alert("Failed to prepare image for cropping.");
    }
    setCropLoading(false);
  }, [file, hasTransform, imageUrl, naturalSize, rotation, flipH, flipV]);

  // ---- Helper: check if crop area is full image (no actual crop needed) ----
  const isFullCrop = useCallback(
    (ca: CropArea, w: number, h: number) =>
      ca.x === 0 && ca.y === 0 && ca.width === w && ca.height === h,
    []
  );

  // ---- Crop: apply crop, stay in crop view, update image ----
  const handleCropPreview = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!transformedFile) return;
      if (isFullCrop(cropArea, transformedSize.width, transformedSize.height))
        return;

      setCropLoading(true);
      try {
        const res = await cropImage(
          transformedFile,
          { cropArea, rotation: cropRotation }
        );
        // Revoke old transformed URL (unless it's the original imageUrl)
        if (transformedUrl && transformedUrl !== imageUrl) {
          URL.revokeObjectURL(transformedUrl);
        }
        const ext = file?.name.split(".").pop()?.toLowerCase() || "jpg";
        const newFile = new File([res.blob], `cropped.${ext}`, {
          type: res.blob.type,
        });
        setTransformedFile(newFile);
        setTransformedUrl(res.previewUrl);
        setTransformedSize({
          width: res.croppedWidth,
          height: res.croppedHeight,
        });
      } catch (err) {
        console.error("Crop failed:", err);
        alert("Failed to crop the image. Please try again.");
      }
      setCropLoading(false);
    },
    [transformedFile, transformedSize, transformedUrl, imageUrl, file, isFullCrop]
  );

  // ---- Rotate Image: apply crop, go back to rotate editor ----
  const handleApplyAndRotate = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!transformedFile || !file) return;

      // If no actual crop, just go back with current transformed image
      const noActualCrop = isFullCrop(
        cropArea,
        transformedSize.width,
        transformedSize.height
      );

      setCropLoading(true);
      try {
        let newBlob: Blob;
        let newW: number;
        let newH: number;
        let newPreviewUrl: string;

        if (noActualCrop) {
          // Use transformed image as-is
          newBlob = await transformedFile.arrayBuffer().then(
            (buf) => new Blob([buf], { type: transformedFile.type })
          );
          newW = transformedSize.width;
          newH = transformedSize.height;
          newPreviewUrl = transformedUrl;
        } else {
          const res = await cropImage(transformedFile, {
            cropArea,
            rotation: cropRotation,
          });
          newBlob = res.blob;
          newW = res.croppedWidth;
          newH = res.croppedHeight;
          newPreviewUrl = res.previewUrl;
          // Revoke old transformed URL
          if (transformedUrl && transformedUrl !== imageUrl) {
            URL.revokeObjectURL(transformedUrl);
          }
        }

        // Update base image for rotate editor
        const newFile = new File([newBlob], file.name, { type: newBlob.type });
        if (imageUrl && imageUrl !== newPreviewUrl) {
          URL.revokeObjectURL(imageUrl);
        }
        setFile(newFile);
        setImageUrl(newPreviewUrl);
        setNaturalSize({ width: newW, height: newH });

        // Reset transforms (rotation/flip already baked into the image)
        setRotation(0);
        setFlipH(false);
        setFlipV(false);

        // Cleanup crop state
        setTransformedFile(null);
        setTransformedUrl("");
        setTransformedSize({ width: 0, height: 0 });
        setStage("editor");
      } catch (err) {
        console.error("Apply crop failed:", err);
        alert("Failed to apply crop.");
      }
      setCropLoading(false);
    },
    [transformedFile, transformedSize, transformedUrl, imageUrl, file, isFullCrop]
  );

  // ---- Download from crop view: apply crop, trigger download, update image ----
  const handleCropAndDownload = useCallback(
    async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
      if (!transformedFile || !file) return;

      setCropLoading(true);
      try {
        const noActualCrop = isFullCrop(
          cropArea,
          transformedSize.width,
          transformedSize.height
        );

        let downloadBlob: Blob;
        let newW: number;
        let newH: number;

        if (noActualCrop) {
          downloadBlob = transformedFile;
          newW = transformedSize.width;
          newH = transformedSize.height;
        } else {
          const res = await cropImage(transformedFile, {
            cropArea,
            rotation: cropRotation,
          });
          downloadBlob = res.blob;
          newW = res.croppedWidth;
          newH = res.croppedHeight;

          // Update crop view with cropped image
          if (transformedUrl && transformedUrl !== imageUrl) {
            URL.revokeObjectURL(transformedUrl);
          }
          const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
          const newFile = new File([res.blob], `cropped.${ext}`, {
            type: res.blob.type,
          });
          setTransformedFile(newFile);
          setTransformedUrl(res.previewUrl);
          setTransformedSize({ width: newW, height: newH });
        }

        // Trigger download
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const ext = getOutputExtension(file.name);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(downloadBlob);
        a.download = `${baseName}-edited.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (err) {
        console.error("Download failed:", err);
        alert("Failed to process the image for download.");
      }
      setCropLoading(false);
    },
    [transformedFile, transformedSize, transformedUrl, imageUrl, file, isFullCrop]
  );

  // ---- Download result ----
  const handleDownloadResult = useCallback(() => {
    if (!doneData || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const ext = getOutputExtension(file.name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(doneData.blob);
    a.download = `${baseName}-rotated.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [doneData, file]);

  // ---- Back to edit ----
  const handleBackToEdit = useCallback(() => {
    if (doneData?.previewUrl) URL.revokeObjectURL(doneData.previewUrl);
    if (transformedUrl && transformedUrl !== imageUrl) {
      URL.revokeObjectURL(transformedUrl);
    }
    setDoneData(null);
    setTransformedFile(null);
    setTransformedUrl("");
    setTransformedSize({ width: 0, height: 0 });
    setProgress({ progress: 0, stage: "" });
    setStage("editor");
  }, [doneData, transformedUrl, imageUrl]);

  // ---- Start over ----
  const handleReset = useCallback(() => {
    if (doneData?.previewUrl) URL.revokeObjectURL(doneData.previewUrl);
    if (transformedUrl && transformedUrl !== imageUrl) {
      URL.revokeObjectURL(transformedUrl);
    }
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setStage("upload");
    setFile(null);
    setImageUrl("");
    setNaturalSize({ width: 0, height: 0 });
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setTransformedFile(null);
    setTransformedUrl("");
    setTransformedSize({ width: 0, height: 0 });
    setProgress({ progress: 0, stage: "" });
    setDoneData(null);
  }, [doneData, transformedUrl, imageUrl]);

  // CSS transform string
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
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFileSelected}
          title="Select an image to rotate"
          subtitle="Supports JPG, JPEG, and PNG images up to 100MB"
        />
      )}

      {/* ---- Editor ---- */}
      {stage === "editor" && file && (
        <div className="w-full">
          {/* Image preview */}
          <div className="flex-1 min-w-0" ref={editorRef}>
            <div
              className="relative mx-auto select-none overflow-hidden rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
              style={{
                width: displayW * scale,
                height: displayH * scale,
              }}
            >
              <img
                src={imageUrl}
                alt="Source"
                draggable={false}
                className="pointer-events-none"
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: naturalSize.width * scale,
                  height: naturalSize.height * scale,
                  transform: cssTransform,
                }}
              />
            </div>

            {/* Info below image */}
            <div className="mt-3 flex items-center justify-center gap-4 text-sm text-slate-500">
              <span>
                {displayW} &times; {displayH}px
              </span>
              {hasTransform && (
                <span className="text-orange-600 font-medium">Modified</span>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {/* Rotate 90 CW */}
            <button
              onClick={handleRotateCW}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
              90&deg; CW
            </button>

            {/* Rotate 90 CCW */}
            <button
              onClick={handleRotateCCW}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
              90&deg; CCW
            </button>

            {/* Rotate 180 */}
            <button
              onClick={handleRotate180}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                <path d="M2.5 22v-6h6M2.66 8.43a10 10 0 0 1 .57 8.38" />
              </svg>
              180&deg;
            </button>

            {/* Flip Horizontal */}
            <button
              onClick={handleFlipH}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                <polyline points="8 12 4 12" />
                <polyline points="16 12 20 12" />
              </svg>
              Flip H
            </button>

            {/* Flip Vertical */}
            <button
              onClick={handleFlipV}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                <polyline points="12 8 12 4" />
                <polyline points="12 16 12 20" />
              </svg>
              Flip V
            </button>

            {/* Reset All */}
            <button
              onClick={handleResetAll}
              disabled={!hasTransform}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-lg transition-colors ${
                hasTransform
                  ? "border-slate-200 hover:bg-slate-50 text-slate-700"
                  : "border-slate-100 text-slate-300 cursor-not-allowed"
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
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Reset All
            </button>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
            <button
              onClick={handleDownload}
              disabled={!hasTransform}
              className={`w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 font-semibold rounded-xl transition-colors text-sm ${
                hasTransform
                  ? "bg-accent-500 text-white hover:bg-accent-600 active:bg-accent-700 shadow-md shadow-accent-500/25"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
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
              onClick={handleEnterCropMode}
              disabled={cropLoading}
              className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 text-accent-600 font-semibold rounded-xl border border-accent-200 hover:bg-accent-50 transition-colors text-sm"
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
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h2" />
                <path d="M18 22l3-4V4a2 2 0 0 0-2-2h-2" />
                <rect x="7" y="6" width="10" height="12" rx="1" />
              </svg>
              {cropLoading ? "Preparing..." : "Crop Image"}
            </button>
          </div>
        </div>
      )}

      {/* ---- Crop mode (embedded) ---- */}
      {stage === "crop" && transformedFile && (
        <CropEditor
          imageUrl={transformedUrl}
          naturalWidth={transformedSize.width}
          naturalHeight={transformedSize.height}
          showRotation={false}
          onCrop={handleCropPreview}
          actionLabel="Crop"
          onNavigateRotate={handleApplyAndRotate}
          onDownload={handleCropAndDownload}
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
            Image transformed!
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Your image is ready to download.
          </p>

          {/* Preview */}
          <div className="mb-6 rounded-xl overflow-hidden border border-slate-100 shadow-sm">
            <img
              src={doneData.previewUrl}
              alt="Result"
              className="w-full max-h-72 object-contain bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
            />
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Original</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(doneData.originalSize)}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {naturalSize.width} &times; {naturalSize.height}
              </p>
            </div>
            <div className="p-3 bg-orange-50 rounded-xl">
              <p className="text-xs text-orange-600 mb-1">Transformed</p>
              <p className="text-sm font-semibold text-orange-700">
                {formatFileSize(doneData.processedSize)}
              </p>
              <p className="text-xs text-orange-600 mt-0.5">
                {doneData.newWidth} &times; {doneData.newHeight}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Format</p>
              <p className="text-sm font-semibold text-slate-900">
                {getOutputExtension(file.name).toUpperCase()}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Max quality</p>
            </div>
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
              Your image was processed entirely in your browser. No data was
              uploaded to any server. The output preserves the original format
              and maximum quality.
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
              onClick={handleReset}
              className="flex-1 px-4 py-3 text-slate-600 font-semibold rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors text-sm"
            >
              Rotate Another Image
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
              desc: "Select a JPEG or PNG image you want to transform.",
            },
            {
              step: "2",
              title: "Transform",
              desc: "Rotate, flip, or combine multiple transformations with live preview.",
            },
            {
              step: "3",
              title: "Crop (Optional)",
              desc: "Fine-tune your image with the integrated crop tool.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Save your transformed image. Format and quality are fully preserved.",
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
