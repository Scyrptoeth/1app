"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { HowItWorks } from "@/components/HowItWorks";
import TweetInput from "@/components/x-content/TweetInput";
import TweetPreview from "@/components/x-content/TweetPreview";
import ExportButtons from "@/components/x-content/ExportButtons";
import { PdfPageManager, type PageConfig } from "@/components/PdfPageManager";
import { applyPageModifications } from "@/lib/tools/pdf-page-utils";
import { getToolById } from "@/config/tools";
import type { TweetData, ThreadData } from "@/lib/tools/x-content/types";

type Stage = "input" | "configure";

export default function XContentToPdfPage() {
  const tool = getToolById("x-content-to-pdf")!;

  const [stage, setStage] = useState<Stage>("input");
  const [tweet, setTweet] = useState<TweetData | null>(null);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PDF file + filename for page management stage
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>("");

  const handleFetch = useCallback(
    async (urls: string[], mode: "single" | "thread") => {
      setIsLoading(true);
      setError(null);
      setTweet(null);
      setThread(null);

      try {
        if (mode === "thread" || urls.length > 1) {
          const res = await fetch("/api/x-content/fetch-thread", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to fetch thread");
          setThread(data.thread);
        } else {
          const res = await fetch("/api/x-content/fetch-tweet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: urls[0] }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to fetch tweet");
          setTweet(data.tweet);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const handlePdfGenerated = useCallback((blob: Blob, filename: string) => {
    const file = new File([blob], filename, { type: "application/pdf" });
    setPdfFile(file);
    setPdfFilename(filename);
    setStage("configure");
  }, []);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handlePageConfirm = useCallback(
    async (pages: PageConfig[]) => {
      if (!pdfFile) return;

      const hasModifications =
        pages.some((p) => !p.included) ||
        pages.some((p) => p.rotation !== 0) ||
        pages.some((p, i) => p.originalIndex !== i);

      if (hasModifications) {
        try {
          const arrayBuffer = await pdfFile.arrayBuffer();
          const modifiedBytes = await applyPageModifications(arrayBuffer, pages);
          downloadBlob(new Blob([modifiedBytes], { type: "application/pdf" }), pdfFilename);
        } catch (err) {
          console.error("Page modification failed:", err);
          alert("Failed to apply page modifications. Please try again.");
          return;
        }
      } else {
        downloadBlob(pdfFile, pdfFilename);
      }

      // Return to input stage after download
      setPdfFile(null);
      setPdfFilename("");
      setStage("input");
    },
    [pdfFile, pdfFilename, downloadBlob]
  );

  const handlePageCancel = useCallback(() => {
    setPdfFile(null);
    setPdfFilename("");
    setStage("input");
  }, []);

  return (
    <ToolPageLayout
      tool={tool}
      privacyMessage="Content is fetched via API. No files are stored on our servers."
    >
      <HowItWorks
        steps={[
          {
            step: "1",
            title: "Paste Post URL",
            desc: "Copy and paste the link of any X (Twitter) post or thread. You can also add multiple URLs to combine them into one document.",
          },
          {
            step: "2",
            title: "Preview Content",
            desc: "The full post content is fetched and displayed, including text, images, and engagement metrics.",
          },
          {
            step: "3",
            title: "Export as PDF",
            desc: "Generate a clean, formatted PDF from the post content. Tweet data is fetched securely through our server, and no X/Twitter login is required.",
          },
          {
            step: "4",
            title: "Manage Pages and Download",
            desc: "Optionally rotate, reorder, or remove pages, then download the final PDF ready to share or archive.",
          },
        ]}
      />

      {stage === "input" && (
        <div className="space-y-8">
          <TweetInput onFetch={handleFetch} isLoading={isLoading} />

          {error && (
            <div className="animate-fade-in p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
              {error}
            </div>
          )}

          <TweetPreview tweet={tweet} thread={thread} />

          <ExportButtons
            tweet={tweet}
            thread={thread}
            visibleFormats={["pdf"]}
            onPdfGenerated={handlePdfGenerated}
          />
        </div>
      )}

      {stage === "configure" && pdfFile && (
        <PdfPageManager
          file={pdfFile}
          onConfirm={handlePageConfirm}
          onCancel={handlePageCancel}
          confirmLabel="Download PDF"
          cancelLabel="Back"
          requireChanges={false}
        />
      )}
    </ToolPageLayout>
  );
}
