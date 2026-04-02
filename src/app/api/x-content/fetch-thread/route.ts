import { NextRequest, NextResponse } from "next/server";
import { fetchThreadFromUrls } from "@/lib/tools/x-content/twitter-api";

/**
 * Fetch thread data from multiple tweet URLs.
 * Each URL is fetched individually via FXTwitter API, then combined
 * into a single ThreadData sorted by creation time.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body as { urls: string[] };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "At least one URL is required" },
        { status: 400 }
      );
    }

    if (urls.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 tweet URLs per request" },
        { status: 400 }
      );
    }

    const threadData = await fetchThreadFromUrls(urls);

    return NextResponse.json({ thread: threadData });
  } catch (error) {
    console.error("Failed to fetch thread:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch thread data",
      },
      { status: 500 }
    );
  }
}
