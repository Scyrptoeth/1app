/**
 * Shared types for X Content extraction tools.
 */

export interface TweetMediaPhoto {
  type: "photo";
  url: string;
  width: number;
  height: number;
  altText?: string;
}

export interface TweetMediaVideo {
  type: "video";
  thumbnailUrl: string;
  url?: string;
  duration?: number;
}

export type TweetMedia = TweetMediaPhoto | TweetMediaVideo;

export interface TweetData {
  id: string;
  text: string;
  author: {
    name: string;
    username: string;
    profileImageUrl: string;
    verified?: boolean;
  };
  createdAt: string;
  media: TweetMedia[];
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  quotedTweet?: TweetData;
  sourceUrl: string;
  isThread?: boolean;
  /** True when the tweet is an X Article (long-form content). */
  isArticle?: boolean;
  /** Title of the X Article, if applicable. */
  articleTitle?: string;
}

export interface ThreadData {
  tweets: TweetData[];
  author: {
    name: string;
    username: string;
    profileImageUrl: string;
  };
  totalTweets: number;
  sourceUrl: string;
}

export type ExportFormat = "pdf" | "docx";

export interface ExportOptions {
  format: ExportFormat;
  includeImages: boolean;
  includeMetrics: boolean;
  includeTimestamp: boolean;
}
