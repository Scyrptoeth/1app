"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { HowItWorks } from "@/components/HowItWorks";
import { getToolById } from "@/config/tools";
import {
  convertPdfToImages,
  type ProcessingUpdate,
  type PdfToImageResult,
  type PageImage,
} from "@/lib/tools/pdf-to-image";

type Stage = "upload" | "processing" | "done";

export default function PdfToImagePage() {
  const tool = getToolById("pdf-to-image")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    stage: "",
    progress: 0,
  });
  const [result, setResult] = useState<PdfToImageResult | null>(null);
  const [modalPage, setModalPage] = useState<PageImage | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const processingResult = await convertPdfToImages(
        arrayBuffer,
        selectedFile.name,
        (update) => setProgress(update)
      );
      setResult(processingResult);
      setStage("done");
    } catch (err) {
      console.error("PDF to image conversion failed:", err);
      setStage("upload");
      alert(
        "Failed to process the PDF. The file may be encrypted, corrupted, or unsupported. Please try a different file."
      );
    }
  }, []);

  const handleDownloadSingle = useCallback((page: PageImage, baseName: string) => {
    const a = document.createElement("a");
    a.href = page.previewUrl;
    a.download = `page-${page.pageNumber}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (!result || !file) return;
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const baseName = file.name.replace(/\.pdf$/i, "");

    for (const page of result.pages) {
      zip.file(`page-${page.pageNumber}.png`, page.blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${baseName}-images.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const handleReset = useCallback(() => {
    // Revoke preview URLs to free memory
    if (result) {
      result.pages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    }
    setStage("upload");
    setFile(null);
    setProgress({ stage: "", progress: 0 });
    setResult(null);
    setModalPage(null);
  }, [result]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const baseName = file ? file.name.replace(/\.pdf$/i, "") : "";

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".pdf"]}
          maxSizeMB={100}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a PDF to convert to images"
          subtitle="Supports multi-page PDF documents"
        />
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.stage}
        />
      )}

      {stage === "done" && result && file && (
        <div className="w-full">
          {/* Result Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Converted Images
              </h3>
              <p className="text-sm text-slate-500">
                {result.totalPages} page{result.totalPages > 1 ? "s" : ""} converted — review before downloading
              </p>
            </div>
            <div className="flex items-center gap-3">
              {result.pages.length > 1 ? (
                <button
                  onClick={handleDownloadAll}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download All as ZIP
                </button>
              ) : (
                <button
                  onClick={() => handleDownloadSingle(result.pages[0], baseName)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download PNG
                </button>
              )}
              <button
                onClick={handleReset}
                className="px-5 py-2.5 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Process Another
              </button>
            </div>
          </div>

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
              <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 ${badgeClass}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  {label}
                </span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Output quality depends on the source PDF resolution. Vector-based PDFs produce the sharpest images.
                </p>
              </div>
            );
          })()}

          {/* Info Notice */}
          <div className="mb-6 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Output quality depends on the source PDF resolution. Vector-based PDFs produce the sharpest images.
            </p>
          </div>

          {/* Page Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            {result.pages.map((page) => (
              <div key={page.pageNumber} className="border border-slate-200 rounded-xl overflow-hidden bg-white hover:shadow-md transition-shadow">
                {/* Thumbnail */}
                <button
                  className="w-full aspect-[3/4] bg-slate-50 overflow-hidden cursor-zoom-in"
                  onClick={() => setModalPage(page)}
                  title="Click to view full size"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`Page ${page.pageNumber}`}
                    className="w-full h-full object-contain"
                  />
                </button>
                {/* Page Info */}
                <div className="px-3 py-2 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Page {page.pageNumber}
                    </span>
                    <button
                      onClick={() => handleDownloadSingle(page, baseName)}
                      className="text-xs text-accent-600 hover:text-accent-700 font-medium"
                    >
                      Download
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {page.width}×{page.height} · {formatFileSize(page.fileSize)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-center gap-6 text-sm text-slate-500">
            <span>
              {result.totalPages} page{result.totalPages > 1 ? "s" : ""} converted
            </span>
            <span className="text-slate-300">|</span>
            <span>
              Total size:{" "}
              {formatFileSize(result.pages.reduce((sum, p) => sum + p.fileSize, 0))}
            </span>
          </div>
        </div>
      )}

      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload PDF",
            desc: "Select any PDF document, including reports, presentations, scanned pages, or multi-page files.",
          },
          {
            step: "2",
            title: "High-Quality Render",
            desc: "Each page is rendered at 2x resolution for crisp, clear PNG output suitable for printing or digital sharing.",
          },
          {
            step: "3",
            title: "Preview and Inspect",
            desc: "Browse all converted images in a grid. Click any thumbnail to view it full-size, and check resolution and file size per page.",
          },
          {
            step: "4",
            title: "Download Images",
            desc: "Download individual pages as PNG or grab all pages as a single ZIP file. All processing happens in your browser.",
          },
        ]}
      />

      {/* Full-size Modal */}
      {modalPage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalPage(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700">
                Page {modalPage.pageNumber} — {modalPage.width}×{modalPage.height} · {formatFileSize(modalPage.fileSize)}
              </span>
              <button
                onClick={() => setModalPage(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="overflow-auto max-h-[calc(90vh-60px)] bg-slate-50 flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={modalPage.previewUrl}
                alt={`Page ${modalPage.pageNumber} full size`}
                className="max-w-full h-auto shadow-md"
              />
            </div>
          </div>
        </div>
      )}
    </ToolPageLayout>
  );
}
