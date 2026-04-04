"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { CropArea } from "@/lib/tools/crop-image";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type HandlePos = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";

interface AspectPreset {
  label: string;
  value: string;
  ratio: number | null;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { label: "Free", value: "free", ratio: null },
  { label: "1:1", value: "1:1", ratio: 1 },
  { label: "4:3", value: "4:3", ratio: 4 / 3 },
  { label: "3:2", value: "3:2", ratio: 3 / 2 },
  { label: "16:9", value: "16:9", ratio: 16 / 9 },
  { label: "2:3", value: "2:3", ratio: 2 / 3 },
  { label: "3:4", value: "3:4", ratio: 3 / 4 },
  { label: "9:16", value: "9:16", ratio: 9 / 16 },
];

const HANDLES: { pos: HandlePos; cursor: string }[] = [
  { pos: "tl", cursor: "nwse-resize" },
  { pos: "tc", cursor: "ns-resize" },
  { pos: "tr", cursor: "nesw-resize" },
  { pos: "ml", cursor: "ew-resize" },
  { pos: "mr", cursor: "ew-resize" },
  { pos: "bl", cursor: "nesw-resize" },
  { pos: "bc", cursor: "ns-resize" },
  { pos: "br", cursor: "nwse-resize" },
];

const HANDLE_SIZE = 10;
const MIN_CROP = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleStyleFn(pos: HandlePos): React.CSSProperties {
  const off = -HANDLE_SIZE / 2;
  const base: React.CSSProperties = {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    background: "#fff",
    border: "2px solid #3b82f6",
    borderRadius: 2,
    zIndex: 10,
  };
  switch (pos) {
    case "tl":
      return { ...base, left: off, top: off };
    case "tc":
      return { ...base, left: "50%", marginLeft: off, top: off };
    case "tr":
      return { ...base, right: off, top: off };
    case "ml":
      return { ...base, left: off, top: "50%", marginTop: off };
    case "mr":
      return { ...base, right: off, top: "50%", marginTop: off };
    case "bl":
      return { ...base, left: off, bottom: off };
    case "bc":
      return { ...base, left: "50%", marginLeft: off, bottom: off };
    case "br":
      return { ...base, right: off, bottom: off };
  }
}

function clampCrop(
  crop: CropArea,
  maxW: number,
  maxH: number
): CropArea {
  let { x, y, width, height } = crop;
  width = Math.max(MIN_CROP, Math.min(width, maxW));
  height = Math.max(MIN_CROP, Math.min(height, maxH));
  x = Math.max(0, Math.min(x, maxW - width));
  y = Math.max(0, Math.min(y, maxH - height));
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function resizeCrop(
  start: CropArea,
  handle: HandlePos,
  dx: number,
  dy: number,
  ratio: number | null,
  imgW: number,
  imgH: number
): CropArea {
  let x = start.x;
  let y = start.y;
  let w = start.width;
  let h = start.height;

  const moveR = handle === "tr" || handle === "mr" || handle === "br";
  const moveL = handle === "tl" || handle === "ml" || handle === "bl";
  const moveB = handle === "bl" || handle === "bc" || handle === "br";
  const moveT = handle === "tl" || handle === "tc" || handle === "tr";

  if (moveR) w = start.width + dx;
  if (moveL) {
    w = start.width - dx;
    x = start.x + dx;
  }
  if (moveB) h = start.height + dy;
  if (moveT) {
    h = start.height - dy;
    y = start.y + dy;
  }

  w = Math.max(MIN_CROP, w);
  h = Math.max(MIN_CROP, h);

  if (ratio) {
    const isVEdge = handle === "tc" || handle === "bc";
    const isHEdge = handle === "ml" || handle === "mr";

    if (isVEdge) {
      w = h * ratio;
      x = start.x + start.width / 2 - w / 2;
    } else if (isHEdge) {
      h = w / ratio;
      y = start.y + start.height / 2 - h / 2;
    } else {
      h = w / ratio;
      if (moveT) y = start.y + start.height - h;
      if (moveL) x = start.x + start.width - w;
    }
  }

  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w > imgW) w = imgW - x;
  if (y + h > imgH) h = imgH - y;

  w = Math.max(MIN_CROP, w);
  h = Math.max(MIN_CROP, h);

  if (ratio) {
    const cur = w / h;
    if (cur > ratio) {
      w = h * ratio;
    } else if (cur < ratio) {
      h = w / ratio;
    }
  }

  return {
    x: Math.round(Math.max(0, x)),
    y: Math.round(Math.max(0, y)),
    width: Math.round(w),
    height: Math.round(h),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface CropEditorProps {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  showRotation?: boolean;
  onCrop: (cropArea: CropArea, rotation: 0 | 90 | 180 | 270) => void;
  onCancel?: () => void;
  actionLabel?: string;
}

export default function CropEditor({
  imageUrl,
  naturalWidth,
  naturalHeight,
  showRotation = true,
  onCrop,
  onCancel,
  actionLabel = "Crop IMAGE",
}: CropEditorProps) {
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [cropArea, setCropArea] = useState<CropArea>({
    x: 0,
    y: 0,
    width: naturalWidth,
    height: naturalHeight,
  });
  const [aspectRatio, setAspectRatio] = useState("free");
  const [scale, setScale] = useState(1);

  const editorRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<{
    type: "move" | "resize";
    handle?: HandlePos;
    startX: number;
    startY: number;
    startCrop: CropArea;
  } | null>(null);

  // Derived dimensions
  const isSwapped = rotation === 90 || rotation === 270;
  const rotatedWidth = isSwapped ? naturalHeight : naturalWidth;
  const rotatedHeight = isSwapped ? naturalWidth : naturalHeight;
  const displayWidth = rotatedWidth * scale;
  const displayHeight = rotatedHeight * scale;

  // Scale calculation
  useEffect(() => {
    if (!editorRef.current || rotatedWidth === 0 || rotatedHeight === 0) return;

    const update = () => {
      if (!editorRef.current) return;
      const maxW = editorRef.current.clientWidth;
      const maxH = 600;
      setScale(Math.min(maxW / rotatedWidth, maxH / rotatedHeight, 4));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(editorRef.current);
    return () => observer.disconnect();
  }, [rotatedWidth, rotatedHeight]);

  // Rotation
  const handleRotate = useCallback(
    (dir: "cw" | "ccw") => {
      const delta = dir === "cw" ? 90 : -90;
      const next = (((rotation + delta) % 360 + 360) % 360) as
        | 0
        | 90
        | 180
        | 270;
      setRotation(next);

      const swap = next === 90 || next === 270;
      const newW = swap ? naturalHeight : naturalWidth;
      const newH = swap ? naturalWidth : naturalHeight;
      setCropArea({ x: 0, y: 0, width: newW, height: newH });
      setAspectRatio("free");
    },
    [rotation, naturalWidth, naturalHeight]
  );

  // Aspect ratio preset
  const handleAspectRatioChange = useCallback(
    (value: string) => {
      setAspectRatio(value);
      const preset = ASPECT_PRESETS.find((p) => p.value === value);
      if (!preset?.ratio) return;

      const r = preset.ratio;
      let newW: number;
      let newH: number;
      if (rotatedWidth / rotatedHeight > r) {
        newH = rotatedHeight;
        newW = Math.round(newH * r);
      } else {
        newW = rotatedWidth;
        newH = Math.round(newW / r);
      }

      setCropArea({
        x: Math.round((rotatedWidth - newW) / 2),
        y: Math.round((rotatedHeight - newH) / 2),
        width: newW,
        height: newH,
      });
    },
    [rotatedWidth, rotatedHeight]
  );

  // Numeric input change
  const handleInputChange = useCallback(
    (field: keyof CropArea, value: number) => {
      setCropArea((prev) =>
        clampCrop(
          { ...prev, [field]: Math.max(0, value) },
          rotatedWidth,
          rotatedHeight
        )
      );
    },
    [rotatedWidth, rotatedHeight]
  );

  // Pointer interaction start
  const handleInteractionStart = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      type: "move" | "resize",
      handle?: HandlePos
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const pos =
        "touches" in e
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : {
              x: (e as React.MouseEvent).clientX,
              y: (e as React.MouseEvent).clientY,
            };

      interactionRef.current = {
        type,
        handle,
        startX: pos.x,
        startY: pos.y,
        startCrop: { ...cropArea },
      };
    },
    [cropArea]
  );

  // Global pointer move / end
  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      e.preventDefault();

      const pos =
        "touches" in e
          ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
          : { x: e.clientX, y: e.clientY };

      const dx = (pos.x - interaction.startX) / scale;
      const dy = (pos.y - interaction.startY) / scale;
      const start = interaction.startCrop;
      const ratio =
        ASPECT_PRESETS.find((p) => p.value === aspectRatio)?.ratio ?? null;

      if (interaction.type === "move") {
        setCropArea(
          clampCrop(
            {
              x: start.x + dx,
              y: start.y + dy,
              width: start.width,
              height: start.height,
            },
            rotatedWidth,
            rotatedHeight
          )
        );
      } else if (interaction.type === "resize" && interaction.handle) {
        setCropArea(
          resizeCrop(
            start,
            interaction.handle,
            dx,
            dy,
            ratio,
            rotatedWidth,
            rotatedHeight
          )
        );
      }
    };

    const handleEnd = () => {
      interactionRef.current = null;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleEnd);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [scale, aspectRatio, rotatedWidth, rotatedHeight]);

  // Reset all
  const handleResetAll = useCallback(() => {
    setRotation(0);
    setCropArea({
      x: 0,
      y: 0,
      width: naturalWidth,
      height: naturalHeight,
    });
    setAspectRatio("free");
  }, [naturalWidth, naturalHeight]);

  // Display crop coordinates (scaled)
  const cd = {
    x: cropArea.x * scale,
    y: cropArea.y * scale,
    w: cropArea.width * scale,
    h: cropArea.height * scale,
  };

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="w-full">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Left panel — image + crop overlay */}
        <div className="flex-1 min-w-0" ref={editorRef}>
          <div
            className="relative mx-auto select-none overflow-hidden rounded-lg border border-slate-200 bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]"
            style={{ width: displayWidth, height: displayHeight }}
          >
            {/* Image (CSS-rotated) */}
            <img
              src={imageUrl}
              alt="Source"
              draggable={false}
              className="pointer-events-none"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: naturalWidth * scale,
                height: naturalHeight * scale,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }}
            />

            {/* Dimming overlays */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ zIndex: 1 }}
            >
              <div
                className="absolute bg-black/50"
                style={{ top: 0, left: 0, right: 0, height: cd.y }}
              />
              <div
                className="absolute bg-black/50"
                style={{
                  top: cd.y + cd.h,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              <div
                className="absolute bg-black/50"
                style={{
                  top: cd.y,
                  left: 0,
                  width: cd.x,
                  height: cd.h,
                }}
              />
              <div
                className="absolute bg-black/50"
                style={{
                  top: cd.y,
                  left: cd.x + cd.w,
                  right: 0,
                  height: cd.h,
                }}
              />
            </div>

            {/* Crop box */}
            <div
              className="absolute border-2 border-blue-500"
              style={{
                left: cd.x,
                top: cd.y,
                width: cd.w,
                height: cd.h,
                cursor: "move",
                zIndex: 2,
              }}
              onMouseDown={(e) => handleInteractionStart(e, "move")}
              onTouchStart={(e) => handleInteractionStart(e, "move")}
            >
              {/* Rule of thirds grid */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
              </div>

              {/* Resize handles */}
              {HANDLES.map(({ pos, cursor }) => (
                <div
                  key={pos}
                  style={{ ...handleStyleFn(pos), cursor }}
                  onMouseDown={(e) =>
                    handleInteractionStart(e, "resize", pos)
                  }
                  onTouchStart={(e) =>
                    handleInteractionStart(e, "resize", pos)
                  }
                />
              ))}
            </div>
          </div>

          {/* Info below image */}
          <div className="mt-3 flex items-center justify-center gap-4 text-sm text-slate-500">
            <span>
              {cropArea.width} &times; {cropArea.height}px
            </span>
            {rotation !== 0 && <span>Rotated {rotation}&deg;</span>}
          </div>
        </div>

        {/* Right panel — sidebar */}
        <div className="w-full md:w-72 shrink-0 space-y-6">
          {/* Crop Options */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Crop Options
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { field: "width" as const, label: "Width" },
                  { field: "height" as const, label: "Height" },
                  { field: "x" as const, label: "Position X" },
                  { field: "y" as const, label: "Position Y" },
                ] as const
              ).map(({ field, label }) => (
                <div key={field}>
                  <label className="text-xs text-slate-500 mb-1 block">
                    {label} (px)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={cropArea[field]}
                    onChange={(e) =>
                      handleInputChange(
                        field,
                        parseInt(e.target.value) || 0
                      )
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Aspect Ratio
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {ASPECT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handleAspectRatioChange(preset.value)}
                  className={`px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                    aspectRatio === preset.value
                      ? "bg-blue-50 border-blue-500 text-blue-700"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Orientation (conditionally shown) */}
          {showRotation && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Orientation
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => handleRotate("ccw")}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
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
                <button
                  onClick={() => handleRotate("cw")}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  90&deg; CW
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
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3 pt-2">
            <button
              onClick={() => onCrop(cropArea, rotation)}
              className="w-full py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25 text-sm"
            >
              {actionLabel}
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="w-full py-2.5 text-accent-600 font-medium border border-accent-200 rounded-xl hover:bg-accent-50 transition-colors text-sm"
              >
                Back
              </button>
            )}
            <button
              onClick={handleResetAll}
              className="w-full py-2.5 text-slate-600 font-medium border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm"
            >
              Reset All
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
