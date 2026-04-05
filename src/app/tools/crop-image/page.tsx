"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import CropEditor from "@/components/CropEditor";
import { HowItWorks } from "@/components/HowItWorks";
import { getToolById } from "@/config/tools";
import {
  cropImage,
  type CropArea,
  type CropImageResult,
} from "@/lib/tools/crop-image";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Stage = "upload" | "editor" | "processing" | "done";

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

export default function CropImagePage() {
  const tool = getToolById("crop-image")!;

  // Stage
  const [stage, setStage] = useState<Stage>("upload");

  // File & image
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  // Processing & result
  const [progress, setProgress] = useState({ progress: 0, stage: "" });
  const [result, setResult] = useState<CropImageResult | null>(null);

  // ---- File selection ----
  const handleFileSelected = useCallback((files: File[]) => {
    const f = files[0];
    setFile(f);
    const url = URL.createObjectURL(f);
    setImageUrl(url);

    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setStage("editor");
    };
    img.src = url;
  }, []);

  // ---- Crop (called by CropEditor) ----
  const handleCrop = useCallback(
    async (cropArea: CropArea, rotation: 0 | 90 | 180 | 270) => {
      if (!file) return;
      setStage("processing");

      try {
        const res = await cropImage(file, { cropArea, rotation }, (u) =>
          setProgress({ progress: u.progress, stage: u.stage })
        );
        setResult(res);
        setStage("done");
      } catch (err) {
        console.error("Crop failed:", err);
        setStage("editor");
        alert("Failed to crop the image. Please try again.");
      }
    },
    [file]
  );

  // ---- Download ----
  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const ext = getOutputExtension(file.name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `${baseName}-cropped.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  // ---- Back to editor (keep file, reset result) ----
  const handleBackToEdit = useCallback(() => {
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    setResult(null);
    setProgress({ progress: 0, stage: "" });
    setStage("editor");
  }, [result]);

  // ---- Reset (back to upload) ----
  const handleReset = useCallback(() => {
    if (result?.previewUrl) URL.revokeObjectURL(result.previewUrl);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setStage("upload");
    setFile(null);
    setImageUrl("");
    setNaturalSize({ width: 0, height: 0 });
    setProgress({ progress: 0, stage: "" });
    setResult(null);
  }, [result, imageUrl]);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <ToolPageLayout tool={tool}>
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload Image",
            desc: "Select a JPEG or PNG image you want to crop. Files up to 100 MB are supported.",
          },
          {
            step: "2",
            title: "Adjust Crop Area",
            desc: "Drag the selection, resize handles, pick an aspect ratio preset, or rotate the image before cropping.",
          },
          {
            step: "3",
            title: "Crop",
            desc: "Click \"Crop IMAGE\" to apply. The original format and maximum quality are preserved.",
          },
          {
            step: "4",
            title: "Download",
            desc: "Preview the result and download your cropped image. All processing happens locally in your browser.",
          },
        ]}
      />

      {/* ---- Upload ---- */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFileSelected}
          title="Select an image to crop"
          subtitle="Supports JPG, JPEG, and PNG images up to 100MB"
        />
      )}

      {/* ---- Editor (CropEditor component) ---- */}
      {stage === "editor" && file && (
        <CropEditor
          imageUrl={imageUrl}
          naturalWidth={naturalSize.width}
          naturalHeight={naturalSize.height}
          showRotation={true}
          onCrop={handleCrop}
          actionLabel="Crop IMAGE"
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
      {stage === "done" && result && file && (
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
            Image cropped!
          </h3>
          <p className="text-sm text-slate-500 mb-6">
            Your cropped image is ready to download.
          </p>

          {/* Preview */}
          <div className="mb-6 rounded-xl overflow-hidden border border-slate-100 shadow-sm">
            <img
              src={result.previewUrl}
              alt="Cropped result"
              className="w-full max-h-72 object-contain bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
            />
          </div>

          {/* Stats */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Original</p>
              <p className="text-sm font-semibold text-slate-900">
                {formatFileSize(result.originalSize)}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {result.originalWidth} &times; {result.originalHeight}
              </p>
            </div>
            <div className="p-3 bg-amber-50 rounded-xl">
              <p className="text-xs text-amber-600 mb-1">Cropped</p>
              <p className="text-sm font-semibold text-amber-700">
                {formatFileSize(result.croppedSize)}
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                {result.croppedWidth} &times; {result.croppedHeight}
              </p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl">
              <p className="text-xs text-slate-400 mb-1">Format</p>
              <p className="text-sm font-semibold text-slate-900">
                {result.format.toUpperCase()}
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

          {/* Actions - 3 buttons, same size, 1 row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleDownload}
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
              Crop Another Image
            </button>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}
