import jsPDF from "jspdf";
import type { TweetData, ThreadData } from "./types";

/**
 * Convert image URL to base64 data URL for embedding in PDF.
 */
async function imageToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Render a single image into the PDF at the current y position.
 * Returns the new y position after the image.
 */
async function renderImageInPDF(
  doc: jsPDF,
  imageUrl: string,
  imageWidth: number,
  imageHeight: number,
  y: number,
  margin: number,
  contentWidth: number,
  pageHeight: number
): Promise<number> {
  const base64 = await imageToBase64(imageUrl);
  if (base64) {
    const imgWidth = Math.min(contentWidth, 120);
    const aspectRatio = imageHeight / imageWidth || 0.66;
    const imgHeight = Math.min(imgWidth * aspectRatio, 80);

    if (y + imgHeight > pageHeight - 25) {
      doc.addPage();
      y = margin;
    }

    try {
      doc.addImage(base64, "JPEG", margin, y, imgWidth, imgHeight);
      y += imgHeight + 5;
    } catch {
      doc.setTextColor(150, 150, 150);
      doc.setFontSize(9);
      doc.text(`[Image: ${imageUrl}]`, margin, y);
      y += 6;
    }
  }
  return y;
}

/**
 * Render text lines into the PDF, handling page breaks.
 * Lines starting with ## are rendered as bold headings (## removed).
 * Returns the new y position.
 */
function renderTextLines(
  doc: jsPDF,
  text: string,
  y: number,
  margin: number,
  contentWidth: number,
  pageHeight: number
): number {
  const rawLines = text.split(/\n/);

  for (const para of rawLines) {
    if (!para.trim()) {
      y += 3;
      continue;
    }

    const isHeading = para.trimStart().startsWith("## ");
    const displayText = isHeading ? para.trimStart().slice(3) : para;

    if (!displayText.trim()) continue;

    if (isHeading) {
      y += 2;
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(30, 30, 30);
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
    }

    const lines = doc.splitTextToSize(displayText, contentWidth);
    for (const line of lines) {
      if (y > pageHeight - 25) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += isHeading ? 6 : 5.5;
    }
    y += isHeading ? 5 : 4;
  }
  return y;
}

/**
 * Generate PDF from tweet data with embedded images.
 * For articles, images are rendered inline at their original positions.
 */
export async function generatePDF(
  data: TweetData | ThreadData
): Promise<Blob> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const isThread = "tweets" in data;
  const tweets = isThread ? (data as ThreadData).tweets : [data as TweetData];
  const author = isThread
    ? (data as ThreadData).author
    : (data as TweetData).author;

  // === HEADER BAR ===
  doc.setFillColor(0, 30, 43); // #001E2B
  doc.rect(0, 0, pageWidth, 35, "F");

  // Green accent line
  doc.setFillColor(0, 237, 100); // #00ED64
  doc.rect(0, 35, pageWidth, 1.5, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("X Content Extract", margin, 15);

  // Author info
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(232, 237, 235); // #E8EDEB
  doc.text(`@${author.username} · ${author.name}`, margin, 23);

  // Date & source
  doc.setFontSize(8);
  doc.setTextColor(150, 170, 165);
  const sourceUrl = isThread
    ? (data as ThreadData).sourceUrl
    : (data as TweetData).sourceUrl;
  doc.text(`Source: ${sourceUrl}`, margin, 30);

  if (isThread) {
    doc.text(
      `Thread · ${(data as ThreadData).totalTweets} tweets`,
      pageWidth - margin - 35,
      30
    );
  }

  y = 42;

  // === TWEET CONTENT ===
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];

    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    // Thread index marker
    if (isThread && tweets.length > 1) {
      doc.setFillColor(0, 237, 100);
      doc.circle(margin + 3, y + 2, 3, "F");
      doc.setTextColor(0, 30, 43);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text(`${i + 1}`, margin + 1.8, y + 3.2);

      doc.setTextColor(150, 170, 165);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(formatDate(tweet.createdAt), margin + 10, y + 3);
      y += 10;
    } else {
      doc.setTextColor(150, 170, 165);
      doc.setFontSize(8);
      doc.text(formatDate(tweet.createdAt), margin, y + 3);
      y += 8;
    }

    // Article title (if X Article)
    if (tweet.isArticle && tweet.articleTitle) {
      doc.setTextColor(0, 104, 74); // #00684A
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text("[Article]", margin, y);
      y += 6;

      doc.setTextColor(0, 30, 43);
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      const titleLines = doc.splitTextToSize(tweet.articleTitle, contentWidth);
      for (const line of titleLines) {
        if (y > pageHeight - 25) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 7;
      }
      y += 3;
    }

    // === ARTICLE WITH INLINE IMAGES ===
    const isInlineArticle = tweet.isArticle && tweet.text.includes("{{IMG:");

    if (isInlineArticle) {
      const segments = tweet.text.split(/(\{\{IMG:\d+\}\})/);

      for (const segment of segments) {
        const match = segment.match(/\{\{IMG:(\d+)\}\}/);
        if (match) {
          const imgIndex = parseInt(match[1]);
          const mediaItem = tweet.media[imgIndex];
          if (mediaItem?.type === "photo") {
            y = await renderImageInPDF(
              doc,
              mediaItem.url,
              mediaItem.width || 500,
              mediaItem.height || 330,
              y,
              margin,
              contentWidth,
              pageHeight
            );
          }
        } else if (segment.trim()) {
          y = renderTextLines(doc, segment.trim(), y, margin, contentWidth, pageHeight);
        }
      }
    } else {
      // === REGULAR TWEET — text then images at bottom ===
      y = renderTextLines(doc, tweet.text, y, margin, contentWidth, pageHeight);

      for (const media of tweet.media) {
        if (media.type === "photo") {
          y = await renderImageInPDF(
            doc,
            media.url,
            media.width || 500,
            media.height || 330,
            y,
            margin,
            contentWidth,
            pageHeight
          );
        } else if (media.type === "video") {
          doc.setTextColor(100, 100, 100);
          doc.setFontSize(9);
          doc.setFont("helvetica", "italic");
          doc.text("[Video content — see original tweet]", margin, y);
          y += 6;
        }
      }
    }

    // Quoted tweet
    if (tweet.quotedTweet) {
      if (y > pageHeight - 40) {
        doc.addPage();
        y = margin;
      }

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(margin + 5, y, margin + 5, y + 15);

      doc.setTextColor(100, 100, 100);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(
        `@${tweet.quotedTweet.author.username}:`,
        margin + 8,
        y + 4
      );

      doc.setFont("helvetica", "normal");
      const qtLines = doc.splitTextToSize(
        tweet.quotedTweet.text,
        contentWidth - 10
      );
      let qtY = y + 9;
      for (const line of qtLines.slice(0, 4)) {
        doc.text(line, margin + 8, qtY);
        qtY += 4.5;
      }
      y = qtY + 5;
    }

    // Metrics line
    doc.setTextColor(150, 170, 165);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    const metricsStr = [
      `♡ ${tweet.metrics.likes}`,
      `↻ ${tweet.metrics.retweets}`,
      `💬 ${tweet.metrics.replies}`,
      tweet.metrics.views ? `👁 ${tweet.metrics.views}` : "",
    ]
      .filter(Boolean)
      .join("   ");
    doc.text(metricsStr, margin, y);
    y += 5;

    // Separator between tweets in thread
    if (isThread && i < tweets.length - 1) {
      doc.setDrawColor(232, 237, 235);
      doc.setLineWidth(0.2);
      doc.line(margin, y + 2, pageWidth - margin, y + 2);
      y += 8;
    }
  }

  // === FOOTER ===
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(0, 30, 43);
    doc.rect(0, pageHeight - 12, pageWidth, 12, "F");
    doc.setTextColor(150, 170, 165);
    doc.setFontSize(7);
    doc.text(
      `Extracted from X - ${new Date().toISOString().split("T")[0]} - Page ${p}/${totalPages}`,
      margin,
      pageHeight - 5
    );
    doc.text(
      "Generated by 1App",
      pageWidth - margin - 30,
      pageHeight - 5
    );
  }

  return doc.output("blob");
}
