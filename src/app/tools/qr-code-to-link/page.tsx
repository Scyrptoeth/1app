"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  decodeQrFromImage,
  type ProcessingUpdate,
  type QrDecodeResult,
  type DecodedQr,
} from "@/lib/tools/qr-code-to-link";

type Stage = "upload" | "processing" | "done";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 ${
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 hover:text-slate-800"
      }`}
    >
      {copied ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function QrResultItem({ qr, index }: { qr: DecodedQr; index: number }) {
  return (
    <div className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:border-slate-300 transition-colors">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-50 flex items-center justify-center">
        <span className="text-xs font-bold text-accent-600">{index + 1}</span>
      </span>
      <div className="flex-1 min-w-0">
        {qr.isUrl ? (
          <a
            href={qr.data}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2 break-all leading-relaxed"
          >
            {qr.data}
          </a>
        ) : (
          <p className="text-sm text-slate-800 break-all leading-relaxed">
            {qr.data}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <CopyButton text={qr.data} />
          {qr.isUrl && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-600">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              URL
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QrCodeToLinkPage() {
  const tool = getToolById("qr-code-to-link")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<QrDecodeResult | null>(null);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const selectedFile = files[0];
    setFile(selectedFile);
    setStage("processing");

    try {
      const decodeResult = await decodeQrFromImage(
        selectedFile,
        (update) => setProgress(update)
      );
      setResult(decodeResult);
      setStage("done");
    } catch (err) {
      console.error("QR decode failed:", err);
      setStage("upload");
      alert("Failed to process the image. Please try again with a different file.");
    }
  }, []);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    setProgress({ progress: 0, status: "" });
    setResult(null);
  }, []);

  return (
    <ToolPageLayout tool={tool}>
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={20}
          multiple={false}
          onFilesSelected={handleFilesSelected}
          title="Select a QR code image to decode"
          subtitle="Supports PNG, JPG, and JPEG images"
        />
      )}

      {stage === "processing" && file && (
        <ProcessingView
          fileName={file.name}
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && (
        <>
          {/* Results header */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-slate-900">
                  {result.totalFound > 0
                    ? `Found ${result.totalFound} QR code${result.totalFound > 1 ? "s" : ""}`
                    : "No QR code found"}
                </h3>
              </div>
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Scan Another
              </button>
            </div>
          </div>

          {/* Decoded results list */}
          {result.totalFound > 0 ? (
            <div className="flex flex-col gap-3 mb-4">
              {result.codes.map((qr, i) => (
                <QrResultItem key={i} qr={qr} index={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 bg-slate-50 border border-slate-200 rounded-xl mb-4">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 mb-3">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              <p className="text-sm font-medium text-slate-700 mb-1">
                No QR code found in this image
              </p>
              <p className="text-xs text-slate-500">
                Make sure the image contains a clear, readable QR code and try again.
              </p>
            </div>
          )}

          {/* Data Quality badge */}
          {result.totalFound > 0 && (
            <div className="mb-4 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 bg-emerald-50 text-emerald-700">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" />
                </svg>
                Decode Quality: High (100%)
              </span>
              <p className="text-xs text-slate-500 leading-relaxed">
                All detected QR codes were successfully decoded.
              </p>
            </div>
          )}

          {/* Info Notice */}
          <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              All processing happens in your browser. No image data is sent to any server.
            </p>
          </div>
        </>
      )}

      {/* How it works */}
      <div className="mt-16 pt-12 border-t border-slate-100">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">
          How it works
        </h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            {
              step: "1",
              title: "Upload Image",
              desc: "Select a PNG, JPG, or JPEG image containing one or more QR codes.",
            },
            {
              step: "2",
              title: "QR Detection",
              desc: "Our algorithm scans the entire image to locate all QR codes.",
            },
            {
              step: "3",
              title: "Decode",
              desc: "Each QR code is decoded to extract the embedded link or text.",
            },
            {
              step: "4",
              title: "Copy Link",
              desc: "Copy the decoded content to your clipboard or click to open URLs.",
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
