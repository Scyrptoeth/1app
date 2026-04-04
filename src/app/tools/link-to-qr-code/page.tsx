"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import ProcessingView from "@/components/ProcessingView";
import { getToolById } from "@/config/tools";
import {
  generateQrCode,
  generatePreview,
  getContrastWarning,
  FRAME_TYPES,
  FRAME_LABELS,
  type FrameType,
  type QrGenerateOptions,
  type QrGenerateResult,
  type ProcessingUpdate,
} from "@/lib/tools/link-to-qr-code";

type Stage = "input" | "processing" | "done";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Mini QR icon for frame thumbnails
function FramePreviewIcon({ frame, dotColor, bgColor }: { frame: FrameType; dotColor: string; bgColor: string }) {
  const hasText = ["simple-text", "rounded-text", "bold-text", "badge", "banner"].includes(frame);
  const isRounded = ["rounded", "rounded-text"].includes(frame);
  const isBold = ["bold", "bold-text"].includes(frame);
  const isShadow = frame === "shadow";
  const isBadge = frame === "badge";
  const isBanner = frame === "banner";

  return (
    <div className="w-full aspect-square flex items-center justify-center p-1">
      <svg viewBox="0 0 60 72" className="w-full h-full">
        {/* Background */}
        <rect x="0" y="0" width="60" height={hasText ? "72" : "60"} fill={bgColor} rx={isRounded || isShadow ? "4" : "0"} />

        {/* Shadow */}
        {isShadow && (
          <rect x="3" y="3" width="54" height="54" fill="rgba(0,0,0,0.1)" rx="4" />
        )}

        {/* Border */}
        {frame !== "none" && !isBanner && (
          <rect
            x="2" y="2"
            width="56" height={hasText ? "52" : "56"}
            fill="none"
            stroke={dotColor}
            strokeWidth={isBold ? "3" : "1.5"}
            rx={isRounded || isShadow ? "4" : "0"}
          />
        )}

        {/* QR dots pattern (simplified) */}
        {[
          [14, 14, 10, 10], [36, 14, 10, 10], [14, 36, 10, 10],
          [26, 26, 8, 8], [36, 36, 10, 10],
          [28, 14, 4, 4], [14, 28, 4, 4], [20, 20, 4, 4],
          [34, 28, 4, 4], [28, 34, 4, 4], [42, 28, 4, 4],
        ].map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill={dotColor} />
        ))}

        {/* Text area */}
        {hasText && !isBadge && !isBanner && (
          <text x="30" y="64" textAnchor="middle" fill={dotColor} fontSize="8" fontWeight="bold">Scan me!</text>
        )}
        {isBadge && (
          <>
            <rect x="10" y="56" width="40" height="12" rx="6" fill={dotColor} />
            <text x="30" y="64.5" textAnchor="middle" fill={bgColor} fontSize="6" fontWeight="bold">SCAN ME</text>
          </>
        )}
        {isBanner && (
          <>
            <rect x="2" y="2" width="56" height="52" fill="none" stroke={dotColor} strokeWidth="1.5" />
            <rect x="2" y="54" width="56" height="18" fill={dotColor} />
            <text x="30" y="65.5" textAnchor="middle" fill={bgColor} fontSize="7" fontWeight="bold">Scan me!</text>
          </>
        )}
      </svg>
    </div>
  );
}

function ColorInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-40 pointer-events-none" : ""}>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v);
          }}
          maxLength={7}
          className="flex-1 px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
          disabled={disabled}
        />
        <input
          type="color"
          value={value.length === 7 ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export default function LinkToQrCodePage() {
  const tool = getToolById("link-to-qr-code")!;

  const [stage, setStage] = useState<Stage>("input");
  const [url, setUrl] = useState("");
  const [dotColor, setDotColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#FFFFFF");
  const [transparentBg, setTransparentBg] = useState(false);
  const [frameType, setFrameType] = useState<FrameType>("none");
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, status: "" });
  const [result, setResult] = useState<QrGenerateResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [contrastWarning, setContrastWarning] = useState<string | null>(null);

  const previewTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const prevPreviewUrlRef = useRef<string | null>(null);

  // Update live preview with debounce
  useEffect(() => {
    if (!url.trim()) {
      if (prevPreviewUrlRef.current) {
        URL.revokeObjectURL(prevPreviewUrlRef.current);
        prevPreviewUrlRef.current = null;
      }
      setPreviewUrl(null);
      return;
    }

    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);

    previewTimerRef.current = setTimeout(async () => {
      try {
        const newUrl = await generatePreview({
          url,
          dotColor: dotColor.length === 7 ? dotColor : "#000000",
          bgColor: bgColor.length === 7 ? bgColor : "#FFFFFF",
          transparentBg,
          frameType,
        });
        if (prevPreviewUrlRef.current) {
          URL.revokeObjectURL(prevPreviewUrlRef.current);
        }
        prevPreviewUrlRef.current = newUrl;
        setPreviewUrl(newUrl);
      } catch {
        // Preview generation failed — silently ignore
      }
    }, 200);

    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, [url, dotColor, bgColor, transparentBg, frameType]);

  // Update contrast warning
  useEffect(() => {
    if (transparentBg || dotColor.length !== 7 || bgColor.length !== 7) {
      setContrastWarning(null);
      return;
    }
    setContrastWarning(getContrastWarning(dotColor, bgColor));
  }, [dotColor, bgColor, transparentBg]);

  const handleGenerate = useCallback(async () => {
    if (!url.trim()) return;

    setStage("processing");
    setProgress({ progress: 0, status: "" });

    try {
      const genResult = await generateQrCode(
        {
          url: url.trim(),
          dotColor: dotColor.length === 7 ? dotColor : "#000000",
          bgColor: bgColor.length === 7 ? bgColor : "#FFFFFF",
          transparentBg,
          frameType,
        },
        (update) => setProgress(update)
      );
      setResult(genResult);
      setStage("done");
    } catch (err) {
      console.error("QR generation failed:", err);
      setStage("input");
      alert("Failed to generate QR code. Please try again.");
    }
  }, [url, dotColor, bgColor, transparentBg, frameType]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.previewUrl;
    a.download = `qr-code-${Date.now()}.png`;
    a.click();
  }, [result]);

  const handleBackToEdit = useCallback(() => {
    setStage("input");
    // Keep all settings — don't reset
  }, []);

  const handleReset = useCallback(() => {
    setStage("input");
    setUrl("");
    setDotColor("#000000");
    setBgColor("#FFFFFF");
    setTransparentBg(false);
    setFrameType("none");
    setResult(null);
    setProgress({ progress: 0, status: "" });
    if (prevPreviewUrlRef.current) {
      URL.revokeObjectURL(prevPreviewUrlRef.current);
      prevPreviewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  const handleSwapColors = useCallback(() => {
    const tmpDot = dotColor;
    setDotColor(bgColor);
    setBgColor(tmpDot);
  }, [dotColor, bgColor]);

  return (
    <ToolPageLayout tool={tool}>
      {stage === "input" && (
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left: controls */}
          <div className="flex-1 min-w-0">
            {/* URL input */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-900 mb-2">
                Enter URL or text
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500 placeholder:text-slate-400"
                autoFocus
              />
            </div>

            {/* Frame selection */}
            <div className="mb-6">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={(e) => {
                  const section = (e.currentTarget as HTMLElement).nextElementSibling;
                  section?.classList.toggle("hidden");
                  const arrow = (e.currentTarget as HTMLElement).querySelector("[data-arrow]");
                  arrow?.classList.toggle("rotate-180");
                }}
              >
                <span className="text-sm font-semibold text-slate-900">QR Code Frame</span>
                <svg data-arrow="" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 transition-transform">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div className="mt-3">
                <div className="grid grid-cols-5 gap-2">
                  {FRAME_TYPES.map((ft) => (
                    <button
                      key={ft}
                      onClick={() => setFrameType(ft)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                        frameType === ft
                          ? "border-accent-500 bg-accent-50"
                          : "border-slate-100 hover:border-slate-300 bg-white"
                      }`}
                      title={FRAME_LABELS[ft]}
                    >
                      {ft === "none" ? (
                        <div className="w-full aspect-square flex items-center justify-center">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                          </svg>
                        </div>
                      ) : (
                        <FramePreviewIcon
                          frame={ft}
                          dotColor={dotColor.length === 7 ? dotColor : "#000000"}
                          bgColor={bgColor.length === 7 ? bgColor : "#FFFFFF"}
                        />
                      )}
                      <span className="text-[10px] text-slate-500 leading-tight text-center">
                        {FRAME_LABELS[ft]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Color customization */}
            <div className="mb-6">
              <button
                type="button"
                className="flex items-center justify-between w-full text-left"
                onClick={(e) => {
                  const section = (e.currentTarget as HTMLElement).nextElementSibling;
                  section?.classList.toggle("hidden");
                  const arrow = (e.currentTarget as HTMLElement).querySelector("[data-arrow]");
                  arrow?.classList.toggle("rotate-180");
                }}
              >
                <span className="text-sm font-semibold text-slate-900">QR Code Color</span>
                <svg data-arrow="" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 transition-transform">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div className="mt-3 space-y-4">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <ColorInput label="Dot color" value={dotColor} onChange={setDotColor} />
                  </div>
                  <button
                    onClick={handleSwapColors}
                    className="flex items-center justify-center w-9 h-9 mb-0.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                    title="Swap colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
                      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>
                  <div className="flex-1">
                    <ColorInput
                      label="Background color"
                      value={bgColor}
                      onChange={setBgColor}
                      disabled={transparentBg}
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transparentBg}
                    onChange={(e) => setTransparentBg(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                  />
                  <span className="text-sm text-slate-600">Transparent background</span>
                </label>

                {contrastWarning && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-500 shrink-0 mt-0.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <p className="text-xs text-amber-700">{contrastWarning}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={!url.trim()}
              className="w-full px-6 py-3.5 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-md shadow-accent-500/25"
            >
              Generate QR Code
            </button>
          </div>

          {/* Right: live preview */}
          <div className="lg:w-72 shrink-0">
            <p className="text-xs font-medium text-slate-500 mb-3">Live Preview</p>
            <div className="relative w-full aspect-square bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center overflow-hidden">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="QR Code preview"
                  className="w-4/5 h-4/5 object-contain"
                />
              ) : (
                <div className="text-center px-4">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300 mx-auto mb-2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  <p className="text-xs text-slate-400">
                    Enter a URL to see a preview
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {stage === "processing" && (
        <ProcessingView
          fileName="QR Code"
          progress={progress.progress}
          status={progress.status}
        />
      )}

      {stage === "done" && result && (
        <>
          <div className="w-full max-w-lg mx-auto text-center">
            {/* Success icon */}
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1">QR Code generated!</h3>
            <p className="text-sm text-slate-500 mb-6">Your QR code is ready to download.</p>

            {/* QR preview */}
            <div className="w-64 h-64 mx-auto mb-6 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden p-4">
              <img
                src={result.previewUrl}
                alt="Generated QR Code"
                className="w-full h-full object-contain"
              />
            </div>

            {/* File info card */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">qr-code-{Date.now()}.png</p>
                <p className="text-xs text-slate-500">{formatFileSize(result.fileSize)}</p>
              </div>
            </div>

            {/* 3 action buttons — equal width */}
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
                onClick={handleBackToEdit}
                className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Back to Edit
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Process Another
              </button>
            </div>
          </div>

          {/* Data Quality badge */}
          <div className="max-w-lg mx-auto mt-6 flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0 bg-emerald-50 text-emerald-700">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
              High Quality (1024px)
            </span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Error correction level H — scannable even if partially obscured.
            </p>
          </div>

          {/* Info Notice */}
          <div className="max-w-lg mx-auto mt-3 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              All processing happens in your browser. No data is sent to any server.
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
              title: "Enter URL",
              desc: "Type or paste a URL or text that you want to encode.",
            },
            {
              step: "2",
              title: "Customize",
              desc: "Choose a frame style, dot color, and background color.",
            },
            {
              step: "3",
              title: "Generate",
              desc: "Click generate to create a high-quality PNG QR code.",
            },
            {
              step: "4",
              title: "Download",
              desc: "Download the QR code image and use it anywhere.",
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
