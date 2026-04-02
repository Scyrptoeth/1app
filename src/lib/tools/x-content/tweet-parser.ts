/**
 * Utilities for parsing X/Twitter URLs and extracting tweet IDs.
 */

export interface ParsedTweetUrl {
  tweetId: string;
  username: string;
}

/**
 * Extract tweet ID and username from various X/Twitter URL formats.
 *
 * Supported formats:
 * - https://x.com/username/status/1234567890
 * - https://twitter.com/username/status/1234567890
 * - https://x.com/username/status/1234567890?s=46
 * - https://mobile.twitter.com/username/status/1234567890
 */
export function parseTweetUrl(url: string): ParsedTweetUrl | null {
  const trimmed = url.trim();

  const pattern =
    /(?:https?:\/\/)?(?:(?:www|mobile)\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/(\d+)/;

  const match = trimmed.match(pattern);

  if (!match) return null;

  return {
    username: match[1],
    tweetId: match[2],
  };
}

/**
 * Validate if a string is a valid X/Twitter URL.
 */
export function isValidTweetUrl(url: string): boolean {
  return parseTweetUrl(url) !== null;
}

/**
 * Extract multiple tweet URLs from a multiline string input.
 */
export function parseMultipleTweetUrls(input: string): ParsedTweetUrl[] {
  const lines = input
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const results: ParsedTweetUrl[] = [];

  for (const line of lines) {
    const parsed = parseTweetUrl(line);
    if (parsed) results.push(parsed);
  }

  return results;
}
