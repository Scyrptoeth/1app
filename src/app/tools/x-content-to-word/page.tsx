"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import { HowItWorks } from "@/components/HowItWorks";
import TweetInput from "@/components/x-content/TweetInput";
import TweetPreview from "@/components/x-content/TweetPreview";
import ExportButtons from "@/components/x-content/ExportButtons";
import { getToolById } from "@/config/tools";
import type { TweetData, ThreadData } from "@/lib/tools/x-content/types";

export default function XContentToWordPage() {
  const tool = getToolById("x-content-to-word")!;

  const [tweet, setTweet] = useState<TweetData | null>(null);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            title: "Export as Word",
            desc: "Download a clean, formatted .docx document ready to edit or archive. Tweet data is fetched securely through our server, and no X/Twitter login is required.",
          },
        ]}
      />

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
          visibleFormats={["docx"]}
        />

      </div>
    </ToolPageLayout>
  );
}
