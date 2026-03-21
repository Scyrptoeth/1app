"use client";

import { useCallback, useState, useRef } from "react";

interface FileUploaderProps {
  acceptedFormats: string[];
  maxSizeMB?: number;
  multiple?: boolean;
  onFilesSelected: (files: File[]) => void;
  title?: string;
  subtitle?: string;
}

export default function FileUploader({
  acceptedFormats,
  maxSizeMB = 50,
  multiple = false,
  onFilesSelected,
  title,
  subtitle,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptString = acceptedFormats
    .map((f) => {
      if (f === ".jpg" || f === ".jpeg") return "image/jpeg";
      if (f === ".png") return "image/png";
      if (f === ".pdf") return "application/pdf";
      return f;
    })
    .join(",");

  const validateFiles = useCallback(
    (files: FileList | File[]): File[] => {
      const valid: File[] = [];
      const maxBytes = maxSizeMB * 1024 * 1024;

      for (const file of Array.from(files)) {
        // Check size
        if (file.size > maxBytes) {
          setError(`File "${file.name}" exceeds ${maxSizeMB}MB limit.`);
          return [];
        }

        // Check extension
        const ext = "." + file.name.split(".").pop()?.toLowerCase();
        if (!acceptedFormats.includes(ext)) {
          setError(
            `File "${file.name}" is not a supported format. Accepted: ${acceptedFormats.join(", ")}`
          );
          return [];
        }

        valid.push(file);
      }

      setError(null);
      return valid;
    },
    [acceptedFormats, maxSizeMB]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = validateFiles(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesSelected(multiple ? files : [files[0]]);
      }
    },
    [validateFiles, onFilesSelected, multiple]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      const files = validateFiles(e.target.files);
      if (files.length > 0) {
        onFilesSelected(multiple ? files : [files[0]]);
      }
    },
    [validateFiles, onFilesSelected, multiple]
  );

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center px-8 py-16 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300 ${
          isDragging
            ? "border-accent-500 bg-accent-50/50 drop-zone-active"
            : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50"
        }`}
      >
        {/* Upload icon */}
        <div
          className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-5 transition-colors ${
            isDragging ? "bg-accent-100" : "bg-white shadow-sm"
          }`}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-colors ${
              isDragging ? "text-accent-500" : "text-slate-400"
            }`}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <h3 className="text-base font-semibold text-slate-800 mb-1">
          {title || (isDragging ? "Drop your file here" : "Select your file")}
        </h3>
        <p className="text-sm text-slate-500 mb-4">
          {subtitle || "or drag and drop it here"}
        </p>

        {/* Format badges */}
        <div className="flex items-center gap-1.5">
          {acceptedFormats.map((fmt) => (
            <span
              key={fmt}
              className="px-2 py-0.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-md"
            >
              {fmt.toUpperCase()}
            </span>
          ))}
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Max {maxSizeMB}MB per file
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={acceptString}
          multiple={multiple}
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-100 rounded-xl">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-red-500 shrink-0"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="text-sm text-red-600">{error}</span>
        </div>
      )}
    </div>
  );
}
