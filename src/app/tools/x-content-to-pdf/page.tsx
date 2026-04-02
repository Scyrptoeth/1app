"use client";

import { useState, useCallback } from "react";
import ToolPageLayout from "@/components/ToolPageLayout";
import TweetInput from "@/components/x-content/TweetInput";
import TweetPreview from "@/components/x-content/TweetPreview";
import ExportButtons from "@/components/x-content/ExportButtons";
import { getToolById } from "@/config/tools";
import type { TweetData, ThreadData } from "@/lib/tools/x-content/types";

export default function XContentToPdfPage() {
  const tool = getToolById("x-content-to-pdf")!;

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
      privacyMessage="Content is fetched via API — no files are stored on our servers"
    >
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
        />

        {/* How it works */}
        {!tweet && !thread && !isLoading && (
          <div className="pt-8 border-t border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              How it works
            </h2>
            <div className="grid sm:grid-cols-3 gap-6">
              {[
                {
                  step: "1",
                  title: "Paste URL",
                  desc: "Copy the link of any X post, thread, or article",
                },
                {
                  step: "2",
                  title: "Extract Content",
                  desc: "We fetch the full content including images and metrics",
                },
                {
                  step: "3",
                  title: "Download PDF",
                  desc: "Get a clean, formatted PDF document ready to share",
                },
              ].map((item) => (
                <div key={item.step} className="text-center space-y-2">
                  <div className="w-8 h-8 rounded-full bg-accent-50 text-accent-600 font-bold text-sm flex items-center justify-center mx-auto">
                    {item.step}
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">
                    {item.title}
                  </h3>
                  <p className="text-slate-500 text-xs">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ToolPageLayout>
  );
}
