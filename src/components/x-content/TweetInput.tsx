"use client";

import { useState, useRef, useEffect } from "react";
import { Link2, Plus, X, Download, Loader2, Check } from "lucide-react";

interface TweetInputProps {
  onFetch: (urls: string[], mode: "single" | "thread") => void;
  isLoading: boolean;
}

const URL_PATTERN = /(?:twitter\.com|x\.com)\/\w+\/status\/\d+/;

function isValidUrl(url: string): boolean {
  return URL_PATTERN.test(url.trim());
}

export default function TweetInput({ onFetch, isLoading }: TweetInputProps) {
  const [mode, setMode] = useState<"single" | "thread">("single");
  const [urls, setUrls] = useState<string[]>([""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (mode === "single" && urls.length > 1) {
      setUrls([urls[0]]);
    }
  }, [mode]);

  const updateUrl = (index: number, value: string) => {
    const next = [...urls];
    next[index] = value;
    setUrls(next);
  };

  const addUrl = () => {
    setUrls((prev) => [...prev, ""]);
    setTimeout(() => {
      const lastIdx = urls.length;
      inputRefs.current[lastIdx]?.focus();
    }, 50);
  };

  const removeUrl = (index: number) => {
    if (urls.length <= 1) return;
    setUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const validUrls = urls.filter((u) => isValidUrl(u));
  const canSubmit =
    !isLoading &&
    (mode === "single" ? isValidUrl(urls[0]) : validUrls.length >= 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (mode === "single") {
      onFetch([urls[0].trim()], "single");
    } else {
      onFetch(
        validUrls.map((u) => u.trim()),
        "thread"
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      {/* URL Input(s) */}
      <div className="space-y-3">
        {urls.map((url, index) => (
          <div key={index} className="relative flex items-center gap-2">
            {mode === "thread" && (
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-accent-50 border border-accent-200 flex items-center justify-center text-accent-600 text-xs font-bold">
                {index + 1}
              </span>
            )}

            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Link2 size={18} className="text-slate-400" />
              </div>
              <input
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="text"
                value={url}
                onChange={(e) => updateUrl(index, e.target.value)}
                placeholder={
                  mode === "thread" && index > 0
                    ? `Paste post #${index + 1} URL from the thread...`
                    : "Paste X post link here..."
                }
                className="w-full pl-11 pr-20 py-3 bg-white border border-slate-200 rounded-xl
                  text-slate-900 placeholder:text-slate-400 text-[15px]
                  focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500
                  transition-colors duration-150"
                disabled={isLoading}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-2">
                {url && (
                  <>
                    {isValidUrl(url) ? (
                      <span className="text-emerald-500 text-[13px] font-medium flex items-center gap-1">
                        <Check size={14} />
                        Valid
                      </span>
                    ) : (
                      <span className="text-red-500 text-[13px]">Invalid</span>
                    )}
                  </>
                )}
                {mode === "thread" && urls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeUrl(index)}
                    className="p-1 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove this URL"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {mode === "thread" && (
          <button
            type="button"
            onClick={addUrl}
            disabled={isLoading}
            className="w-full py-2.5 border border-dashed border-slate-200 rounded-xl
              text-slate-500 text-[13px] font-medium
              hover:border-accent-300 hover:text-accent-600 hover:bg-accent-50/50
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors duration-150 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            Add another post from this thread
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      <div className="flex items-center gap-3">
        <span className="text-slate-500 text-[13px]">Mode:</span>
        <div className="flex bg-slate-100 rounded-full p-0.5">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`px-4 py-1.5 rounded-full text-[13px] font-bold transition-colors duration-150 ${
              mode === "single"
                ? "bg-accent-500 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Single Post
          </button>
          <button
            type="button"
            onClick={() => setMode("thread")}
            className={`px-4 py-1.5 rounded-full text-[13px] font-bold transition-colors duration-150 ${
              mode === "thread"
                ? "bg-accent-500 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            Thread
          </button>
        </div>
        {mode === "thread" && validUrls.length > 0 && (
          <span className="text-accent-600 text-[13px]">
            {validUrls.length} post{validUrls.length !== 1 ? "s" : ""} ready
          </span>
        )}
      </div>

      {mode === "thread" && (
        <p className="text-slate-400 text-[13px] leading-relaxed">
          Paste each post URL from the thread. They will be fetched in parallel
          and sorted by posting time.
        </p>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-3 bg-accent-500 text-white font-bold text-[15px] rounded-xl
          hover:bg-accent-600 active:scale-[0.98]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-accent-500
          transition-all duration-150 flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            {mode === "thread"
              ? `Extracting ${validUrls.length} post${validUrls.length !== 1 ? "s" : ""}...`
              : "Extracting..."}
          </>
        ) : (
          <>
            <Download size={20} />
            Extract Content
          </>
        )}
      </button>
    </form>
  );
}
