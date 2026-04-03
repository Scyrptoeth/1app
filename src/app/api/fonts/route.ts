import { NextRequest, NextResponse } from "next/server";

const TTF_USER_AGENT = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)";

export async function GET(request: NextRequest) {
  const family = request.nextUrl.searchParams.get("family");
  const weight = request.nextUrl.searchParams.get("weight") || "400";

  if (!family) {
    return NextResponse.json(
      { error: "family parameter required" },
      { status: 400 }
    );
  }

  try {
    // Google Fonts returns .ttf URLs when User-Agent doesn't support woff2
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`;
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": TTF_USER_AGENT },
    });

    if (!cssRes.ok) {
      return NextResponse.json({ error: "Font not found" }, { status: 404 });
    }

    const css = await cssRes.text();
    const urlMatch = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/);

    if (!urlMatch) {
      return NextResponse.json(
        { error: "Could not resolve font URL" },
        { status: 500 }
      );
    }

    const fontRes = await fetch(urlMatch[1]);
    if (!fontRes.ok) {
      return NextResponse.json(
        { error: "Failed to download font" },
        { status: 502 }
      );
    }

    return new NextResponse(await fontRes.arrayBuffer(), {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
