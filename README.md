# YT Transcriber — a Cortex App

Turn YouTube videos and whole channels into clean, searchable transcripts
inside your [Cortex](https://github.com/mocaOS/cortex-app) knowledge graph.

Paste a video URL — or a channel, and every upload/stream is resolved — then
run the three-stage pipeline. All heavy lifting happens **inside Cortex** as
declarative platform tasks: close the tab, the work keeps going.

This is the Class-B port of the original standalone yt-transcriber
(ECOSYSTEM.md Demo 2): what used to be a self-hosted Next.js service with
its own SQLite, worker pool, and env-file secrets is now a 74 KB zip an
admin uploads once.

## The pipeline

1. **Transcribe** — one Venice AI call per video (`tasks` capability,
   sequential to respect rate limits). The `VENICE_API_KEY` lives encrypted
   in Cortex config, injected server-side, host-scoped to `api.venice.ai`
   (`auth_host`) so it never touches YouTube calls or the browser.
2. **Refine** — chunked LLM cleanup via the instance's own model (`llm`
   capability, metered like any completion). The platform's validation
   policies (length-ratio + word-overlap, retry once, else keep the original
   chunk) guarantee refinement can never silently truncate a transcript.
   Known Person/Organization entities from your graph are injected so names
   get spelled correctly. A comparison summary is generated per video.
3. **Send to Cortex** — transcripts (refined preferred, original fallback)
   render to markdown and upload into the knowledge base, into a collection
   of your choice; Cortex's normal chunk/embed/extract pipeline takes over.

State (projects, videos, transcripts, refinements, upload markers) lives in
the app's private `storage` — shared across devices and share-link viewers,
and it survives app upgrades. Every stage is idempotent: re-running only
processes what's missing.

## YouTube resolution

Single videos resolve via oEmbed; channels are scraped from the channel
page's embedded `ytInitialData` with full InnerTube continuation walking —
all through the platform `http` proxy (host-allowlisted, server-side), so
no CORS and no browser traffic to YouTube. EU consent redirects are bypassed
with the standard pre-consent cookie.

## Install

1. `npm install && npm run package` → `yt-transcriber-{version}.zip`
2. Cortex admin → **Settings → Apps → Install** (requires `ENABLE_APPS=true`).
3. Configure `VENICE_API_KEY` (venice.ai → Settings → API keys).
4. Open `/apps` → YT Transcriber. Share it with non-Cortex users via a
   revocable share link — viewers can read and download transcripts but
   cannot start work or write state.

## Manifest notes

- `type: "platform"`, `keyScope: read_write` (uploads need MANAGE)
- `endpoints: ["upload", "graph/entities", "collections"]`
- `capabilities`: `http` (hosts: `www.youtube.com`, `api.venice.ai`),
  `tasks`, `storage`, `llm`
- Task-DSL reference: `cortexskills.org/builder/app/tasks.md`

## Dev loop

```
cp .env.example .env   # CORTEX_DEV_URL + a cortex_rw_… key
npm run dev
```
