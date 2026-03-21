"use client";

interface ProcessingViewProps {
  fileName: string;
  progress: number; // 0-100
  status: string;
}

export default function ProcessingView({
  fileName,
  progress,
  status,
}: ProcessingViewProps) {
  return (
    <div className="w-full max-w-md mx-auto text-center">
      {/* Spinner */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <svg className="w-20 h-20 animate-spin-slow" viewBox="0 0 80 80">
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="4"
          />
          <circle
            cx="40"
            cy="40"
            r="36"
            fill="none"
            stroke="#2563eb"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${progress * 2.26} 226`}
            transform="rotate(-90 40 40)"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-accent-600">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      <h3 className="text-lg font-semibold text-slate-900 mb-1">
        Processing...
      </h3>
      <p className="text-sm text-slate-500 mb-1">{fileName}</p>
      <p className="text-xs text-slate-400">{status}</p>

      {/* Progress bar */}
      <div className="mt-6 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
