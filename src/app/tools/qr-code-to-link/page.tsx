"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { HowItWorks } from "@/components/HowItWorks";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import InputModeToggle, { type InputMode } from "@/components/InputModeToggle";
import { getToolById } from "@/config/tools";
import {
  decodeQrFromImage,
  decodeQrFromVideoFrame,
  type ProcessingUpdate,
  type QrDecodeResult,
  type DecodedQr,
} from "@/lib/tools/qr-code-to-link";

type Stage = "upload" | "processing" | "done";

// --- Shared sub-components ---

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
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

// --- Camera Scanner Component ---

interface CameraScannerProps {
  onResult: (result: QrDecodeResult) => void;
  onProcessing: (file: File) => void;
}

function CameraScanner({ onResult, onProcessing }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number>(0);

  const [cameraState, setCameraState] = useState<
    "initializing" | "active" | "error" | "permission-denied"
  >("initializing");
  const [errorMessage, setErrorMessage] = useState("");
  const [scanStatus, setScanStatus] = useState("Initializing camera...");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    stopCamera();
    setCameraState("initializing");
    setScanStatus("Initializing camera...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState("active");
        setScanStatus("Point camera at a QR code");
      }
    } catch (err) {
      const error = err as DOMException;
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        setCameraState("permission-denied");
        setErrorMessage("Camera access denied. Please allow camera access in your browser settings.");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setCameraState("error");
        setErrorMessage("No camera found on this device.");
      } else {
        setCameraState("error");
        setErrorMessage("Could not access camera. Please try again.");
      }
    }
  }, [stopCamera]);

  // Live scanning loop
  useEffect(() => {
    if (cameraState !== "active") return;

    let scanning = true;

    const scanFrame = async () => {
      if (!scanning || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(video, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      try {
        const decoded = await decodeQrFromVideoFrame(imageData);
        if (decoded && scanning) {
          scanning = false;
          stopCamera();
          onResult({
            codes: [decoded],
            totalFound: 1,
            originalSize: 0,
            qualityScore: 100,
          });
          return;
        }
      } catch {
        // jsQR not loaded yet or decode error — continue scanning
      }

      if (scanning) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    // Scan at ~15fps to balance CPU and responsiveness
    const intervalId = setInterval(() => {
      if (scanning) scanFrame();
    }, 66);

    return () => {
      scanning = false;
      clearInterval(intervalId);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [cameraState, stopCamera, onResult]);

  // Start camera on mount
  useEffect(() => {
    startCamera(facingMode);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSwitchCamera = useCallback(() => {
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    startCamera(newFacing);
  }, [facingMode, startCamera]);

  const handleManualCapture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);

    stopCamera();

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
        onProcessing(file);
      }
    }, "image/jpeg", 0.92);
  }, [stopCamera, onProcessing]);

  if (cameraState === "permission-denied") {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 mb-3">
          <path d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
        <p className="text-sm font-medium text-slate-700 mb-1">Camera access denied</p>
        <p className="text-xs text-slate-500 text-center mb-4">{errorMessage}</p>
        <button
          onClick={() => startCamera(facingMode)}
          className="px-4 py-2 text-xs font-medium text-white bg-accent-600 rounded-lg hover:bg-accent-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (cameraState === "error") {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 mb-3">
          <path d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
        </svg>
        <p className="text-sm font-medium text-slate-700 mb-1">Camera unavailable</p>
        <p className="text-xs text-slate-500 text-center">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Camera viewport */}
      <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3]">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* Scanning overlay */}
        {cameraState === "active" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Scan frame corners */}
            <div className="w-56 h-56 sm:w-64 sm:h-64 relative">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-white rounded-tl-lg" />
              <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-white rounded-tr-lg" />
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-white rounded-bl-lg" />
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-white rounded-br-lg" />
              {/* Animated scan line */}
              <div className="absolute left-2 right-2 h-0.5 bg-accent-400/80 animate-scan-line" />
            </div>
          </div>
        )}

        {/* Initializing overlay */}
        {cameraState === "initializing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex flex-col items-center gap-2">
              <svg className="animate-spin w-8 h-8 text-white" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-xs text-white/80">Starting camera...</p>
            </div>
          </div>
        )}
      </div>

      {/* Status + controls */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{scanStatus}</p>
        <div className="flex items-center gap-2">
          {/* Switch camera */}
          <button
            onClick={handleSwitchCamera}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            title="Switch camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
              <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
              <polyline points="16 3 19 6 16 9" />
              <polyline points="8 21 5 18 8 15" />
            </svg>
            Flip
          </button>
          {/* Manual capture */}
          <button
            onClick={handleManualCapture}
            disabled={cameraState !== "active"}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-accent-600 rounded-lg hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="13" r="4" />
              <path d="M9.5 3h5l1.5 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4Z" />
            </svg>
            Capture
          </button>
        </div>
      </div>

      {/* Hidden canvas for frame extraction */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// --- Main Page ---

export default function QrCodeToLinkPage() {
  const tool = getToolById("qr-code-to-link")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ProcessingUpdate>({
    progress: 0,
    status: "",
  });
  const [result, setResult] = useState<QrDecodeResult | null>(null);
  const [hasCameraSupport, setHasCameraSupport] = useState(false);

  // Check camera support on mount
  useEffect(() => {
    setHasCameraSupport(
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      !!navigator.mediaDevices.getUserMedia
    );
  }, []);

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

  const handleCameraResult = useCallback((qrResult: QrDecodeResult) => {
    setResult(qrResult);
    setStage("done");
  }, []);

  const handleCameraCapture = useCallback(async (capturedFile: File) => {
    setFile(capturedFile);
    setStage("processing");

    try {
      const decodeResult = await decodeQrFromImage(
        capturedFile,
        (update) => setProgress(update)
      );
      setResult(decodeResult);
      setStage("done");
    } catch (err) {
      console.error("QR decode failed:", err);
      setStage("upload");
      alert("Failed to process the captured image. Please try again.");
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
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Upload or Scan",
            desc: "Upload a PNG or JPG image containing a QR code, or use your device camera to scan one in real time.",
          },
          {
            step: "2",
            title: "Detect QR Codes",
            desc: "The decoder scans the image to locate all QR codes automatically.",
          },
          {
            step: "3",
            title: "Decode Content",
            desc: "Each detected QR code is decoded to extract the embedded URL or text data.",
          },
          {
            step: "4",
            title: "Copy or Open",
            desc: "Copy the decoded content to your clipboard or click to open URLs directly. All processing happens in your browser with no data sent to any server.",
          },
        ]}
      />

      {stage === "upload" && (
        <>
          <InputModeToggle
            mode={inputMode}
            onModeChange={setInputMode}
            hasCameraSupport={hasCameraSupport}
          />

          {inputMode === "file" && (
            <FileUploader
              acceptedFormats={[".jpg", ".jpeg", ".png"]}
              maxSizeMB={20}
              multiple={false}
              onFilesSelected={handleFilesSelected}
              title="Select a QR code image to decode"
              subtitle="Supports PNG, JPG, and JPEG images"
            />
          )}

          {inputMode === "camera" && (
            <CameraScanner
              onResult={handleCameraResult}
              onProcessing={handleCameraCapture}
            />
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

    </ToolPageLayout>
  );
}
