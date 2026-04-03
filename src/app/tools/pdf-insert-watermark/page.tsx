"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import FileUploader from "@/components/FileUploader";
import ProcessingView from "@/components/ProcessingView";
import DownloadView from "@/components/DownloadView";
import { getToolById } from "@/config/tools";
import {
  insertWatermark,
  fetchFontBytes,
  renderPageThumbnail,
  getPdfPageCount,
  getPageDimensions,
  FONT_REGISTRY,
  type FontDef,
  type WatermarkPosition,
  type TextWatermarkConfig,
  type ImageWatermarkConfig,
  type InsertWatermarkResult,
  type ProcessingUpdate,
  type PageDimensions,
} from "@/lib/tools/pdf-insert-watermark";

type Stage = "upload" | "configure" | "processing" | "done";

const GRID_COLS = 3;

// ─── Constants ───────────────────────────────────────────────────────

const COLOR_PRESETS = [
  { hex: "#000000", r: 0, g: 0, b: 0 },
  { hex: "#FF0000", r: 1, g: 0, b: 0 },
  { hex: "#808080", r: 0.502, g: 0.502, b: 0.502 },
  { hex: "#0000FF", r: 0, g: 0, b: 1 },
  { hex: "#008000", r: 0, g: 0.502, b: 0 },
  { hex: "#FFFFFF", r: 1, g: 1, b: 1 },
];

const OPACITY_OPTIONS = [
  { label: "No transparency", value: 1 },
  { label: "25%", value: 0.75 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.25 },
];

const ROTATION_OPTIONS = [
  { label: "Do not rotate", value: 0 },
  { label: "45°", value: 45 },
  { label: "90°", value: 90 },
  { label: "135°", value: 135 },
  { label: "180°", value: 180 },
  { label: "225°", value: 225 },
  { label: "270°", value: 270 },
  { label: "315°", value: 315 },
];

const POSITIONS: WatermarkPosition[] = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
];

// Group fonts by category for <optgroup>
const FONT_GROUPS: { label: string; fonts: FontDef[] }[] = [
  { label: "Sans-serif", fonts: FONT_REGISTRY.filter((f) => f.category === "sans-serif") },
  { label: "Serif", fonts: FONT_REGISTRY.filter((f) => f.category === "serif") },
  { label: "Monospace", fonts: FONT_REGISTRY.filter((f) => f.category === "monospace") },
  { label: "Display", fonts: FONT_REGISTRY.filter((f) => f.category === "display") },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDimensions(dims: PageDimensions): string {
  return `${Math.round(dims.width)} × ${Math.round(dims.height)} pts`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

// ─── Canvas Watermark Preview ────────────────────────────────────────

function getCanvasPosition(
  cw: number, ch: number, ww: number, wh: number,
  pos: WatermarkPosition, margin: number
): { x: number; y: number } {
  let x: number;
  if (pos.includes("left")) x = margin;
  else if (pos.includes("right")) x = cw - margin - ww;
  else x = (cw - ww) / 2;

  let y: number;
  if (pos.startsWith("top")) y = margin;
  else if (pos.startsWith("bottom")) y = ch - margin - wh;
  else y = (ch - wh) / 2;

  return { x, y };
}

function getCanvasMosaicPositions(
  cw: number, ch: number, ww: number, wh: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const sx = ww * 1.8, sy = wh * 3;
  let row = 0;
  for (let y = -wh; y < ch + wh; y += sy) {
    const ox = row % 2 === 1 ? sx / 2 : 0;
    for (let x = -ww + ox; x < cw + ww; x += sx) pts.push({ x, y });
    row++;
  }
  return pts;
}

function drawCanvasWatermark(
  ctx: CanvasRenderingContext2D, cw: number, ch: number,
  opts: {
    mode: "text" | "image"; text: string; fontName: string; fontSize: number;
    bold: boolean; italic: boolean; underline: boolean; colorHex: string;
    opacity: number; position: WatermarkPosition; mosaic: boolean;
    rotation: number; img: HTMLImageElement | null; imageScale: number;
  }
) {
  const margin = cw * 0.033;
  ctx.save();
  ctx.globalAlpha = opts.opacity;

  if (opts.mode === "text" && opts.text) {
    const style = `${opts.italic ? "italic " : ""}${opts.bold ? "bold " : ""}${opts.fontSize}px "${opts.fontName}", sans-serif`;
    ctx.font = style;
    ctx.fillStyle = opts.colorHex;
    ctx.textBaseline = "top";

    const ww = ctx.measureText(opts.text).width;
    const wh = opts.fontSize;
    const pts = opts.mosaic
      ? getCanvasMosaicPositions(cw, ch, ww, wh)
      : [getCanvasPosition(cw, ch, ww, wh, opts.position, margin)];

    for (const p of pts) {
      ctx.save();
      ctx.translate(p.x + ww / 2, p.y + wh / 2);
      ctx.rotate((opts.rotation * Math.PI) / 180);
      ctx.fillText(opts.text, -ww / 2, -wh / 2);
      if (opts.underline) {
        ctx.beginPath();
        ctx.moveTo(-ww / 2, wh / 2 + 2);
        ctx.lineTo(ww / 2, wh / 2 + 2);
        ctx.strokeStyle = opts.colorHex;
        ctx.lineWidth = Math.max(1, opts.fontSize / 20);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (opts.mode === "image" && opts.img?.complete) {
    const ww = cw * opts.imageScale;
    const wh = (opts.img.naturalHeight / opts.img.naturalWidth) * ww;
    const pts = opts.mosaic
      ? getCanvasMosaicPositions(cw, ch, ww, wh)
      : [getCanvasPosition(cw, ch, ww, wh, opts.position, margin)];

    for (const p of pts) {
      ctx.save();
      ctx.translate(p.x + ww / 2, p.y + wh / 2);
      ctx.rotate((opts.rotation * Math.PI) / 180);
      ctx.drawImage(opts.img, -ww / 2, -wh / 2, ww, wh);
      ctx.restore();
    }
  }

  ctx.restore();
}

// ─── Red Dot Overlay (on thumbnails) ─────────────────────────────────

function RedDot({ position, mosaic }: { position: WatermarkPosition; mosaic: boolean }) {
  if (mosaic) return null;
  const hClass = position.includes("left") ? "left-[10%]"
    : position.includes("right") ? "right-[10%]"
    : "left-1/2 -translate-x-1/2";
  const vClass = position.startsWith("top") ? "top-[10%]"
    : position.startsWith("bottom") ? "bottom-[18%]"
    : "top-1/2 -translate-y-1/2";
  return <div className={`absolute w-2.5 h-2.5 rounded-full bg-red-500 z-10 pointer-events-none ${hClass} ${vClass}`} />;
}

// ─── Position Grid ───────────────────────────────────────────────────

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

// ─── Active Page Thumbnail ───────────────────────────────────────────

interface ActivePageThumbProps {
  pageIndex: number; thumbnailUrl?: string; dimensions?: PageDimensions;
  isFirst: boolean; isLast: boolean; canMoveUp: boolean; canMoveDown: boolean; canRemove: boolean;
  onMoveLeft: () => void; onMoveRight: () => void; onMoveUp: () => void; onMoveDown: () => void;
  onRemove: () => void; onPreview: () => void;
  onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void;
  isPreviewPage: boolean; watermarkPosition: WatermarkPosition; mosaic: boolean;
}

function ActivePageThumb(props: ActivePageThumbProps) {
  const {
    pageIndex, thumbnailUrl, dimensions, isFirst, isLast, canMoveUp, canMoveDown, canRemove,
    onMoveLeft, onMoveRight, onMoveUp, onMoveDown, onRemove, onPreview,
    onDragStart, onDragOver, onDrop, isPreviewPage, watermarkPosition, mosaic,
  } = props;
  const observerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={observerRef} draggable onClick={() => onPreview()} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
      className={`relative rounded-lg border-2 ${isPreviewPage ? "border-accent-400 ring-2 ring-accent-200" : "border-slate-200 hover:border-slate-300"} cursor-grab active:cursor-grabbing transition-all`}
    >
      <div className="absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded-full bg-slate-900/70 text-white text-[9px] font-bold">
        {pageIndex + 1}
      </div>

      <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} disabled={!canRemove}
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm" aria-label="Remove">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>

      {/* Magnifying glass for preview */}
      <button type="button" onClick={(e) => { e.stopPropagation(); onPreview(); }}
        className="absolute bottom-8 right-1.5 z-10 p-1 rounded-full bg-white/80 text-slate-400 hover:bg-white hover:text-blue-500 transition-all shadow-sm" aria-label="Preview this page">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </button>

      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {visible && thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Page ${pageIndex + 1}`} className="w-full h-full object-contain" />
        ) : (
          <div className="text-slate-300">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          </div>
        )}
        <RedDot position={watermarkPosition} mosaic={mosaic} />

        <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
          <div className="flex flex-col items-center gap-0.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={!canMoveUp}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <div className="flex items-center gap-3">
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveLeft(); }} disabled={isFirst}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onMoveRight(); }} disabled={isLast}
                className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={!canMoveDown}
              className="p-1 rounded-full bg-white/80 text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed transition-all shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 border-t border-slate-100">
        <p className="text-[10px] font-medium text-slate-600">Page {pageIndex + 1}</p>
        {dimensions && <p className="text-[9px] text-slate-400">{formatDimensions(dimensions)}</p>}
      </div>
    </div>
  );
}

// ─── Removed Page Thumbnail ──────────────────────────────────────────

function RemovedPageThumb({ pageIndex, thumbnailUrl, onRestore }: { pageIndex: number; thumbnailUrl?: string; onRestore: () => void }) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-slate-200 opacity-50 hover:opacity-70 transition-all">
      <div className="relative w-full aspect-[3/4] bg-slate-50 rounded-t-md overflow-hidden flex items-center justify-center">
        {thumbnailUrl ? <img src={thumbnailUrl} alt={`Page ${pageIndex + 1}`} className="w-full h-full object-contain" /> : (
          <div className="text-slate-300"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <button type="button" onClick={onRestore} className="p-2 rounded-full bg-white/90 text-slate-400 hover:text-emerald-500 transition-all shadow-sm" aria-label="Restore">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
      <div className="px-2 py-1.5 border-t border-slate-100"><p className="text-[10px] font-medium text-slate-500">Page {pageIndex + 1}</p></div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export default function InsertPdfWatermarkPage() {
  const tool = getToolById("pdf-insert-watermark")!;

  const [stage, setStage] = useState<Stage>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [dimensions, setDimensions] = useState<PageDimensions[]>([]);
  const [loadingThumbnails, setLoadingThumbnails] = useState(false);

  const [activePages, setActivePages] = useState<number[]>([]);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const dragIndexRef = useRef<number>(-1);

  // Watermark config
  const [watermarkMode, setWatermarkMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [fontId, setFontId] = useState("helvetica");
  const [fontSize, setFontSize] = useState(48);
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [fontColor, setFontColor] = useState({ r: 0, g: 0, b: 0 });
  const [colorHex, setColorHex] = useState("#000000");
  const [watermarkImage, setWatermarkImage] = useState<ArrayBuffer | null>(null);
  const [watermarkImageType, setWatermarkImageType] = useState<"png" | "jpg">("png");
  const [watermarkImagePreview, setWatermarkImagePreview] = useState<string | null>(null);
  const [watermarkImg, setWatermarkImg] = useState<HTMLImageElement | null>(null);
  const [imageScale, setImageScale] = useState(0.3);
  const [opacity, setOpacity] = useState(1);
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [mosaic, setMosaic] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [layer, setLayer] = useState<"over" | "below">("over");

  const [fontLoading, setFontLoading] = useState(false);
  const fontBytesRef = useRef<Map<string, ArrayBuffer>>(new Map());

  // Preview
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseImageRef = useRef<ImageData | null>(null);

  // Processing
  const [progress, setProgress] = useState<ProcessingUpdate>({ progress: 0, stage: "" });
  const [result, setResult] = useState<InsertWatermarkResult | null>(null);

  // ─── Computed ──────────────────────────────────────────────────────

  const isDefaultOrder = activePages.length === pageCount && removedPages.length === 0 && activePages.every((v, i) => v === i);
  const canProcess = activePages.length > 0 && (
    (watermarkMode === "text" && text.trim().length > 0) ||
    (watermarkMode === "image" && watermarkImage !== null)
  );
  const currentFontDef = FONT_REGISTRY.find((f) => f.id === fontId);

  // ─── Font handling ─────────────────────────────────────────────────

  const loadFontForPreview = useCallback(async (def: FontDef) => {
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
      await Promise.all([
        fetchFontBytes(def.googleFamily!, false).then((b) => fontBytesRef.current.set(`${def.googleFamily}::400`, b)),
        fetchFontBytes(def.googleFamily!, true).then((b) => fontBytesRef.current.set(`${def.googleFamily}::700`, b)),
        loadFontForPreview(def),
      ]);
    } catch (err) {
      console.error("Font load failed:", err);
    } finally {
      setFontLoading(false);
    }
  }, [loadFontForPreview]);

  // ─── File handling ─────────────────────────────────────────────────

  const handleFileSelected = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setStage("configure");
    setLoadingThumbnails(true);
    setThumbnails({});
    setRemovedPages([]);
    setPreviewPageIndex(0);
    baseImageRef.current = null;

    try {
      const [count, dims] = await Promise.all([getPdfPageCount(f), getPageDimensions(f)]);
      setPageCount(count);
      setDimensions(dims);
      setActivePages(Array.from({ length: count }, (_, i) => i));
      for (let i = 0; i < count; i++) {
        try {
          const url = await renderPageThumbnail(f, i, 150);
          setThumbnails((prev) => ({ ...prev, [i]: url }));
        } catch { /* skip */ }
      }
    } catch (err) {
      console.error("Failed to load PDF:", err);
      alert("Failed to read the PDF file. It may be corrupted or encrypted.");
      setStage("upload");
    } finally {
      setLoadingThumbnails(false);
    }
  }, []);

  // ─── Preview rendering ─────────────────────────────────────────────

  useEffect(() => {
    if (!file || stage !== "configure") return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await doc.getPage(previewPageIndex + 1);
        const vp = page.getViewport({ scale: 1 });
        const containerW = canvas.parentElement?.clientWidth || 400;
        const scale = containerW / vp.width;
        const svp = page.getViewport({ scale });
        canvas.width = svp.width;
        canvas.height = svp.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: svp }).promise;
        if (!cancelled) {
          baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      } catch (err) {
        console.error("Preview render failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [file, previewPageIndex, stage]);

  // Overlay watermark on preview (debounced)
  useEffect(() => {
    if (!baseImageRef.current || stage !== "configure") return;
    const timer = setTimeout(() => {
      const canvas = previewCanvasRef.current;
      if (!canvas || !baseImageRef.current) return;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(baseImageRef.current, 0, 0);
      const fontName = currentFontDef?.name || "Helvetica";
      const scaleFactor = canvas.width / (dimensions[previewPageIndex]?.width || 612);
      drawCanvasWatermark(ctx, canvas.width, canvas.height, {
        mode: watermarkMode, text, fontName, fontSize: fontSize * scaleFactor,
        bold, italic, underline, colorHex, opacity, position, mosaic,
        rotation, img: watermarkImg, imageScale,
      });
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    watermarkMode, text, fontId, fontSize, bold, italic, underline, colorHex,
    opacity, position, mosaic, rotation, watermarkImagePreview, imageScale, stage,
    baseImageRef.current, dimensions, previewPageIndex, watermarkImg,
  ]);

  // ─── Image watermark upload ────────────────────────────────────────

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setWatermarkImageType(f.name.split(".").pop()?.toLowerCase() === "png" ? "png" : "jpg");
    const reader = new FileReader();
    reader.onload = () => {
      setWatermarkImage(reader.result as ArrayBuffer);
      const url = URL.createObjectURL(f);
      setWatermarkImagePreview(url);
      const img = new Image();
      img.onload = () => setWatermarkImg(img);
      img.src = url;
    };
    reader.readAsArrayBuffer(f);
  }, []);

  const clearWatermarkImage = useCallback(() => {
    if (watermarkImagePreview) URL.revokeObjectURL(watermarkImagePreview);
    setWatermarkImage(null);
    setWatermarkImagePreview(null);
    setWatermarkImg(null);
  }, [watermarkImagePreview]);

  // ─── Page management ───────────────────────────────────────────────

  const movePage = useCallback((from: number, to: number) => {
    setActivePages((prev) => { const n = [...prev]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
  }, []);

  const removePage = useCallback((posIdx: number) => {
    setActivePages((prev) => {
      if (prev.length <= 1) return prev;
      const pi = prev[posIdx];
      setRemovedPages((rm) => [...rm, pi]);
      return prev.filter((_, i) => i !== posIdx);
    });
  }, []);

  const restorePage = useCallback((pi: number) => {
    setRemovedPages((prev) => prev.filter((p) => p !== pi));
    setActivePages((prev) => [...prev, pi]);
  }, []);

  const resetOrder = useCallback(() => {
    setActivePages(Array.from({ length: pageCount }, (_, i) => i));
    setRemovedPages([]);
  }, [pageCount]);

  // Drag & drop
  const onDragStartFactory = useCallback((idx: number) => (e: React.DragEvent) => {
    dragIndexRef.current = idx; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx));
  }, []);
  const onDragOverFactory = useCallback(() => (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);
  const onDropFactory = useCallback((dropIdx: number) => (e: React.DragEvent) => {
    e.preventDefault(); const from = dragIndexRef.current; if (from >= 0 && from !== dropIdx) movePage(from, dropIdx); dragIndexRef.current = -1;
  }, [movePage]);

  // ─── Process & Download ────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (!file || !canProcess) return;
    setStage("processing");
    try {
      const pdfData = await file.arrayBuffer();
      const wmConfig: TextWatermarkConfig | ImageWatermarkConfig =
        watermarkMode === "text"
          ? { mode: "text", text: text.trim(), fontId, fontSize, bold, italic, underline, color: fontColor, opacity }
          : { mode: "image", imageData: watermarkImage!, imageType: watermarkImageType, scale: imageScale, opacity };

      let fb: ArrayBuffer | undefined;
      if (watermarkMode === "text" && currentFontDef && !currentFontDef.isBuiltIn && currentFontDef.googleFamily) {
        const weight = bold ? "700" : "400";
        const key = `${currentFontDef.googleFamily}::${weight}`;
        fb = fontBytesRef.current.get(key);
        if (!fb) fb = await fetchFontBytes(currentFontDef.googleFamily, bold);
      }

      const res = await insertWatermark({
        pdfData, fileName: file.name, pageOrder: activePages,
        options: { watermark: wmConfig, position, mosaic, rotation, layer },
        fontBytes: fb,
        onProgress: (u) => setProgress(u),
      });
      setResult(res);
      setStage("done");
    } catch (err) {
      console.error("Watermark failed:", err);
      setStage("configure");
      alert("Failed to add watermark. The file may be corrupted or encrypted.");
    }
  }, [
    file, canProcess, watermarkMode, text, fontId, fontSize, bold, italic, underline,
    fontColor, opacity, watermarkImage, watermarkImageType, imageScale,
    activePages, position, mosaic, rotation, layer, currentFontDef,
  ]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(result.blob);
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, [result]);

  const handleReset = useCallback(() => {
    setStage("upload"); setFile(null); setPageCount(0); setThumbnails({});
    setDimensions([]); setActivePages([]); setRemovedPages([]);
    setProgress({ progress: 0, stage: "" }); setResult(null);
    baseImageRef.current = null;
  }, []);

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <ToolPageLayout tool={tool} contentMaxWidth="max-w-7xl">
      {/* ─── Upload ──────────────────────────────────────────── */}
      {stage === "upload" && (
        <FileUploader acceptedFormats={[".pdf"]} maxSizeMB={200} onFilesSelected={handleFileSelected}
          title="Select a PDF to watermark" subtitle="Upload a PDF file — drag & drop or click to select" />
      )}

      {/* ─── Configure ───────────────────────────────────────── */}
      {stage === "configure" && (
        <div className="space-y-4">
          {/* File info bar */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-100 rounded-lg">
            <div className="flex items-center gap-2 min-w-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span className="text-sm font-medium text-slate-700 truncate">{file?.name}</span>
              <span className="text-xs text-slate-400">{pageCount} pages</span>
              {file && <span className="text-xs text-slate-400">&middot; {formatFileSize(file.size)}</span>}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setShowPreview(!showPreview)} className="lg:hidden text-xs text-accent-500 hover:text-accent-600 font-medium transition-colors">
                {showPreview ? "Hide Preview" : "Show Preview"}
              </button>
              <button type="button" onClick={handleReset} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Change file</button>
            </div>
          </div>

          {loadingThumbnails && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-blue-700">Loading page thumbnails...</span>
            </div>
          )}

          {/* 3-column layout */}
          <div className="flex flex-col lg:flex-row lg:gap-5">
            {/* Column 1: Thumbnails */}
            <div className="flex-1 space-y-4 mb-6 lg:mb-0 min-w-0">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                <button type="button" onClick={resetOrder} disabled={isDefaultOrder}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Reset Order
                </button>
                {removedPages.length > 0 && (
                  <button type="button" onClick={resetOrder}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200 transition-colors">
                    Restore All
                  </button>
                )}
                <span className="text-[10px] text-slate-400 ml-auto">{activePages.length} of {pageCount} pages</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                {activePages.map((pageIdx, posIdx) => (
                  <ActivePageThumb
                    key={`a-${pageIdx}-${posIdx}`}
                    pageIndex={pageIdx} thumbnailUrl={thumbnails[pageIdx]} dimensions={dimensions[pageIdx]}
                    isFirst={posIdx === 0} isLast={posIdx === activePages.length - 1}
                    canMoveUp={posIdx >= GRID_COLS} canMoveDown={posIdx + GRID_COLS <= activePages.length - 1} canRemove={activePages.length > 1}
                    onMoveLeft={() => { if (posIdx > 0) movePage(posIdx, posIdx - 1); }}
                    onMoveRight={() => { if (posIdx < activePages.length - 1) movePage(posIdx, posIdx + 1); }}
                    onMoveUp={() => { if (posIdx >= GRID_COLS) movePage(posIdx, Math.max(0, posIdx - GRID_COLS)); }}
                    onMoveDown={() => { if (posIdx + GRID_COLS <= activePages.length - 1) movePage(posIdx, Math.min(activePages.length - 1, posIdx + GRID_COLS)); }}
                    onRemove={() => removePage(posIdx)}
                    onPreview={() => { setPreviewPageIndex(pageIdx); setShowPreview(true); }}
                    onDragStart={onDragStartFactory(posIdx)} onDragOver={onDragOverFactory()} onDrop={onDropFactory(posIdx)}
                    isPreviewPage={pageIdx === previewPageIndex}
                    watermarkPosition={position} mosaic={mosaic}
                  />
                ))}
              </div>

              {removedPages.length > 0 && (
                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-slate-500">Removed Pages</h3>
                    <span className="text-[10px] text-slate-400">{removedPages.length}</span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 gap-2">
                    {removedPages.map((pi) => <RemovedPageThumb key={`r-${pi}`} pageIndex={pi} thumbnailUrl={thumbnails[pi]} onRestore={() => restorePage(pi)} />)}
                  </div>
                </div>
              )}
            </div>

            {/* Column 2: Watermark Options */}
            <div className="lg:w-64 lg:shrink-0 mb-6 lg:mb-0">
              <div className="lg:sticky lg:top-4 bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-5">
                <h3 className="text-sm font-semibold text-slate-900">Watermark Options</h3>

                {/* Mode toggle */}
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <button type="button" onClick={() => setWatermarkMode("text")} className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${watermarkMode === "text" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Place Text</button>
                  <button type="button" onClick={() => setWatermarkMode("image")} className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${watermarkMode === "image" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Place Image</button>
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
                            {g.fonts.map((f) => <option key={f.id} value={f.id}>{f.name}{!f.isBuiltIn ? "" : " (built-in)"}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Font Size ({fontSize}pt)</label>
                      <input type="range" min={8} max={120} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full accent-accent-500" />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Style</label>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => setBold(!bold)} className={`px-3 py-1.5 text-sm font-bold rounded border transition-colors ${bold ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>B</button>
                        <button type="button" onClick={() => setItalic(!italic)} className={`px-3 py-1.5 text-sm italic rounded border transition-colors ${italic ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>I</button>
                        <button type="button" onClick={() => setUnderline(!underline)} className={`px-3 py-1.5 text-sm underline rounded border transition-colors ${underline ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>U</button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-700">Color</label>
                      <div className="flex items-center gap-1.5">
                        {COLOR_PRESETS.map((c) => (
                          <button key={c.hex} type="button" onClick={() => { setFontColor({ r: c.r, g: c.g, b: c.b }); setColorHex(c.hex); }}
                            className={`w-6 h-6 rounded-full border-2 transition-all ${colorHex === c.hex ? "border-slate-900 scale-110" : "border-slate-200 hover:border-slate-300"}`}
                            style={{ backgroundColor: c.hex }} />
                        ))}
                        <input type="color" value={colorHex} onChange={(e) => { setColorHex(e.target.value); const rgb = hexToRgb(e.target.value); if (rgb) setFontColor(rgb); }}
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
                          <button type="button" onClick={clearWatermarkImage}
                            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-white/90 text-slate-400 hover:text-red-500 transition-colors shadow-sm">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-1.5 p-4 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-colors">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          <span className="text-xs text-slate-500">Choose image (PNG/JPG)</span>
                          <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                    {watermarkImage && (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-700">Scale ({Math.round(imageScale * 100)}%)</label>
                        <input type="range" min={10} max={100} value={imageScale * 100} onChange={(e) => setImageScale(Number(e.target.value) / 100)} className="w-full accent-accent-500" />
                      </div>
                    )}
                  </div>
                )}

                {/* Shared options */}
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Opacity</label>
                    <select value={opacity} onChange={(e) => setOpacity(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500">
                      {OPACITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Position</label>
                    <div className="flex items-start gap-3">
                      <PositionGrid value={position} onChange={setPosition} disabled={mosaic} />
                      <label className="flex items-center gap-2 cursor-pointer mt-2">
                        <input type="checkbox" checked={mosaic} onChange={(e) => setMosaic(e.target.checked)} className="rounded border-slate-300 text-accent-500 focus:ring-accent-500" />
                        <span className="text-xs text-slate-600">Mosaic</span>
                      </label>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Rotation</label>
                    <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}
                      className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500">
                      {ROTATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-700">Layer</label>
                    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                      <button type="button" onClick={() => setLayer("over")} className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${layer === "over" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Over content</button>
                      <button type="button" onClick={() => setLayer("below")} className={`flex-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${layer === "below" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Below content</button>
                    </div>
                  </div>
                </div>

                <button type="button" onClick={handleProcess} disabled={!canProcess || fontLoading}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-accent-500 hover:bg-accent-600 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                  Add Watermark
                </button>

                {!canProcess && activePages.length > 0 && (
                  <p className="text-[10px] text-amber-600 text-center">
                    {watermarkMode === "text" ? "Enter watermark text to continue." : "Upload a watermark image to continue."}
                  </p>
                )}
              </div>
            </div>

            {/* Column 3: Live Preview */}
            <div className={`${showPreview ? "" : "hidden"} lg:block lg:w-80 lg:shrink-0`}>
              <div className="lg:sticky lg:top-4 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Preview</h3>
                  <span className="text-xs text-slate-400">Page {previewPageIndex + 1}</span>
                </div>
                <div className="p-3">
                  <canvas ref={previewCanvasRef} className="w-full rounded-lg border border-slate-100 bg-slate-50" />
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between">
                  <button type="button" disabled={previewPageIndex <= 0} onClick={() => setPreviewPageIndex((p) => Math.max(0, p - 1))}
                    className="px-2 py-1 text-xs text-slate-500 bg-slate-50 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                    ← Prev
                  </button>
                  <span className="text-[10px] text-slate-400">{previewPageIndex + 1} / {pageCount}</span>
                  <button type="button" disabled={previewPageIndex >= pageCount - 1} onClick={() => setPreviewPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                    className="px-2 py-1 text-xs text-slate-500 bg-slate-50 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed">
                    Next →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Processing ──────────────────────────────────────── */}
      {stage === "processing" && (
        <ProcessingView fileName={file?.name || "PDF"} progress={progress.progress} status={progress.stage} />
      )}

      {/* ─── Done ────────────────────────────────────────────── */}
      {stage === "done" && result && (
        <>
          <DownloadView fileName={result.fileName} fileSize={formatFileSize(result.processedSize)} onDownload={handleDownload} onReset={handleReset} />

          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setStage("configure")}
              className="px-5 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              ← Back to Edit
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-slate-500">
            <div className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span>{result.totalPages} page{result.totalPages !== 1 ? "s" : ""} watermarked</span>
            </div>
            <div className="text-slate-300">|</div>
            <span>{formatFileSize(result.originalSize)} → {formatFileSize(result.processedSize)}</span>
          </div>

          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-full">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500"><polyline points="20 6 9 17 4 12"/></svg>
              <span className="text-xs font-medium text-emerald-700">
                {layer === "over" ? "Lossless — original quality preserved" : "Watermark placed below content"}
              </span>
            </div>
          </div>

          <div className="mt-6 mb-4 flex items-start gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl max-w-2xl mx-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500 shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-xs text-blue-700 leading-relaxed">
              {layer === "over"
                ? "Pages are copied losslessly using copyPages(). The watermark is drawn as an overlay — original content, fonts, images, and layout are fully preserved."
                : "For \"below content\" mode, the original page is embedded as a form overlay. The watermark is only visible in areas without content."}
            </p>
          </div>
        </>
      )}

      {/* ─── How it works ──────────────────────────────────────── */}
      <div className="mt-16 pt-12 border-t border-slate-100 max-w-4xl mx-auto">
        <h2 className="text-lg font-semibold text-slate-900 mb-6">How it works</h2>
        <div className="grid sm:grid-cols-4 gap-6">
          {[
            { step: "1", title: "Upload PDF", desc: "Select a PDF document to add a watermark to." },
            { step: "2", title: "Configure", desc: "Choose text or image, set font, position, opacity, rotation, and layer." },
            { step: "3", title: "Preview", desc: "See a live preview of the watermark before processing." },
            { step: "4", title: "Download", desc: "Download your watermarked PDF — original quality preserved." },
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
