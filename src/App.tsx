import { useCallback, useEffect, useState } from "react";
import AddVideos from "./components/AddVideos";
import TaskBar from "./components/TaskBar";
import TranscriptModal from "./components/TranscriptModal";
import VideoTable from "./components/VideoTable";
import { getTask, listTasks, type TaskDetail } from "./lib/platform";
import {
  addVideos,
  createProject,
  listCollections,
  loadPrefs,
  loadProjects,
  loadStageSets,
  loadVideos,
  savePrefs,
  type CortexCollection,
  type Project,
  type ProjectVideo,
  type StageSets,
} from "./lib/store";
import type { VideoInfo } from "./lib/youtube";

const ACTIVE = new Set(["running", "pending"]);

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [videos, setVideos] = useState<ProjectVideo[]>([]);
  const [stages, setStages] = useState<StageSets | null>(null);
  const [collections, setCollections] = useState<CortexCollection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [activeTasks, setActiveTasks] = useState<TaskDetail[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<ProjectVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshTasks = useCallback(async () => {
    const summaries = await listTasks();
    const active = summaries.filter((t) => ACTIVE.has(t.status));
    const details = await Promise.all(active.map((t) => getTask(t.task_id)));
    setActiveTasks(details);
    return details;
  }, []);

  const refreshStages = useCallback(async () => {
    setStages(await loadStageSets());
  }, []);

  // initial load
  useEffect(() => {
    (async () => {
      try {
        const [ps, prefs, cols] = await Promise.all([
          loadProjects(),
          loadPrefs(),
          listCollections(),
        ]);
        setProjects(ps);
        setCollections(cols);
        setCollectionId(prefs.collectionId ?? "");
        if (ps.length > 0) setProjectId(ps[0].id);
        await Promise.all([refreshStages(), refreshTasks()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshStages, refreshTasks]);

  // load videos when the project changes; everything starts selected
  useEffect(() => {
    if (!projectId) {
      setVideos([]);
      setSelected(new Set());
      return;
    }
    void loadVideos(projectId).then((vs) => {
      setVideos(vs);
      setSelected(new Set(vs.map((v) => v.videoId)));
    });
  }, [projectId]);

  // poll while tasks are active; refresh stage sets as they progress
  useEffect(() => {
    if (activeTasks.length === 0) return;
    const timer = window.setTimeout(async () => {
      try {
        await refreshTasks();
        await refreshStages();
      } catch {
        /* transient poll errors are fine */
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [activeTasks, refreshTasks, refreshStages]);

  async function onCreateProject() {
    const name = window.prompt("Project name?");
    if (!name) return;
    const project = await createProject(name);
    setProjects((prev) => [...prev, project]);
    setProjectId(project.id);
  }

  async function onVideosResolved(found: VideoInfo[]) {
    if (found.length === 0) return;
    let targetId = projectId;
    if (!targetId) {
      const project = await createProject(found[0]?.channel || "videos");
      setProjects((prev) => [...prev, project]);
      setProjectId(project.id);
      targetId = project.id;
    }
    const all = await addVideos(targetId, found);
    setVideos(all);
    // newly added videos join the selection
    setSelected((prev) => {
      const next = new Set(prev);
      for (const v of found) next.add(v.videoId);
      return next;
    });
  }

  function toggleVideo(videoId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  }

  function toggleAll(select: boolean) {
    setSelected(select ? new Set(videos.map((v) => v.videoId)) : new Set());
  }

  async function onCollectionChange(id: string) {
    setCollectionId(id);
    await savePrefs({ collectionId: id || undefined });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-12">
        <p className="font-mono text-xs uppercase tracking-[0.1em] text-[var(--color-faint)]">
          loading…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          Cortex App
        </p>
        <h1 className="mt-3 text-5xl font-bold tracking-[-0.04em] md:text-6xl">
          YT Transcriber
        </h1>
        <p className="mt-4 max-w-xl text-[var(--color-muted)]">
          Paste a video or a whole channel. Transcription and cleanup run
          inside Cortex — close this tab whenever you like.
        </p>
      </header>

      {error && <p className="mb-6 font-mono text-xs text-red-400">{error}</p>}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
        >
          {projects.length === 0 && <option value="">no projects yet</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void onCreateProject()}
          className="border border-[var(--color-line)] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
        >
          + Project
        </button>
        {collections.length > 0 && (
          <select
            value={collectionId}
            onChange={(e) => void onCollectionChange(e.target.value)}
            className="ml-auto border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--color-accent)]"
            title="Cortex collection for uploads"
          >
            <option value="">default collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id}
              </option>
            ))}
          </select>
        )}
      </div>

      <AddVideos onResolved={(found) => void onVideosResolved(found)} />

      <TaskBar
        videos={videos}
        stages={stages}
        activeTasks={activeTasks}
        selected={selected}
        collectionId={collectionId || undefined}
        onChanged={() => {
          void refreshTasks();
          void refreshStages();
        }}
      />

      <VideoTable
        videos={videos}
        stages={stages}
        activeTasks={activeTasks}
        selected={selected}
        onToggle={toggleVideo}
        onToggleAll={toggleAll}
        onView={setViewing}
      />

      {viewing && (
        <TranscriptModal video={viewing} onClose={() => setViewing(null)} />
      )}

      <footer className="mt-10 font-mono text-xs text-[var(--color-faint)]">
        POWERED BY CORTEX — TRANSCRIPTION RUNS SERVER-SIDE, EVEN WITH THIS TAB CLOSED
      </footer>
    </div>
  );
}
