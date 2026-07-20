/**
 * App state — all persisted in platform storage, so projects and transcripts
 * are shared across devices/sessions and visible to share-link viewers.
 *
 * Layout:
 *   projects                    [{id, name, createdAt}]
 *   videos/{projectId}          [{videoId, title, channel, duration, url, addedAt}]
 *   transcripts/{videoId}       {original, lang, at}          (written by the transcribe task)
 *   refined/{videoId}           {text, summary, ...}          (written by the refine task)
 *   uploaded/{videoId}          {at}                          (written by the send-to-cortex task)
 *   prefs                       {collectionId}
 */

import { cortex } from "./cortex";
import { storageGet, storageKeys, storagePut } from "./platform";
import type { VideoInfo } from "./youtube";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface ProjectVideo extends VideoInfo {
  addedAt: string;
}

export interface Transcript {
  original: string;
  lang?: string;
  at?: string;
}

export interface Refined {
  text: string;
  summary?: string;
  chunks?: number;
  keptOriginal?: number;
  at?: string;
}

export async function loadProjects(): Promise<Project[]> {
  return (await storageGet<Project[]>("projects")) ?? [];
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await storagePut("projects", projects);
}

export async function createProject(name: string): Promise<Project> {
  const projects = await loadProjects();
  const project: Project = {
    id: Math.random().toString(36).slice(2, 10),
    name: name.trim() || "untitled",
    createdAt: new Date().toISOString(),
  };
  await saveProjects([...projects, project]);
  return project;
}

export async function loadVideos(projectId: string): Promise<ProjectVideo[]> {
  return (await storageGet<ProjectVideo[]>(`videos/${projectId}`)) ?? [];
}

export async function addVideos(
  projectId: string,
  incoming: VideoInfo[],
): Promise<ProjectVideo[]> {
  const existing = await loadVideos(projectId);
  const known = new Set(existing.map((v) => v.videoId));
  const added = incoming
    .filter((v) => !known.has(v.videoId))
    .map((v) => ({ ...v, addedAt: new Date().toISOString() }));
  const all = [...existing, ...added];
  await storagePut(`videos/${projectId}`, all);
  return all;
}

/** videoId sets for each pipeline stage, derived from storage key listings. */
export interface StageSets {
  transcribed: Set<string>;
  refined: Set<string>;
  uploaded: Set<string>;
}

export async function loadStageSets(): Promise<StageSets> {
  const [t, r, u] = await Promise.all([
    storageKeys("transcripts/"),
    storageKeys("refined/"),
    storageKeys("uploaded/"),
  ]);
  const strip = (keys: Set<string>, prefix: string) =>
    new Set([...keys].map((k) => k.slice(prefix.length)));
  return {
    transcribed: strip(t, "transcripts/"),
    refined: strip(r, "refined/"),
    uploaded: strip(u, "uploaded/"),
  };
}

export async function loadTranscript(videoId: string): Promise<Transcript | null> {
  return storageGet<Transcript>(`transcripts/${videoId}`);
}

export async function loadRefined(videoId: string): Promise<Refined | null> {
  return storageGet<Refined>(`refined/${videoId}`);
}

export interface Prefs {
  collectionId?: string;
}

export async function loadPrefs(): Promise<Prefs> {
  return (await storageGet<Prefs>("prefs")) ?? {};
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await storagePut("prefs", prefs);
}

// --- Cortex helpers (allowlisted endpoints) --------------------------------

export interface CortexCollection {
  id: string;
  name?: string;
}

export async function listCollections(): Promise<CortexCollection[]> {
  const res = await cortex("collections");
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? data : (data?.collections ?? []);
}
