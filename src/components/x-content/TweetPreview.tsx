"use client";

import { Heart, Repeat2, MessageCircle, Eye } from "lucide-react";
import type { TweetData, TweetMedia, ThreadData } from "@/lib/tools/x-content/types";

interface TweetPreviewProps {
  tweet?: TweetData | null;
  thread?: ThreadData | null;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function renderArticleContent(text: string, media: TweetMedia[]) {
  const segments = text.split(/(\{\{IMG:\d+\}\})/);
  return segments.map((segment, i) => {
    const match = segment.match(/\{\{IMG:(\d+)\}\}/);
    if (match) {
      const imgIndex = parseInt(match[1]);
      const img = media[imgIndex];
      if (img && img.type === "photo") {
        return (
          <div key={`img-${i}`} className="rounded-xl overflow-hidden border border-slate-200 my-1">
            <img
              src={img.url}
              alt={`Article image ${imgIndex + 1}`}
              className="w-full h-auto"
            />
          </div>
        );
      }
      return null;
    }
    const trimmed = segment.trim();
    if (trimmed) {
      return (
        <p key={`text-${i}`} className="text-slate-800 text-[15px] leading-relaxed whitespace-pre-wrap">
          {trimmed}
        </p>
      );
    }
    return null;
  });
}

function SingleTweetCard({ tweet, index }: { tweet: TweetData; index?: number }) {
  const isInlineArticle = tweet.isArticle && tweet.text.includes("{{IMG:");

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 shadow-sm">
      {/* Author Row */}
      <div className="flex items-center gap-3">
        {tweet.author.profileImageUrl && (
          <img
            src={tweet.author.profileImageUrl}
            alt={tweet.author.name}
            className="w-10 h-10 rounded-full"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {index !== undefined && (
              <span className="text-accent-600 text-[13px] font-bold mr-1">
                #{index + 1}
              </span>
            )}
            <span className="font-bold text-[15px] text-slate-900 truncate">
              {tweet.author.name}
            </span>
            {tweet.author.verified && (
              <svg className="w-[18px] h-[18px] text-accent-500 flex-shrink-0" viewBox="0 0 22 22" fill="currentColor">
                <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
              </svg>
            )}
          </div>
          <span className="text-slate-500 text-[13px]">@{tweet.author.username}</span>
        </div>
        <span className="text-slate-400 text-[13px] flex-shrink-0">
          {formatDate(tweet.createdAt)}
        </span>
      </div>

      {/* Article Title */}
      {tweet.isArticle && tweet.articleTitle && (
        <div className="space-y-1.5">
          <span className="inline-block text-[12px] font-bold px-2 py-0.5 rounded bg-accent-50 text-accent-600">
            Article
          </span>
          <h3 className="text-slate-900 font-bold text-[17px] leading-snug">
            {tweet.articleTitle}
          </h3>
        </div>
      )}

      {/* Tweet Text */}
      {isInlineArticle ? (
        <div className="space-y-3">
          {renderArticleContent(tweet.text, tweet.media)}
        </div>
      ) : (
        <p className="text-slate-800 text-[15px] leading-relaxed whitespace-pre-wrap">
          {tweet.text}
        </p>
      )}

      {/* Media grid */}
      {!isInlineArticle && tweet.media.length > 0 && (
        <div className="grid gap-0.5 rounded-xl overflow-hidden border border-slate-200" style={{
          gridTemplateColumns: tweet.media.length === 1 ? "1fr" : "1fr 1fr",
        }}>
          {tweet.media.map((m, i) => (
            <div key={i} className="overflow-hidden">
              {m.type === "photo" ? (
                <img
                  src={m.url}
                  alt={m.altText || `Image ${i + 1}`}
                  className="w-full h-auto object-cover max-h-72"
                />
              ) : (
                <div className="bg-slate-50 p-4 flex items-center justify-center gap-2 text-slate-500 text-[13px]">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Video content
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quoted Tweet */}
      {tweet.quotedTweet && (
        <div className="border border-slate-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-bold text-[13px] text-slate-900">
              {tweet.quotedTweet.author.name}
            </span>
            <span className="text-slate-500 text-[13px]">
              @{tweet.quotedTweet.author.username}
            </span>
          </div>
          <p className="text-slate-600 text-[13px] leading-relaxed">
            {tweet.quotedTweet.text}
          </p>
        </div>
      )}

      {/* Metrics */}
      <div className="flex items-center gap-5 pt-2 border-t border-slate-100">
        <span className="text-slate-400 text-[13px] flex items-center gap-1.5 hover:text-red-500 transition-colors cursor-default">
          <Heart size={18} />
          {formatNumber(tweet.metrics.likes)}
        </span>
        <span className="text-slate-400 text-[13px] flex items-center gap-1.5 hover:text-emerald-500 transition-colors cursor-default">
          <Repeat2 size={18} />
          {formatNumber(tweet.metrics.retweets)}
        </span>
        <span className="text-slate-400 text-[13px] flex items-center gap-1.5 hover:text-accent-500 transition-colors cursor-default">
          <MessageCircle size={18} />
          {formatNumber(tweet.metrics.replies)}
        </span>
        {tweet.metrics.views !== undefined && (
          <span className="text-slate-400 text-[13px] flex items-center gap-1.5 cursor-default">
            <Eye size={18} />
            {formatNumber(tweet.metrics.views)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TweetPreview({ tweet, thread }: TweetPreviewProps) {
  if (!tweet && !thread) return null;

  return (
    <div className="animate-fade-in space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-slate-900">Preview</h2>
        {thread && thread.totalTweets > 1 && (
          <span className="text-accent-600 text-[13px] font-bold px-3 py-1 bg-accent-50 rounded-full">
            Thread · {thread.totalTweets} posts
          </span>
        )}
      </div>

      {thread ? (
        <div className="space-y-3">
          {thread.tweets.map((t, i) => (
            <SingleTweetCard key={t.id} tweet={t} index={i} />
          ))}
        </div>
      ) : tweet ? (
        <SingleTweetCard tweet={tweet} />
      ) : null}
    </div>
  );
}
