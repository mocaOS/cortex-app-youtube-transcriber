import { useMemo } from "react";
import type { TaskDetail } from "../lib/platform";
import type { ProjectVideo, StageSets } from "../lib/store";

type Stage = "pending" | "transcribed" | "refined" | "uploaded";

const STAGE_BADGE: Record<Stage, { label: string; cls: string }> = {
  pending: { label: "pending", cls: "text-[var(--color-faint)]" },
  transcribed: { label: "transcribed", cls: "text-[var(--color-accent)]" },
  refined: { label: "refined", cls: "text-emerald-400" },
  uploaded: { label: "in cortex", cls: "text-emerald-400" },
};

interface LiveState {
  status: string;
  detail?: string;
}

export default function VideoTable({
  videos,
  stages,
  activeTasks,
  selected,
  onToggle,
  onToggleAll,
  onView,
}: {
  videos: ProjectVideo[];
  stages: StageSets | null;
  activeTasks: TaskDetail[];
  selected: Set<string>;
  onToggle: (videoId: string) => void;
  onToggleAll: (select: boolean) => void;
  onView: (video: ProjectVideo) => void;
}) {
  // live per-video task item states (running/failed/skipped) override stages
  const live = useMemo(() => {
    const map = new Map<string, LiveState>();
    for (const task of activeTasks) {
      for (const item of task.items ?? []) {
        const videoId = String(item.vars.videoId ?? "");
        if (!videoId) continue;
        if (item.status === "running") {
          map.set(videoId, { status: "working" });
        } else if (item.status === "failed") {
          map.set(videoId, { status: "failed", detail: item.error });
        } else if (item.status === "skipped" && item.reason) {
          map.set(videoId, { status: "skipped", detail: item.reason });
        }
      }
    }
    return map;
  }, [activeTasks]);

  if (videos.length === 0) {
    return (
      <p className="mt-4 font-mono text-xs text-[var(--color-faint)]">
        No videos yet — paste a video or channel URL above.
      </p>
    );
  }

  function stageFor(videoId: string): Stage {
    if (!stages) return "pending";
    if (stages.uploaded.has(videoId)) return "uploaded";
    if (stages.refined.has(videoId)) return "refined";
    if (stages.transcribed.has(videoId)) return "transcribed";
    return "pending";
  }

  const allSelected = videos.length > 0 && videos.every((v) => selected.has(v.videoId));

  return (
    <div className="border border-[var(--color-line)]">
      <div className="flex items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-card)] px-4 py-2.5">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(e) => onToggleAll(e.target.checked)}
          className="size-3.5 shrink-0 cursor-pointer appearance-none border border-[var(--color-line)] bg-transparent checked:border-[var(--color-accent)] checked:bg-[var(--color-accent)]"
          title={allSelected ? "deselect all" : "select all"}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
          {selected.size}/{videos.length} selected
        </span>
      </div>
      <ul className="max-h-[55vh] overflow-y-auto">
        {videos.map((video) => {
          const liveState = live.get(video.videoId);
          const stage = stageFor(video.videoId);
          const hasTranscript = stage !== "pending";
          const isSelected = selected.has(video.videoId);
          return (
            <li
              key={video.videoId}
              className="flex items-baseline gap-3 border-b border-white/5 px-4 py-2 last:border-b-0"
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(video.videoId)}
                className="size-3.5 shrink-0 translate-y-0.5 cursor-pointer appearance-none border border-[var(--color-line)] bg-transparent checked:border-[var(--color-accent)] checked:bg-[var(--color-accent)]"
              />
              <span
                className={`min-w-0 flex-1 cursor-default truncate text-sm ${
                  isSelected ? "" : "text-[var(--color-muted)]"
                }`}
                onClick={() => onToggle(video.videoId)}
              >
                {video.title}
              </span>
              <span className="hidden shrink-0 font-mono text-xs text-[var(--color-faint)] md:inline">
                {video.duration}
              </span>
              {liveState ? (
                <span
                  className={`w-24 shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.1em] ${
                    liveState.status === "failed"
                      ? "text-red-400"
                      : liveState.status === "skipped"
                        ? "text-[var(--color-muted)]"
                        : "text-[var(--color-accent)] animate-pulse"
                  }`}
                  title={liveState.detail}
                >
                  {liveState.status === "working" ? "working…" : liveState.status}
                </span>
              ) : (
                <span
                  className={`w-24 shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.1em] ${STAGE_BADGE[stage].cls}`}
                >
                  {STAGE_BADGE[stage].label}
                </span>
              )}
              <button
                onClick={() => onView(video)}
                disabled={!hasTranscript}
                className="shrink-0 border border-white/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-30"
              >
                View
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
