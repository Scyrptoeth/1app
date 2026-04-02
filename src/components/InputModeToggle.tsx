"use client";

export type InputMode = "file" | "camera";

interface InputModeToggleProps {
  mode: InputMode;
  onModeChange: (mode: InputMode) => void;
  hasCameraSupport: boolean;
}

export default function InputModeToggle({
  mode,
  onModeChange,
  hasCameraSupport,
}: InputModeToggleProps) {
  if (!hasCameraSupport) return null;

  return (
    <div className="flex items-center justify-center mb-4">
      <div className="inline-flex items-center bg-slate-100 rounded-lg p-0.5">
        <button
          onClick={() => onModeChange("file")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-all ${
            mode === "file"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload File
        </button>
        <button
          onClick={() => onModeChange("camera")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md transition-all ${
            mode === "camera"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="13" r="4" />
            <path d="M9.5 3h5l1.5 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4Z" />
          </svg>
          Use Camera
        </button>
      </div>
    </div>
  );
}
