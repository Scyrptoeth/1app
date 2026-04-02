"use client";

import { useState, useCallback, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import InputModeToggle, { type InputMode } from "@/components/InputModeToggle";
import CameraCapture from "@/components/CameraCapture";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  removeImageWatermark,
  type ProcessingUpdate,
  type ProcessingResult,
} from "@/lib/tools/image-watermark-remover";

type Stage = "upload" | "processing" | "done";

export default function ImageWatermarkRemovePage() {
  const tool = getToolById("image-watermark-remove")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [hasCameraSupport, setHasCameraSupport] = useState(false);

  useEffect(() => {
    setHasCameraSupport(
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      !!navigator.mediaDevices.getUserMedia
    );
  }, []);

  const processFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setStage("processing");

    try {
      const processingResult = await removeImageWatermark(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      console.error("Processing failed:", err);
      setStage("upload");
      alert(
        "Failed to process the image. Please try again with a different file."
      );
    }
  }, []);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    processFile(files[0]);
  }, [processFile]);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;

    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outputName = `${baseName}-no-watermark.${ext}`;

    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = outputName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const handleReset = useCallback(() => {
    if (result?.previewUrl) {
      URL.revokeObjectURL(result.previewUrl);
    }
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, [result]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <>
          <InputModeToggle
            mode={inputMode}
            onModeChange={setInputMode}
            hasCameraSupport={hasCameraSupport}
          />
          {inputMode === "file" ? (
            <FileUploader
              acceptedFormats={[".jpg", ".jpeg", ".png"]}
              maxSizeMB={50}
              multiple={false}
              onFilesSelected={handleFilesSelected}
              title="Select an image to remove watermark"
              subtitle="Supports JPG, JPEG, and PNG files"
            />
          ) : (
            <CameraCapture onCapture={processFile} />
          )}
        </>
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && file && (
        <>
          <DownloadView
            fileName={file.name.replace(/\.[^.]+$/, "") + "-no-watermark." + (file.name.split(".").pop()?.toLowerCase() || "png")}
            fileSize={formatFileSize(result.processedSize)}
            onDownload={handleDownload}
            onReset={handleReset}
            previewUrl={result.previewUrl}
          />

          {/* Data Quality */}
          {(() => {
            const score = result.qualityScore;
            const label =
              score >= 80
                ? `Data Quality: High (${score}%)`
                : score >= 50
                ? `Data Quality: Medium (${score}%)`
                : `Data Quality: Low (${score}%)`;
            const badgeClass =
              score >= 80
                ? "bg-emerald-50 text-emerald-700"
                : score >= 50
                ? "bg-amber-50 text-amber-700"
                : "bg-red-50 text-red-700";
            return (
              <div className="mt-4 mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {label}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Percentage of the image where watermark was successfully detected and removed.
                </p>
              </div>
            );
          })()}

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Removal quality depends on watermark type and opacity. Semi-transparent text watermarks produce the best results.
            </p>
          </div>
        </>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          How it works
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Upload or Capture",
              desc: "Select a JPG, JPEG, or PNG image with a watermark, or take a photo with your camera.",
            },
            {
              step: "2",
              title: "Auto-Detect & Remove",
              desc: "Our algorithm detects and removes semi-transparent watermark overlays.",
            },
            {
              step: "3",
              title: "Download",
              desc: "Download your clean image in the same format as the original.",
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
