"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
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
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<ProcessingResult | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
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
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={50}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select an image to remove watermark"
          subtitle="Supports JPG, JPEG, and PNG files"
        />
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && file && (
        <DownloadView
          fileName={file.name.replace(/\.[^.]+$/, "") + "-no-watermark." + (file.name.split(".").pop()?.toLowerCase() || "png")}
          fileSize={formatFileSize(result.processedSize)}
          onDownload={handleDownload}
          onReset={handleReset}
          previewUrl={result.previewUrl}
        />
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
              title: "Upload",
              desc: "Select a JPG, JPEG, or PNG image with a watermark.",
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
