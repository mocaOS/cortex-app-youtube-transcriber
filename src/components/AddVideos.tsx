import { useState } from "react";
import {
  fetchChannelVideos,
  fetchVideoInfo,
  parseYouTubeInput,
  type VideoInfo,
} from "../lib/youtube";

export default function AddVideos({
  onResolved,
}: {
  onResolved: (videos: VideoInfo[]) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve() {
    const parsed = parseYouTubeInput(input);
    if (!parsed) {
      setError("Not a YouTube video or channel URL.");
      return;
    }
    setError(null);
    setBusy("resolving…");
    try {
      if (parsed.type === "video") {
        const info = await fetchVideoInfo(parsed.id);
        if (!info) throw new Error("Video not found (private or removed?)");
        onResolved([info]);
      } else {
        const found = await fetchChannelVideos(parsed.id, (n) =>
          setBusy(`scanning channel… ${n} videos`),
        );
        if (found.length === 0) {
          throw new Error(
            "No videos found — the channel may be empty, or YouTube changed its page layout.",
          );
        }
        onResolved(found);
      }
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-px border border-[var(--color-line)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void resolve()}
          placeholder="https://youtube.com/watch?v=…  or  https://youtube.com/@channel"
          className="min-w-0 flex-1 border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void resolve()}
          disabled={!!busy || !input.trim()}
          className="border border-[var(--color-accent)] px-5 py-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
        >
          {busy ?? "Add videos"}
        </button>
      </div>
      {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}
    </div>
  );
}
