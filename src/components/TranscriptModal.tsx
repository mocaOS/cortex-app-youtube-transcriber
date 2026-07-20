import { useEffect, useState } from "react";
import {
  loadRefined,
  loadTranscript,
  type ProjectVideo,
  type Refined,
  type Transcript,
} from "../lib/store";

export default function TranscriptModal({
  video,
  onClose,
}: {
  video: ProjectVideo;
  onClose: () => void;
}) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [refined, setRefined] = useState<Refined | null>(null);
  const [tab, setTab] = useState<"refined" | "original">("refined");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [t, r] = await Promise.all([
        loadTranscript(video.videoId),
        loadRefined(video.videoId),
      ]);
      setTranscript(t);
      setRefined(r);
      setTab(r?.text ? "refined" : "original");
      setLoading(false);
    })();
  }, [video.videoId]);

  function download() {
    const text = tab === "refined" && refined?.text ? refined.text : transcript?.original;
    if (!text) return;
    const md = `# ${video.title}\n\n- Source: ${video.url}\n- Channel: ${video.channel}\n${
      refined?.summary ? `- Summary: ${refined.summary}\n` : ""
    }\n---\n\n${text}\n`;
    const slug =
      video.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
      "untitled";
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yt-${video.videoId}-${slug}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const body =
    tab === "refined" ? (refined?.text ?? "") : (transcript?.original ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col border border-[var(--color-line)] bg-[var(--color-bg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-line)] p-4">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{video.title}</h2>
          {refined?.text && (
            <div className="flex">
              {(["refined", "original"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${
                    tab === t
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-line)] text-[var(--color-muted)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={download}
            className="border border-[var(--color-line)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Download .md
          </button>
          <button
            onClick={onClose}
            className="border border-[var(--color-line)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)] hover:border-red-400 hover:text-red-400"
          >
            Close
          </button>
        </div>
        {refined?.summary && tab === "refined" && (
          <p className="border-b border-[var(--color-line)] p-4 text-xs leading-relaxed text-[var(--color-muted)]">
            {refined.summary}
          </p>
        )}
        <div className="overflow-y-auto p-4">
          {loading ? (
            <p className="font-mono text-xs text-[var(--color-faint)]">loading…</p>
          ) : body ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--color-fg)]">
              {body}
            </pre>
          ) : (
            <p className="font-mono text-xs text-[var(--color-faint)]">
              nothing here yet — run {tab === "refined" ? "Refine" : "Transcribe"} first
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
