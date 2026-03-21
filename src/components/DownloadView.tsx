"use client";

interface DownloadViewProps {
  fileName: string;
  fileSize: string;
  onDownload: () => void;
  onReset: () => void;
  previewUrl?: string;
}

export default function DownloadView({
  fileName,
  fileSize,
  onDownload,
  onReset,
  previewUrl,
}: DownloadViewProps) {
  return (
    <div className="w-full max-w-lg mx-auto text-center">
      {/* Success icon */}
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-emerald-500"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-slate-900 mb-1">
        Processing complete!
      </h3>
      <p className="text-sm text-slate-500 mb-6">
        Your file is ready to download.
      </p>

      {/* Preview */}
      {previewUrl && (
        <div className="mb-6 rounded-xl overflow-hidden border border-slate-100 shadow-sm">
          <img
            src={previewUrl}
            alt="Preview"
            className="w-full max-h-64 object-contain bg-slate-50"
          />
        </div>
      )}

      {/* File info card */}
      <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-slate-400"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className="text-left min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">
            {fileName}
          </p>
          <p className="text-xs text-slate-500">{fileSize}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={onDownload}
          className="w-full sm:w-auto flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-accent-500 text-white font-semibold rounded-xl hover:bg-accent-600 active:bg-accent-700 transition-colors shadow-md shadow-accent-500/25"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download File
        </button>

        <button
          onClick={onReset}
          className="w-full sm:w-auto px-6 py-3 text-slate-600 font-medium rounded-xl border border-slate-200 hover:bg-slate-50 transition-colors"
        >
          Process Another
        </button>
      </div>
    </div>
  );
}
