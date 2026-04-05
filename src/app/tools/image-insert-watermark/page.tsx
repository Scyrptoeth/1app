"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import CropEditor from "@/components/CropEditor";
import { getToolById } from "@/config/tools";
import {
  insertImageWatermark,
  drawWatermarkOnCanvas,
  type WatermarkPosition,
  type WatermarkOptions,
  type TextWatermarkConfig,
  type ImageWatermarkConfig,
  type InsertImageWatermarkResult,
} from "@/lib/tools/image-insert-watermark";
import { rotateImage } from "@/lib/tools/rotate-image";
import { cropImage, type CropArea } from "@/lib/tools/crop-image";

// ─── Types ──────────────���────────────────────────────────────────────

type Stage = "upload" | "configure" | "crop" | "processing" | "done";

// ─── Font Registry (canvas-only — no pdf-lib deps) ──────────────────

interface CanvasFontDef {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "monospace" | "display";
  isBuiltIn: boolean;
  googleFamily?: string;
}

const FONT_REGISTRY: CanvasFontDef[] = [
  { id: "helvetica", name: "Helvetica", category: "sans-serif", isBuiltIn: true },
  { id: "times-new-roman", name: "Times New Roman", category: "serif", isBuiltIn: true },
  { id: "courier-new", name: "Courier New", category: "monospace", isBuiltIn: true },
  { id: "inter", name: "Inter", category: "sans-serif", isBuiltIn: false, googleFamily: "Inter" },
  { id: "dm-sans", name: "DM Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "DM Sans" },
  { id: "nunito", name: "Nunito", category: "sans-serif", isBuiltIn: false, googleFamily: "Nunito" },
  { id: "open-sans", name: "Open Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "Open Sans" },
  { id: "roboto", name: "Roboto", category: "sans-serif", isBuiltIn: false, googleFamily: "Roboto" },
  { id: "lato", name: "Lato", category: "sans-serif", isBuiltIn: false, googleFamily: "Lato" },
  { id: "montserrat", name: "Montserrat", category: "sans-serif", isBuiltIn: false, googleFamily: "Montserrat" },
  { id: "poppins", name: "Poppins", category: "sans-serif", isBuiltIn: false, googleFamily: "Poppins" },
  { id: "raleway", name: "Raleway", category: "sans-serif", isBuiltIn: false, googleFamily: "Raleway" },
  { id: "noto-sans", name: "Noto Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "Noto Sans" },
  { id: "pt-sans", name: "PT Sans", category: "sans-serif", isBuiltIn: false, googleFamily: "PT Sans" },
  { id: "source-sans-3", name: "Source Sans 3", category: "sans-serif", isBuiltIn: false, googleFamily: "Source Sans 3" },
  { id: "ubuntu", name: "Ubuntu", category: "sans-serif", isBuiltIn: false, googleFamily: "Ubuntu" },
  { id: "comic-neue", name: "Comic Neue", category: "display", isBuiltIn: false, googleFamily: "Comic Neue" },
  { id: "pt-serif", name: "PT Serif", category: "serif", isBuiltIn: false, googleFamily: "PT Serif" },
  { id: "merriweather", name: "Merriweather", category: "serif", isBuiltIn: false, googleFamily: "Merriweather" },
  { id: "playfair-display", name: "Playfair Display", category: "serif", isBuiltIn: false, googleFamily: "Playfair Display" },
];

const FONT_GROUPS: { label: string; fonts: CanvasFontDef[] }[] = [
  { label: "Sans-serif", fonts: FONT_REGISTRY.filter((f) => f.category === "sans-serif") },
  { label: "Serif", fonts: FONT_REGISTRY.filter((f) => f.category === "serif") },
  { label: "Monospace", fonts: FONT_REGISTRY.filter((f) => f.category === "monospace") },
  { label: "Display", fonts: FONT_REGISTRY.filter((f) => f.category === "display") },
];

// ─── Constants ───────────────────────────────────────────────────────

const COLOR_PRESETS = [
  { hex: "#000000" },
  { hex: "#FF0000" },
  { hex: "#808080" },
  { hex: "#0000FF" },
  { hex: "#008000" },
  { hex: "#FFFFFF" },
];

const OPACITY_OPTIONS = [
  { label: "No transparency", value: 1 },
  { label: "25%", value: 0.75 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.25 },
];

const ROTATION_OPTIONS = [
  { label: "Do not rotate", value: 0 },
  { label: "45\u00b0", value: 45 },
  { label: "90\u00b0", value: 90 },
  { label: "135\u00b0", value: 135 },
  { label: "180\u00b0", value: 180 },
  { label: "225\u00b0", value: 225 },
  { label: "270\u00b0", value: 270 },
  { label: "315\u00b0", value: 315 },
];

const POSITIONS: WatermarkPosition[] = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
];

// ─── Helpers ──────────────���──────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectMimeType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  return "image/jpeg";
}

function getOutputExtension(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "jpg";
  if (ext === "png") return "png";
  return "jpg";
}

// ─── RedDot ───────��──────────────────────────────────────────────────

function RedDot({ position, mosaic }: { position: WatermarkPosition; mosaic: boolean }) {
  if (mosaic) return null;
  const hClass = position.includes("left") ? "left-[10%]"
    : position.includes("right") ? "right-[10%]"
    : "left-1/2 -translate-x-1/2";
  const vClass = position.startsWith("top") ? "top-[10%]"
    : position.startsWith("bottom") ? "bottom-[10%]"
    : "top-1/2 -translate-y-1/2";
  return <div className={`absolute w-2.5 h-2.5 rounded-full bg-red-500 z-10 pointer-events-none ${hClass} ${vClass}`} />;
}

// ─── PositionGrid ───────��────────────────────────────────────────────

function PositionGrid({
  value, onChange, disabled,
}: {
  value: WatermarkPosition; onChange: (p: WatermarkPosition) => void; disabled: boolean;
}) {
  return (
    <div className="inline-grid grid-cols-3 gap-1.5 p-2.5 bg-slate-100 rounded-lg border border-slate-200">
      {POSITIONS.map((pos) => {
        const isSelected = value === pos && !disabled;
        return (
          <button
            key={pos}
            type="button"
            onClick={() => onChange(pos)}
            disabled={disabled}
            title={pos.replace(/-/g, " ")}
            className={`w-7 h-7 rounded flex items-center justify-center transition-all ${
              isSelected ? "bg-white border-2 border-red-400" : "bg-white border border-slate-200 hover:border-slate-300"
            } ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className={`block w-2.5 h-2.5 rounded-full ${isSelected ? "bg-red-500" : "bg-slate-300"}`} />
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────���──────────────────────────────────────────────

export default function InsertImageWatermarkPage() {
  const tool = getToolById("image-insert-watermark")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });

  // Working image (after rotate/crop transforms)
  const [workingFile, setWorkingFile] = useState<File | null>(null);
  const [workingUrl, setWorkingUrl] = useState("");
  const [workingSize, setWorkingSize] = useState({ width: 0, height: 0 });

  // Rotate/flip state
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  // Crop mode
  const [cropLoading, setCropLoading] = useState(false);

  // Watermark config
  const [watermarkMode, setWatermarkMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [fontId, setFontId] = useState("helvetica");
  const [fontSize, setFontSize] = useState(48);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [colorHex, setColorHex] = useState("#000000");
  const [watermarkImagePreview, setWatermarkImagePreview] = useState<string | null>(null);
  const [watermarkImg, setWatermarkImg] = useState<HTMLImageElement | null>(null);
  const [imageScale, setImageScale] = useState(0.3);
  const [wmOpacity, setWmOpacity] = useState(0.5);
  const [wmPosition, setWmPosition] = useState<WatermarkPosition>("center");
  const [mosaic, setMosaic] = useState(false);
  const [wmRotation, setWmRotation] = useState(0);
  const [layer, setLayer] = useState<"over" | "below">("over");

  const [fontLoading, setFontLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Preview
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<ImageData | null>(null);

  // Processing
  const [progress, setProgress] = useState({ progress: 0, stage: "" });
  const [result, setResult] = useState<InsertImageWatermarkResult | null>(null);

  // ─── Computed ──────────────────────────────────────────────────────

  const currentFontDef = FONT_REGISTRY.find((f) => f.id === fontId);
  const canProcess =
    (watermarkMode === "text" && text.trim().length > 0) ||
    (watermarkMode === "image" && watermarkImg !== null);

  // ─── Font loading ──────────────────────────────────��──────────────

  const loadFontForCanvas = useCallback(async (def: CanvasFontDef) => {
    if (def.isBuiltIn || !def.googleFamily) return;
    if (document.fonts.check(`16px "${def.name}"`)) return;
    const link = document.createElement("link");
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(def.googleFamily)}:wght@400;700&display=swap`;
    link.rel = "stylesheet";
    document.head.appendChild(link);
    try { await document.fonts.load(`16px "${def.name}"`); } catch { /* ok */ }
  }, []);

  const handleFontChange = useCallback(async (newFontId: string) => {
    setFontId(newFontId);
    const def = FONT_REGISTRY.find((f) => f.id === newFontId);
    if (!def || def.isBuiltIn) return;
    setFontLoading(true);
    try {
      await loadFontForCanvas(def);
    } catch (err) {
      console.error("Font load failed:", err);
    } finally {
      setFontLoading(false);
    }
  }, [loadFontForCanvas]);

  // ─── File handling ─────��──────────────────────────────────────────

  const handleFileSelected = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    const url = URL.createObjectURL(f);
    setImageUrl(url);
    setWorkingFile(f);
    setWorkingUrl(url);

    const img = new Image();
    img.onload = () => {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setWorkingSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = url;

    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setStage("configure");
    baseImageRef.current = null;
  }, []);

  // ─── Rotate/Flip handlers ─────────────���──────────────────────────

  const applyRotateFlip = useCallback(async (
    newRotation: 0 | 90 | 180 | 270,
    newFlipH: boolean,
    newFlipV: boolean,
  ) => {
    if (!file) return;
    // If no transforms, use original
    if (newRotation === 0 && !newFlipH && !newFlipV) {
      const url = URL.createObjectURL(file);
      setWorkingUrl(url);
      setWorkingFile(file);
      const img = new Image();
      img.onload = () => setWorkingSize({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
      baseImageRef.current = null;
      return;
    }

    const res = await rotateImage(file, {
      rotation: newRotation,
      flipHorizontal: newFlipH,
      flipVertical: newFlipV,
    });
    const newFile = new File([res.blob], file.name, { type: detectMimeType(file) });
    setWorkingFile(newFile);
    setWorkingUrl(res.previewUrl);
    setWorkingSize({ width: res.width, height: res.height });
    baseImageRef.current = null;
  }, [file]);

  const handleRotateCW = useCallback(() => {
    const next = ((rotation + 90) % 360) as 0 | 90 | 180 | 270;
    setRotation(next);
    applyRotateFlip(next, flipH, flipV);
  }, [rotation, flipH, flipV, applyRotateFlip]);

  const handleRotateCCW = useCallback(() => {
    const next = ((rotation + 270) % 360) as 0 | 90 | 180 | 270;
    setRotation(next);
    applyRotateFlip(next, flipH, flipV);
  }, [rotation, flipH, flipV, applyRotateFlip]);

  const handleFlipH = useCallback(() => {
    // Compensate flip direction when rotated 90/270
    const isSwapped = rotation === 90 || rotation === 270;
    const newFlipH = isSwapped ? flipH : !flipH;
    const newFlipV = isSwapped ? !flipV : flipV;
    setFlipH(newFlipH);
    setFlipV(newFlipV);
    applyRotateFlip(rotation, newFlipH, newFlipV);
  }, [rotation, flipH, flipV, applyRotateFlip]);

  const handleFlipV = useCallback(() => {
    const isSwapped = rotation === 90 || rotation === 270;
    const newFlipH = isSwapped ? !flipH : flipH;
    const newFlipV = isSwapped ? flipV : !flipV;
    setFlipH(newFlipH);
    setFlipV(newFlipV);
    applyRotateFlip(rotation, newFlipH, newFlipV);
  }, [rotation, flipH, flipV, applyRotateFlip]);

  // ─── Crop handlers ────────────────────────────────────────────────

  const handleEnterCrop = useCallback(() => {
    setStage("crop");
  }, []);

  const handleCropDone = useCallback(async (cropArea: CropArea, cropRotation: 0 | 90 | 180 | 270) => {
    if (!workingFile) return;
    setCropLoading(true);
    try {
      const res = await cropImage(workingFile, { cropArea, rotation: cropRotation });
      const newFile = new File([res.blob], file?.name || "image", { type: detectMimeType(file!) });
      setWorkingFile(newFile);
      setWorkingUrl(res.previewUrl);
      setWorkingSize({ width: res.croppedWidth, height: res.croppedHeight });
      baseImageRef.current = null;
      setStage("configure");
    } catch (err) {
      console.error("Crop failed:", err);
    } finally {
      setCropLoading(false);
    }
  }, [workingFile, file]);

  const handleCropBack = useCallback(() => {
    setStage("configure");
  }, []);

  // ─── Preview rendering ────────────────────────────────────────────

  // Load base image into canvas
  useEffect(() => {
    if (!workingUrl || stage !== "configure") return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const containerW = canvas.parentElement?.clientWidth || 400;
      const scale = Math.min(1, containerW / img.naturalWidth);
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    };
    img.src = workingUrl;

    return () => { cancelled = true; };
  }, [workingUrl, stage]);

  // Overlay watermark on preview (debounced)
  useEffect(() => {
    if (!baseImageRef.current || stage !== "configure") return;
    const timer = setTimeout(() => {
      const canvas = previewCanvasRef.current;
      if (!canvas || !baseImageRef.current) return;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(baseImageRef.current, 0, 0);

      const fontName = currentFontDef?.name || "Helvetica";
      const scaleFactor = canvas.width / workingSize.width;
      drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, {
        mode: watermarkMode,
        text,
        fontFamily: fontName,
        fontSize: fontSize * scaleFactor,
        bold,
        italic,
        underline,
        colorHex,
        opacity: wmOpacity,
        position: wmPosition,
        mosaic,
        rotation: wmRotation,
        img: watermarkImg,
        imageScale,
      });
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    watermarkMode, text, fontId, fontSize, bold, italic, underline, colorHex,
    wmOpacity, wmPosition, mosaic, wmRotation, watermarkImagePreview, imageScale,
    stage, baseImageRef.current, workingSize, watermarkImg,
  ]);

  // ─── Watermark image upload ─────��─────────────────────────────────

  const handleWmImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setWatermarkImagePreview(url);
    const img = new Image();
    img.onload = () => setWatermarkImg(img);
    img.src = url;
  }, []);

  const clearWmImage = useCallback(() => {
    if (watermarkImagePreview) URL.revokeObjectURL(watermarkImagePreview);
    setWatermarkImagePreview(null);
    setWatermarkImg(null);
  }, [watermarkImagePreview]);

  // ─── Process & Download ───────────��───────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!workingFile || !workingUrl || !canProcess) return;
    setStage("processing");
    try {
      const mimeType = detectMimeType(workingFile);
      const wmConfig: WatermarkOptions = {
        watermark: watermarkMode === "text"
          ? {
              mode: "text",
              text: text.trim(),
              fontFamily: currentFontDef?.name || "Helvetica",
              fontSize,
              bold,
              italic,
              underline,
              colorHex,
              opacity: wmOpacity,
            } as TextWatermarkConfig
          : {
              mode: "image",
              imageElement: watermarkImg!,
              scale: imageScale,
              opacity: wmOpacity,
            } as ImageWatermarkConfig,
        position: wmPosition,
        mosaic,
        rotation: wmRotation,
        layer,
      };

      const res = await insertImageWatermark(
        workingUrl,
        file?.size || 0,
        mimeType,
        wmConfig,
        (u) => setProgress(u),
      );
      setResult(res);
      setStage("done");
    } catch (err) {
      console.error("Watermark failed:", err);
      setStage("configure");
      alert("Failed to add watermark. Please try again.");
    }
  }, [
    workingFile, workingUrl, canProcess, watermarkMode, text, currentFontDef,
    fontSize, bold, italic, underline, colorHex, wmOpacity, watermarkImg,
    imageScale, wmPosition, mosaic, wmRotation, layer, file,
  ]);

  const handleDownload = useCallback(() => {
    if (!result || !file) return;
    const ext = getOutputExtension(file.name);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = `watermarked-${baseName}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result, file]);

  const handleReset = useCallback(() => {
    setStage("upload");
    setFile(null);
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl("");
    setWorkingFile(null);
    setWorkingUrl("");
    setNaturalSize({ width: 0, height: 0 });
    setWorkingSize({ width: 0, height: 0 });
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setProgress({ progress: 0, stage: "" });
    setResult(null);
    baseImageRef.current = null;
  }, [imageUrl]);

  // ─── Render ─────���───────────────────────────���─────────────────────

  return (
    <ToolPageLayout tool={tool} contentMaxWidth="max-w-7xl">
      {/* ─── Upload ──────────────────────────────────────────── */}
      {stage === "upload" && (
        <FileUploader
          acceptedFormats={[".jpg", ".jpeg", ".png"]}
          maxSizeMB={100}
          onFilesSelected={handleFileSelected}
          title="Select an image to watermark"
          subtitle="Upload a JPG or PNG file — drag & drop or click to select"
        />
      )}

      {/* ─── Crop Mode ───────────────���───────────────────────── */}
      {stage === "crop" && workingUrl && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
            <span className="text-sm font-medium text-slate-700">Crop Image</span>
            <button type="button" onClick={handleCropBack} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
              Back to Watermark
            </button>
          </div>
          <CropEditor
            imageUrl={workingUrl}
            naturalWidth={workingSize.width}
            naturalHeight={workingSize.height}
            showRotation={false}
            onCrop={(cropArea, cropRot) => handleCropDone(cropArea, cropRot)}
            actionLabel="Apply Crop"
            onNavigateRotate={(cropArea, cropRot) => handleCropDone(cropArea, cropRot)}
            navigateLabel="Apply & Back"
            isProcessing={cropLoading}
          />
        </div>
      )}

      {/* ─── Configure ───────���───────────────────────────────── */}
      {stage === "configure" && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="text-sm font-medium text-slate-700 truncate">{file?.name}</span>
              <span className="text-xs text-slate-400">{workingSize.width} x {workingSize.height}</span>
              {file && <span className="text-xs text-slate-400">&middot; {formatFileSize(file.size)}</span>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setShowPreview(!showPreview)} className="lg:hidden text-xs text-accent-500 hover:text-accent-600 font-medium transition-colors">
                {showPreview ? "Hide Preview" : "Show Preview"}
              </button>
              <button type="button" onClick={handleReset} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Change file</button>
            </div>
          </div>

          {/* 3-column layout */}
          <div className="flex flex-col lg:flex-row lg:gap-5">
            {/* Column 1: Image + Rotate/Crop tools */}
            <div className="flex-1 space-y-4 mb-6 lg:mb-0 min-w-0">
              {/* Rotate/Flip/Crop toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                <span className="text-xs font-medium text-slate-500 mr-1">Transform:</span>
                <button type="button" onClick={handleRotateCCW} title="Rotate 90\u00b0 CCW"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  CCW
                </button>
                <button type="button" onClick={handleRotateCW} title="Rotate 90\u00b0 CW"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  CW
                </button>
                <button type="button" onClick={handleFlipH} title="Flip Horizontal"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="20" x2="12" y2="4"/></svg>
                  Flip H
                </button>
                <button type="button" onClick={handleFlipV} title="Flip Vertical"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8V5a2 2 0 0 1 2-2h14c1.1 0 2 .9 2 2v3"/><path d="M3 16v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><line x1="4" y1="12" x2="20" y2="12"/></svg>
                  Flip V
                </button>
                <button type="button" onClick={handleEnterCrop} title="Crop Image"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6.13 1 6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13 16 6a2 2 0 0 1 2 2v15"/></svg>
                  Crop
                </button>
              </div>

              {/* Image preview with RedDot */}
              <div className="relative bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center p-4">
                {workingUrl && (
                  <div className="relative inline-block max-w-full">
                    <img
                      src={workingUrl}
                      alt="Source"
                      className="max-w-full max-h-[400px] object-contain rounded"
                    />
                    <RedDot position={wmPosition} mosaic={mosaic} />
                  </div>
                )}
              </div>

              {(rotation !== 0 || flipH || flipV) && (
                <p className="text-[10px] text-slate-400 text-center">
                  Transforms: {rotation !== 0 ? `Rotated ${rotation}\u00b0` : ""}
                  {flipH ? " \u00b7 Flipped H" : ""}
                  {flipV ? " \u00b7 Flipped V" : ""}
                </p>
              )}
            </div>

            {/* Column 2: Watermark Options */}
            <div className="lg:w-64 lg:shrink-0 mb-6 lg:mb-0">
              <div className="lg:sticky lg:top-4 bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-5">
                <h3 className="text-sm font-semibold text-slate-900">Watermark Options</h3>

                {/* Mode toggle */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <button type="button" onClick={() => setWatermarkMode("text")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${watermarkMode === "text" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    Place Text
                  </button>
                  <button type="button" onClick={() => setWatermarkMode("image")}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${watermarkMode === "image" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                    Place Image
                  </button>
                </div>

                {/* Text options */}
                {watermarkMode === "text" && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Text</label>
                      <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter watermark text"
                        className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Font Family {fontLoading && <span className="text-accent-500 animate-pulse">loading...</span>}</label>
                      <select value={fontId} onChange={(e) => handleFontChange(e.target.value)}
                        className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500">
                        {FONT_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.fonts.map((f) => <option key={f.id} value={f.id}>{f.name}{f.isBuiltIn ? " (built-in)" : ""}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Font Size ({fontSize}pt)</label>
                      <input type="range" min={8} max={200} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full accent-accent-500" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Style</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setBold(!bold)}
                          className={`px-3 py-1.5 text-sm font-bold rounded border transition-colors ${bold ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>B</button>
                        <button type="button" onClick={() => setItalic(!italic)}
                          className={`px-3 py-1.5 text-sm italic rounded border transition-colors ${italic ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>I</button>
                        <button type="button" onClick={() => setUnderline(!underline)}
                          className={`px-3 py-1.5 text-sm underline rounded border transition-colors ${underline ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>U</button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Color</label>
                      <div className="flex items-center gap-1.5">
                        {COLOR_PRESETS.map((c) => (
                          <button key={c.hex} type="button" onClick={() => setColorHex(c.hex)}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${colorHex === c.hex ? "border-slate-900 scale-110" : "border-slate-200 hover:border-slate-300"}`}
                            style={{ backgroundColor: c.hex }} />
                        ))}
                        <input type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)}
                          className="w-6 h-6 rounded cursor-pointer border border-slate-200 p-0" />
                      </div>
                    </div>
                  </div>
                )}

                {/* Image options */}
                {watermarkMode === "image" && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Image</label>
                      {watermarkImagePreview ? (
                        <div className="relative">
                          <img src={watermarkImagePreview} alt="Watermark" className="w-full h-24 object-contain bg-slate-50 rounded-lg border border-slate-200" />
                          <button type="button" onClick={clearWmImage}
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-slate-400 hover:text-red-500 transition-colors shadow-sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-1.5 p-4 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          <span className="text-xs text-slate-500">Choose image (PNG/JPG)</span>
                          <input type="file" accept="image/png,image/jpeg" onChange={handleWmImageUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                    {watermarkImg && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-700">Scale ({Math.round(imageScale * 100)}%)</label>
                        <input type="range" min={5} max={100} value={imageScale * 100} onChange={(e) => setImageScale(Number(e.target.value) / 100)} className="w-full accent-accent-500" />
                      </div>
                    )}
                  </div>
                )}

                {/* Shared options */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Opacity</label>
                    <select value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500">
                      {OPACITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Position</label>
                    <div className="flex items-start gap-3">
                      <PositionGrid value={wmPosition} onChange={setWmPosition} disabled={mosaic} />
                      <label className="flex items-center gap-2 cursor-pointer mt-2">
                        <input type="checkbox" checked={mosaic} onChange={(e) => setMosaic(e.target.checked)} className="rounded border-slate-300 text-accent-500 focus:ring-accent-500" />
                        <span className="text-xs text-slate-600">Mosaic</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Rotation</label>
                    <select value={wmRotation} onChange={(e) => setWmRotation(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500">
                      {ROTATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Layer</label>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                      <button type="button" onClick={() => setLayer("over")}
                        className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${layer === "over" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                        Over content
                      </button>
                      <button type="button" onClick={() => setLayer("below")}
                        className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${layer === "below" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
                        Below content
                      </button>
                    </div>
                  </div>
                </div>

                <button type="button" onClick={handleProcess} disabled={!canProcess || fontLoading}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                  Add Watermark
                </button>

                {!canProcess && (
                  <p className="text-[10px] text-amber-600 text-center">
                    {watermarkMode === "text" ? "Enter watermark text to continue." : "Upload a watermark image to continue."}
                  </p>
                )}
              </div>
            </div>

            {/* Column 3: Live Preview */}
            <div className={`${showPreview ? "" : "hidden"} lg:block lg:w-80 lg:shrink-0`}>
              <div className="lg:sticky lg:top-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">Live Preview</h3>
                </div>
                <div className="p-3">
                  <canvas ref={previewCanvasRef} className="w-full rounded-lg border border-slate-100 bg-slate-50" />
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 text-center">Watermark preview updates in real-time</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Processing ────────��─────────────────────────────── */}
      {stage === "processing" && (
        <ProcessingView fileName={file?.name || "Image"} progress={progress.progress} status={progress.stage} />
      )}

      {/* ─── Done ───────────────���────────────────────────────── */}
      {stage === "done" && result && (
        <>
          <div className="w-full max-w-lg mx-auto text-center">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-1">Watermark added!</h3>
            <p className="text-sm text-slate-500 mb-6">Your image is ready to download.</p>

            {/* Preview */}
            <div className="mb-6 rounded-xl border border-slate-200 overflow-hidden bg-[repeating-conic-gradient(#e2e8f0_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]">
              <img src={result.previewUrl} alt="Result" className="w-full max-h-[300px] object-contain" />
            </div>

            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
              <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>
              <div className="text-left min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">watermarked-{file?.name?.replace(/\.[^.]+$/, "")}.{getOutputExtension(file?.name || "image.jpg")}</p>
                <p className="text-xs text-slate-500">{formatFileSize(result.processedSize)}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={handleDownload} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </button>
              <button onClick={() => setStage("configure")} className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Back to Edit
              </button>
              <button onClick={handleReset} className="flex-1 px-4 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors">
                Process Another
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <span>{formatFileSize(result.originalSize)} &rarr; {formatFileSize(result.processedSize)}</span>
          </div>

          {/* Data Quality badge */}
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="text-xs font-medium text-emerald-700">
                Quality: {result.qualityScore}% — maximum quality output
              </span>
            </div>
          </div>

          {/* Info Notice */}
          <div className="mt-6 mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl max-w-2xl mx-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              Watermark is applied using Canvas API compositing at full resolution. JPEG output uses quality 1.0 (maximum), PNG output is lossless. Original dimensions are preserved.
            </p>
          </div>
        </>
      )}

      {/* ─── How it works ──────────────────────────────────────── */}
      <div className="mt-16 pt-12 border-t border-slate-100 max-w-4xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            { step: "1", title: "Upload Image", desc: "Select a JPG or PNG image to add a watermark to." },
            { step: "2", title: "Configure", desc: "Choose text or image watermark, set font, position, opacity, rotation, and layer." },
            { step: "3", title: "Preview", desc: "See a live preview of the watermark. Optionally rotate, flip, or crop before applying." },
            { step: "4", title: "Download", desc: "Download your watermarked image — maximum quality preserved." },
          ].map((item) => (
            <div key={item.step} className="flex flex-col items-center text-center">
              <div className="w-10 h-10 rounded-full bg-accent-50 flex items-center justify-center mb-3">
                <span className="text-sm font-bold text-accent-600">{item.step}</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 mb-1">{item.title}</h3>
              <p className="text-xs text-slate-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </ToolPageLayout>
  );
}
