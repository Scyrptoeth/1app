"use client";

import { useState } from "react";
import { FileText, FileType, Loader2 } from "lucide-react";
import type { TweetData, ThreadData, ExportFormat } from "@/lib/tools/x-content/types";

interface ExportButtonsProps {
  tweet?: TweetData | null;
  thread?: ThreadData | null;
  /** Which export formats to show. Defaults to both. */
  visibleFormats?: ExportFormat[];
}

export default function ExportButtons({
  tweet,
  thread,
  visibleFormats = ["pdf", "docx"],
}: ExportButtonsProps) {
  const [generating, setGenerating] = useState<ExportFormat | null>(null);

  const hasData = !!(tweet || thread);

  const getFilename = (ext: string) => {
    const author = thread
      ? thread.author.username
      : tweet
        ? tweet.author.username
        : "unknown";
    const id = thread
      ? thread.tweets[0]?.id || "thread"
      : tweet
        ? tweet.id
        : "tweet";
    return `x-extract-${author}-${id}.${ext}`;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: ExportFormat) => {
    if (!hasData || generating) return;

    setGenerating(format);

    try {
      const data = thread || tweet;

      if (format === "pdf") {
        const { generatePDF } = await import("@/lib/tools/x-content/pdf-generator");
        const blob = await generatePDF(data!);
        downloadBlob(blob, getFilename("pdf"));
      } else {
        const { generateDOCX } = await import("@/lib/tools/x-content/docx-generator");
        const blob = await generateDOCX(data!);
        downloadBlob(blob, getFilename("docx"));
      }
    } catch (error) {
      console.error(`Failed to generate ${format}:`, error);
      alert(`Failed to generate ${format.toUpperCase()}. Please try again.`);
    } finally {
      setGenerating(null);
    }
  };

  if (!hasData) return null;

  const showPdf = visibleFormats.includes("pdf");
  const showDocx = visibleFormats.includes("docx");

  return (
    <div className="animate-fade-in space-y-3">
      <h2 className="text-[15px] font-bold text-slate-900">Export</h2>
      <div className="flex gap-3">
        {showPdf && (
          <button
            onClick={() => handleExport("pdf")}
            disabled={!!generating}
            className="flex-1 py-3 px-5 bg-accent-500 text-white font-bold text-[15px] rounded-xl
              hover:bg-accent-600 active:scale-[0.98]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-150 flex items-center justify-center gap-2"
          >
            {generating === "pdf" ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText size={20} />
                Download PDF
              </>
            )}
          </button>
        )}

        {showDocx && (
          <button
            onClick={() => handleExport("docx")}
            disabled={!!generating}
            className={`flex-1 py-3 px-5 font-bold text-[15px] rounded-xl
              active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
              transition-all duration-150 flex items-center justify-center gap-2
              ${showPdf
                ? "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                : "bg-accent-500 text-white hover:bg-accent-600"
              }`}
          >
            {generating === "docx" ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileType size={20} />
                Download Word
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
