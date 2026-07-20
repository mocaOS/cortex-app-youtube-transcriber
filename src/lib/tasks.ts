/**
 * The three pipeline stages, each as a declarative platform task.
 * DSL reference: cortexskills.org/builder/app/tasks.md
 *
 * The browser composes the item lists (it knows the project + stage state);
 * the EXECUTION is server-side — transcription keeps running with the tab
 * closed, refinement chunk-safety is enforced by the platform's llm
 * validation policies, and every step passes the same allowlists as live
 * calls.
 */

import type { ProjectVideo } from "./store";

export const TRANSCRIBE_TASK = "transcribe";
export const REFINE_TASK = "refine";
export const UPLOAD_TASK = "send-to-cortex";

const VENICE_URL = "https://api.venice.ai/api/v1/video/transcriptions";

/** Sequential on purpose — Venice rate limits; one long video at a time. */
export function buildTranscribeTask(videos: ProjectVideo[]): Record<string, unknown> {
  return {
    name: TRANSCRIBE_TASK,
    concurrency: 1,
    items: videos.map((v) => ({
      vars: { videoId: v.videoId, url: v.url, title: v.title },
    })),
    steps: [
      {
        id: "t",
        http: {
          method: "POST",
          url: VENICE_URL,
          body: { url: "{vars.url}", response_format: "json" },
        },
      },
      {
        skipItem: {
          when: { empty: "$t.body.transcript" },
          reason: "no speech in this video",
        },
      },
      {
        store: {
          put: "transcripts/{vars.videoId}",
          value: {
            original: "$t.body.transcript",
            lang: "$t.body.lang",
            at: "{run.startedAt}",
          },
        },
      },
    ],
  };
}

/**
 * Chunked LLM cleanup with the platform's validation policies (length-ratio +
 * word-overlap, retry once, else keep the original chunk) — the transcript
 * can only get better, never silently truncated. Known graph entities are
 * injected so names get spelled correctly.
 */
export function buildRefineTask(videos: ProjectVideo[]): Record<string, unknown> {
  return {
    name: REFINE_TASK,
    concurrency: 3,
    setup: [
      { id: "people", cortex: { method: "GET", path: "graph/entities?entity_type=Person&limit=200" } },
      { id: "orgs", cortex: { method: "GET", path: "graph/entities?entity_type=Organization&limit=200" } },
      {
        id: "entities",
        template: {
          text: "{people.body.entities|pluck:name|join:, }, {orgs.body.entities|pluck:name|join:, }",
        },
      },
    ],
    items: videos.map((v) => ({ vars: { videoId: v.videoId, title: v.title } })),
    steps: [
      { id: "t", store: { get: "transcripts/{vars.videoId}" } },
      {
        skipItem: {
          when: { empty: "$t.value.original" },
          reason: "not transcribed yet",
        },
      },
      {
        id: "refined",
        llm: {
          system:
            "You clean up auto-generated video transcripts. Fix punctuation, casing, " +
            "obvious mis-transcriptions and paragraph breaks. Never summarize, never " +
            "drop content, never add commentary. If a name sounds close to one of " +
            "these known names, use the known spelling: {setup.entities.text}",
          prompt:
            "Clean up this transcript chunk. Return ONLY the cleaned text.\n\n{chunk}",
          input: "$t.value.original",
          chunk: { words: 1000 },
          validate: { minLengthRatio: 0.5, minWordOverlap: 0.6, onFail: "keepOriginal" },
          temperature: 0.3,
        },
      },
      {
        id: "summary",
        llm: {
          prompt:
            "Compare the original and refined transcript excerpts and describe in 2-4 " +
            "sentences what was changed.\n\nORIGINAL:\n{t.value.original|truncate:6000}\n\n" +
            "REFINED:\n{refined.text|truncate:6000}",
          // generous budget: reasoning models (e.g. minimax) burn tokens on
          // thinking BEFORE emitting content — a tight cap yields empty text
          maxTokens: 2000,
        },
      },
      {
        store: {
          put: "refined/{vars.videoId}",
          value: {
            text: "$refined.text",
            summary: "$summary.text",
            chunks: "$refined.chunksTotal",
            keptOriginal: "$refined.chunksKeptOriginal",
            at: "{run.startedAt}",
          },
        },
      },
    ],
  };
}

/** Uploads refined (or original) transcripts into the knowledge base. */
export function buildUploadTask(
  videos: ProjectVideo[],
  collectionId?: string,
): Record<string, unknown> {
  const params = new URLSearchParams({
    start_processing: "true",
    source: "yt-transcriber",
  });
  if (collectionId) params.set("collection_id", collectionId);

  return {
    name: UPLOAD_TASK,
    concurrency: 2,
    items: videos.map((v) => ({
      vars: { videoId: v.videoId, title: v.title, url: v.url, channel: v.channel },
    })),
    steps: [
      { id: "r", store: { get: "refined/{vars.videoId}" } },
      { id: "o", store: { get: "transcripts/{vars.videoId}" } },
      {
        skipItem: {
          when: {
            and: [{ empty: "$r.value.text" }, { empty: "$o.value.original" }],
          },
          reason: "no transcript",
        },
      },
      {
        id: "md",
        template: {
          lines: [
            "# {vars.title}",
            "",
            "- Source: {vars.url}",
            "- Channel: {vars.channel}",
            { text: "- Summary: {r.value.summary}", when: { notEmpty: "$r.value.summary" } },
            "",
            "---",
            "",
            { text: "{r.value.text}", when: { notEmpty: "$r.value.text" } },
            { text: "{o.value.original}", when: { empty: "$r.value.text" } },
          ],
        },
      },
      {
        cortex: {
          method: "POST",
          path: `upload?${params.toString()}`,
          multipart: {
            content: "$md.text",
            filename: "yt-{vars.videoId}-{vars.title|slug}.md",
          },
        },
      },
      { store: { put: "uploaded/{vars.videoId}", value: { at: "{run.startedAt}" } } },
    ],
  };
}
