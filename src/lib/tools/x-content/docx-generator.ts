import {
  Document,
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  PageNumber,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
  ExternalHyperlink,
  Packer,
} from "docx";
import type { TweetData, ThreadData } from "./types";

/**
 * Fetch image as ArrayBuffer for embedding in DOCX.
 */
async function fetchImageBuffer(
  url: string
): Promise<{ buffer: ArrayBuffer; width: number; height: number } | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();

    return {
      buffer,
      width: 500,
      height: 330,
    };
  } catch {
    return null;
  }
}

/**
 * Detect image type from URL for docx v9 ImageRun type property.
 */
function getImageType(url: string): "jpg" | "png" | "gif" | "bmp" {
  const lower = url.toLowerCase();
  if (lower.includes(".png")) return "png";
  if (lower.includes(".gif")) return "gif";
  if (lower.includes(".bmp")) return "bmp";
  return "jpg";
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
 * Create an image paragraph for DOCX from a media URL.
 */
async function createImageParagraph(
  imageUrl: string
): Promise<Paragraph | null> {
  const imgData = await fetchImageBuffer(imageUrl);
  if (!imgData) return null;
  return new Paragraph({
    children: [
      new ImageRun({
        type: getImageType(imageUrl),
        data: imgData.buffer,
        transformation: {
          width: imgData.width,
          height: imgData.height,
        },
      }),
    ],
    spacing: { before: 100, after: 100 },
  });
}

/**
 * Create text paragraphs from a block of text (splitting by newlines).
 * Lines starting with ## are rendered as bold headings (## removed).
 */
function createTextParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const rawLines = text.split(/\n/);
  for (const line of rawLines) {
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    const isHeading = line.trimStart().startsWith("## ");
    const displayText = isHeading ? line.trimStart().slice(3) : line;

    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: displayText,
            bold: isHeading,
            size: isHeading ? 24 : 22,
            font: "Calibri",
            color: "1A1A1A",
          }),
        ],
        spacing: { before: isHeading ? 160 : 0, after: isHeading ? 120 : 160 },
      })
    );
  }
  return paragraphs;
}

/**
 * Generate DOCX from tweet data with embedded images.
 * For articles, images are rendered inline at their original positions.
 */
export async function generateDOCX(
  data: TweetData | ThreadData
): Promise<Blob> {
  const isThread = "tweets" in data;
  const tweets = isThread ? (data as ThreadData).tweets : [data as TweetData];
  const author = isThread
    ? (data as ThreadData).author
    : (data as TweetData).author;
  const sourceUrl = isThread
    ? (data as ThreadData).sourceUrl
    : (data as TweetData).sourceUrl;

  const children: Paragraph[] = [];

  // === TITLE ===
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "X Content Extract",
          bold: true,
          size: 36,
          font: "Calibri",
          color: "001E2B",
        }),
      ],
      spacing: { after: 100 },
    })
  );

  // Author info
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${author.name} `,
          bold: true,
          size: 22,
          font: "Calibri",
          color: "001E2B",
        }),
        new TextRun({
          text: `@${author.username}`,
          size: 22,
          font: "Calibri",
          color: "00684A",
        }),
      ],
      spacing: { after: 50 },
    })
  );

  // Source URL
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Source: ",
          size: 18,
          font: "Calibri",
          color: "666666",
        }),
        new ExternalHyperlink({
          children: [
            new TextRun({
              text: sourceUrl,
              size: 18,
              font: "Calibri",
              color: "00684A",
              underline: {},
            }),
          ],
          link: sourceUrl,
        }),
      ],
      spacing: { after: 50 },
    })
  );

  // Thread indicator
  if (isThread && tweets.length > 1) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Thread · ${tweets.length} tweets`,
            size: 18,
            font: "Calibri",
            color: "00684A",
            bold: true,
          }),
        ],
        spacing: { after: 100 },
      })
    );
  }

  // Green separator line
  children.push(
    new Paragraph({
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 6,
          color: "00ED64",
        },
      },
      spacing: { after: 300 },
    })
  );

  // === TWEETS ===
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];

    // Thread index + date
    if (isThread && tweets.length > 1) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Tweet ${i + 1}`,
              bold: true,
              size: 20,
              font: "Calibri",
              color: "00ED64",
            }),
            new TextRun({
              text: `  ·  ${formatDate(tweet.createdAt)}`,
              size: 18,
              font: "Calibri",
              color: "999999",
            }),
          ],
          spacing: { before: 200, after: 100 },
          shading: {
            type: ShadingType.CLEAR,
            fill: "F0F5F3",
          },
        })
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: formatDate(tweet.createdAt),
              size: 18,
              font: "Calibri",
              color: "999999",
              italics: true,
            }),
          ],
          spacing: { after: 100 },
        })
      );
    }

    // Article title (if X Article)
    if (tweet.isArticle && tweet.articleTitle) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "[Article] ",
              size: 16,
              font: "Calibri",
              color: "00684A",
              bold: true,
            }),
          ],
          spacing: { after: 50 },
        })
      );
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: tweet.articleTitle,
              bold: true,
              size: 28,
              font: "Calibri",
              color: "001E2B",
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 },
        })
      );
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
            const imgParagraph = await createImageParagraph(mediaItem.url);
            if (imgParagraph) {
              children.push(imgParagraph);
            } else {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `[Image: ${mediaItem.url}]`,
                      size: 18,
                      font: "Calibri",
                      color: "999999",
                      italics: true,
                    }),
                  ],
                  spacing: { after: 80 },
                })
              );
            }
          }
        } else if (segment.trim()) {
          const textParagraphs = createTextParagraphs(segment.trim());
          children.push(...textParagraphs);
        }
      }
    } else {
      // === REGULAR TWEET — text then images at bottom ===
      const textParas = createTextParagraphs(tweet.text);
      children.push(...textParas);

      for (const media of tweet.media) {
        if (media.type === "photo") {
          const imgParagraph = await createImageParagraph(media.url);
          if (imgParagraph) {
            children.push(imgParagraph);
          } else {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `[Image: ${media.url}]`,
                    size: 18,
                    font: "Calibri",
                    color: "999999",
                    italics: true,
                  }),
                ],
                spacing: { after: 80 },
              })
            );
          }
        } else if (media.type === "video") {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: "[Video content — see original tweet]",
                  size: 18,
                  font: "Calibri",
                  color: "999999",
                  italics: true,
                }),
              ],
              spacing: { after: 80 },
            })
          );
        }
      }
    }

    // Quoted tweet
    if (tweet.quotedTweet) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `@${tweet.quotedTweet.author.username}: `,
              bold: true,
              size: 20,
              font: "Calibri",
              color: "666666",
            }),
            new TextRun({
              text: tweet.quotedTweet.text,
              size: 20,
              font: "Calibri",
              color: "666666",
            }),
          ],
          indent: { left: 400 },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 6,
              color: "E8EDEB",
            },
          },
          spacing: { before: 100, after: 100 },
        })
      );
    }

    // Metrics
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: [
              `♡ ${tweet.metrics.likes}`,
              `↻ ${tweet.metrics.retweets}`,
              `💬 ${tweet.metrics.replies}`,
              tweet.metrics.views ? `👁 ${tweet.metrics.views}` : "",
            ]
              .filter(Boolean)
              .join("    "),
            size: 16,
            font: "Calibri",
            color: "999999",
          }),
        ],
        spacing: { before: 100, after: 100 },
      })
    );

    // Separator between tweets in thread
    if (isThread && i < tweets.length - 1) {
      children.push(
        new Paragraph({
          border: {
            bottom: {
              style: BorderStyle.SINGLE,
              size: 1,
              color: "E8EDEB",
            },
          },
          spacing: { before: 100, after: 200 },
        })
      );
    }
  }

  const doc = new Document({
    creator: "1App",
    title: `X Extract — @${author.username}`,
    description: `Content extracted from X/Twitter by @${author.username}`,
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1200,
              right: 1200,
              bottom: 1200,
              left: 1200,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "X Content Extract",
                    size: 16,
                    font: "Calibri",
                    color: "00684A",
                    bold: true,
                  }),
                ],
                alignment: AlignmentType.LEFT,
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Extracted from X · ${new Date().toISOString().split("T")[0]}  ·  Page `,
                    size: 14,
                    font: "Calibri",
                    color: "999999",
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 14,
                    font: "Calibri",
                    color: "999999",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
