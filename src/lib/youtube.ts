/**
 * YouTube resolution — video URLs and whole channels → video lists.
 *
 * Every request goes through the platform `http` capability (server-side,
 * host-allowlisted to www.youtube.com), so no CORS problems and no direct
 * browser traffic to YouTube. Channel listings scrape the channel page's
 * embedded ytInitialData and follow InnerTube continuation tokens — the same
 * approach the original yt-transcriber used, just proxied.
 *
 * This composition logic stays CLIENT-side by design: it produces the item
 * list; the transcription/refinement work itself runs server-side as
 * platform tasks (see tasks.ts).
 */

import { platform } from "./cortex";

export interface VideoInfo {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  url: string;
}

const YT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  // EU IPs get a 302 to consent.youtube.com without this pre-consent cookie
  Cookie: "SOCS=CAI",
};

async function ytGet(url: string): Promise<Response> {
  return platform("http", {
    method: "POST",
    body: JSON.stringify({ method: "GET", url, headers: YT_HEADERS }),
  });
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

export function parseYouTubeInput(
  input: string,
): { type: "video" | "channel"; id: string } | null {
  const trimmed = input.trim();

  const videoPatterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of videoPatterns) {
    const match = trimmed.match(pattern);
    if (match) return { type: "video", id: match[1] };
  }

  const channelPatterns = [
    /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/@([a-zA-Z0-9_.-]+)/,
    /youtube\.com\/c\/([a-zA-Z0-9_.-]+)/,
    /youtube\.com\/user\/([a-zA-Z0-9_.-]+)/,
  ];
  for (const pattern of channelPatterns) {
    const match = trimmed.match(pattern);
    if (match) return { type: "channel", id: match[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single video (oEmbed)
// ---------------------------------------------------------------------------

export async function fetchVideoInfo(videoId: string): Promise<VideoInfo | null> {
  const res = await ytGet(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
  );
  if (!res.ok) return null;
  try {
    const data = await res.json();
    return {
      videoId,
      title: data.title || "Unknown Title",
      channel: data.author_name || "Unknown Channel",
      duration: "",
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Channel scraping (videos + streams tabs, full continuation walk)
// ---------------------------------------------------------------------------

export async function fetchChannelVideos(
  channelIdentifier: string,
  onProgress?: (count: number) => void,
): Promise<VideoInfo[]> {
  const channelBase = channelIdentifier.startsWith("UC")
    ? `https://www.youtube.com/channel/${channelIdentifier}`
    : channelIdentifier.startsWith("@")
      ? `https://www.youtube.com/${channelIdentifier}`
      : `https://www.youtube.com/@${channelIdentifier}`;

  const videos: VideoInfo[] = [];
  const seen = new Set<string>();
  for (const tab of ["/videos", "/streams"]) {
    try {
      await scrapeChannelTab(channelBase + tab, videos, seen, onProgress);
    } catch {
      // one tab failing (e.g. no streams) never kills the others
    }
  }
  return videos;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function scrapeChannelTab(
  tabUrl: string,
  videos: VideoInfo[],
  seen: Set<string>,
  onProgress?: (count: number) => void,
): Promise<void> {
  const pageRes = await ytGet(tabUrl);
  if (!pageRes.ok) return;
  const html = await pageRes.text();

  const dataMatch = html.match(/var ytInitialData\s*=\s*({.+?});\s*<\/script>/);
  if (!dataMatch) return;
  const ytData = JSON.parse(dataMatch[1]);

  const apiKey =
    html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ??
    "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const clientVersion =
    html.match(/"clientVersion":"([^"]+)"/)?.[1] ?? "2.20240101.00.00";

  const channelName =
    (ytData as any)?.metadata?.channelMetadataRenderer?.title || "Unknown Channel";

  let continuationToken = extractVideosFromData(ytData, channelName, videos, seen);
  onProgress?.(videos.length);

  while (continuationToken) {
    const contRes = await platform("http", {
      method: "POST",
      body: JSON.stringify({
        method: "POST",
        url: `https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`,
        content_type: "application/json",
        headers: YT_HEADERS,
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
          continuation: continuationToken,
        }),
      }),
    });
    if (!contRes.ok) break;
    const contData: any = await contRes.json().catch(() => null);
    if (!contData) break;

    continuationToken = null;
    for (const action of contData?.onResponseReceivedActions || []) {
      for (const item of action?.appendContinuationItemsAction?.continuationItems || []) {
        collectItem(item, channelName, videos, seen);
        const nextToken =
          item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (nextToken) continuationToken = nextToken;
      }
    }
    onProgress?.(videos.length);
  }
}

/** One grid item → video, across YouTube's layout generations: the current
 * lockupViewModel, and the legacy videoRenderer/gridVideoRenderer. */
function collectItem(
  item: any,
  channelName: string,
  videos: VideoInfo[],
  seen: Set<string>,
): void {
  const content = item?.richItemRenderer?.content;
  if (content?.lockupViewModel) addLockup(content.lockupViewModel, channelName, videos, seen);
  if (content?.videoRenderer) addVideo(content.videoRenderer, channelName, videos, seen);
  if (item?.lockupViewModel) addLockup(item.lockupViewModel, channelName, videos, seen);
  if (item?.gridVideoRenderer) addVideo(item.gridVideoRenderer, channelName, videos, seen);
}

function addLockup(
  lockup: any,
  channelName: string,
  videos: VideoInfo[],
  seen: Set<string>,
): void {
  if (lockup?.contentType && lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return;
  const videoId = lockup?.contentId as string;
  if (!videoId || videoId.length !== 11 || seen.has(videoId)) return;
  seen.add(videoId);

  let duration = "";
  for (const overlay of lockup?.contentImage?.thumbnailViewModel?.overlays || []) {
    for (const badge of overlay?.thumbnailBottomOverlayViewModel?.badges || []) {
      const text = badge?.thumbnailBadgeViewModel?.text;
      if (typeof text === "string" && /^[\d:]+$/.test(text)) duration = text;
    }
  }

  videos.push({
    videoId,
    title: lockup?.metadata?.lockupMetadataViewModel?.title?.content || "Unknown Title",
    channel: channelName,
    duration,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  });
}

function extractVideosFromData(
  ytData: any,
  channelName: string,
  videos: VideoInfo[],
  seen: Set<string>,
): string | null {
  let continuationToken: string | null = null;
  const tabs = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];

  for (const tab of tabs) {
    const tabContent = tab?.tabRenderer?.content || tab?.expandableTabRenderer?.content;
    if (!tabContent) continue;

    for (const item of tabContent?.richGridRenderer?.contents || []) {
      collectItem(item, channelName, videos, seen);
      const token =
        item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token) continuationToken = token;
    }

    for (const section of tabContent?.sectionListRenderer?.contents || []) {
      const gridItems =
        section?.itemSectionRenderer?.contents?.[0]?.shelfRenderer?.content?.gridRenderer
          ?.items ||
        section?.itemSectionRenderer?.contents?.[0]?.gridRenderer?.items ||
        [];
      for (const item of gridItems) {
        collectItem(item, channelName, videos, seen);
        const token =
          item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (token) continuationToken = token;
      }
    }
  }

  if (videos.length === 0) sweepForRenderers(ytData, channelName, videos, seen);
  return continuationToken;
}

function addVideo(renderer: any, channelName: string, videos: VideoInfo[], seen: Set<string>) {
  const videoId = renderer?.videoId as string;
  if (!videoId || seen.has(videoId)) return;
  seen.add(videoId);
  videos.push({
    videoId,
    title: textFromRuns(renderer.title) || "Unknown Title",
    channel: channelName,
    duration: renderer?.lengthText?.simpleText || textFromRuns(renderer?.lengthText) || "",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  });
}

function textFromRuns(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.simpleText) return obj.simpleText;
  if (Array.isArray(obj.runs)) return obj.runs.map((r: any) => r.text).join("");
  return "";
}

function sweepForRenderers(
  obj: any,
  channelName: string,
  videos: VideoInfo[],
  seen: Set<string>,
  depth = 0,
): void {
  if (depth > 15 || !obj || typeof obj !== "object") return;
  if (obj.videoRenderer) addVideo(obj.videoRenderer, channelName, videos, seen);
  if (obj.gridVideoRenderer) addVideo(obj.gridVideoRenderer, channelName, videos, seen);
  if (obj.lockupViewModel) addLockup(obj.lockupViewModel, channelName, videos, seen);
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) sweepForRenderers(item, channelName, videos, seen, depth + 1);
    } else if (value && typeof value === "object") {
      sweepForRenderers(value, channelName, videos, seen, depth + 1);
    }
  }
}
