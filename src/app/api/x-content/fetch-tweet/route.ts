import { NextRequest, NextResponse } from "next/server";
import { parseTweetUrl } from "@/lib/tools/x-content/tweet-parser";
import {
  fetchFromFxTwitter,
  fetchTweetFromSyndication,
  transformSyndicationData,
} from "@/lib/tools/x-content/twitter-api";

/**
 * Fetch tweet data using FXTwitter API (primary) with Syndication API fallback.
 * FXTwitter returns full text for Note Tweets and article content for X Articles.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body as { url: string };

    if (!url) {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    const parsed = parseTweetUrl(url);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid X/Twitter URL format" },
        { status: 400 }
      );
    }

    // Try FXTwitter first (full Note Tweet text + Article content)
    const fxResult = await fetchFromFxTwitter(parsed.tweetId);
    if (fxResult) {
      fxResult.sourceUrl = url;
      return NextResponse.json({ tweet: fxResult });
    }

    // Fallback to Syndication API
    const rawData = await fetchTweetFromSyndication(parsed.tweetId);
    const tweetData = transformSyndicationData(
      rawData as Record<string, unknown>,
      url
    );

    return NextResponse.json({ tweet: tweetData });
  } catch (error) {
    console.error("Failed to fetch tweet:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch tweet data",
      },
      { status: 500 }
    );
  }
}
