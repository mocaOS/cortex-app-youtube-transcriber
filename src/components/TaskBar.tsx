import { useState } from "react";
import {
  submitTask,
  taskAction,
  type TaskDetail,
} from "../lib/platform";
import type { ProjectVideo, StageSets } from "../lib/store";
import {
  buildRefineTask,
  buildTranscribeTask,
  buildUploadTask,
  REFINE_TASK,
  TRANSCRIBE_TASK,
  UPLOAD_TASK,
} from "../lib/tasks";

const TASK_LABEL: Record<string, string> = {
  [TRANSCRIBE_TASK]: "transcribing",
  [REFINE_TASK]: "refining",
  [UPLOAD_TASK]: "sending to cortex",
};

export default function TaskBar({
  videos,
  stages,
  activeTasks,
  selected,
  collectionId,
  onChanged,
}: {
  videos: ProjectVideo[];
  stages: StageSets | null;
  activeTasks: TaskDetail[];
  selected: Set<string>;
  collectionId?: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // actions operate on the SELECTED rows only (the table's checkboxes)
  const pool = videos.filter((v) => selected.has(v.videoId));
  const toTranscribe = stages
    ? pool.filter((v) => !stages.transcribed.has(v.videoId))
    : [];
  const toRefine = stages
    ? pool.filter(
        (v) => stages.transcribed.has(v.videoId) && !stages.refined.has(v.videoId),
      )
    : [];
  const toUpload = stages
    ? pool.filter(
        (v) => stages.transcribed.has(v.videoId) && !stages.uploaded.has(v.videoId),
      )
    : [];

  async function run(builder: () => Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await submitTask(builder());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function act(taskId: string, action: "pause" | "resume" | "cancel") {
    setBusy(true);
    try {
      await taskAction(taskId, action);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-px border border-[var(--color-line)] bg-[var(--color-card)] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void run(() => buildTranscribeTask(toTranscribe))}
          disabled={busy || toTranscribe.length === 0 || activeTasks.length > 0}
          className="border border-[var(--color-accent)] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-40"
        >
          Transcribe {toTranscribe.length || ""}
        </button>
        <button
          onClick={() => void run(() => buildRefineTask(toRefine))}
          disabled={busy || toRefine.length === 0 || activeTasks.length > 0}
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          Refine {toRefine.length || ""}
        </button>
        <button
          onClick={() => void run(() => buildUploadTask(toUpload, collectionId))}
          disabled={busy || toUpload.length === 0 || activeTasks.length > 0}
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          Send {toUpload.length || ""} to Cortex
        </button>
      </div>

      {activeTasks.map((task) => (
        <div key={task.task_id} className="mt-3 flex flex-wrap items-center gap-4">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
            {TASK_LABEL[task.name] ?? task.name}
          </span>
          <span className="font-mono text-xs text-[var(--color-muted)]">
            {task.message}
            {typeof task.counts.failed === "number" && task.counts.failed > 0 && (
              <span className="text-red-400"> · {task.counts.failed} failed</span>
            )}
          </span>
          <span className="ml-auto flex gap-2">
            {task.status === "paused" ? (
              <button
                onClick={() => void act(task.task_id, "resume")}
                className="border border-[var(--color-line)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Resume
              </button>
            ) : (
              <button
                onClick={() => void act(task.task_id, "pause")}
                className="border border-[var(--color-line)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] hover:border-amber-400 hover:text-amber-400"
              >
                Pause
              </button>
            )}
            <button
              onClick={() => void act(task.task_id, "cancel")}
              className="border border-[var(--color-line)] px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-red-400 hover:border-red-400"
            >
              Cancel
            </button>
          </span>
        </div>
      ))}

      {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}
    </div>
  );
}
