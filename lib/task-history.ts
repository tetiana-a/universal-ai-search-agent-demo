// Research tasks run in this browser: status, counters and a snapshot of the results,
// so the task list shows real runs and a finished task can be reopened.

export type TaskStatus = "running" | "completed" | "stopped" | "failed";

export type TaskRecord = {
  id: string;
  query: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string;
  rounds: number;
  resultsCount: number;
  counters?: Record<string, number>;
  error?: string;
  snapshot?: any;
};

const KEY = "aurelius:tasks:v1";
const MAX_TASKS = 30;
const MAX_BYTES = 1_500_000;

export function loadTasks(): TaskRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((t) => t && typeof t.id === "string") : [];
  } catch {
    return [];
  }
}

// A run interrupted by closing the tab is shown as stopped, not as running forever.
export function settleStaleTasks(list: TaskRecord[]) {
  return list.map((t) => (t.status === "running" ? { ...t, status: "stopped" as const } : t));
}

function trimSnapshot(data: any) {
  if (!data || typeof data !== "object") return undefined;
  return {
    ...data,
    results: Array.isArray(data.results) ? data.results.slice(0, 150) : [],
    sourceRegistry: Array.isArray(data.sourceRegistry) ? data.sourceRegistry.slice(0, 200) : [],
    rejectedCandidates: undefined,
    accessEvents: Array.isArray(data.accessEvents) ? data.accessEvents.slice(0, 40) : [],
  };
}

export function saveTasks(list: TaskRecord[]) {
  let next = list.slice(0, MAX_TASKS);
  try {
    let json = JSON.stringify(next);
    // Drop the oldest snapshots first when storage would grow too large.
    for (let i = next.length - 1; json.length > MAX_BYTES && i >= 0; i -= 1) {
      if (next[i].snapshot) next = next.map((t, j) => (j === i ? { ...t, snapshot: undefined } : t));
      json = JSON.stringify(next);
    }
    window.localStorage.setItem(KEY, json);
  } catch {
    /* storage full or blocked: the list still works for this visit */
  }
  return next;
}

export function upsertTask(list: TaskRecord[], patch: Partial<TaskRecord> & { id: string }) {
  const existing = list.find((t) => t.id === patch.id);
  const merged: TaskRecord = {
    id: patch.id,
    query: patch.query ?? existing?.query ?? "",
    status: patch.status ?? existing?.status ?? "running",
    startedAt: patch.startedAt ?? existing?.startedAt ?? new Date().toISOString(),
    finishedAt: patch.status === "running" ? undefined : patch.finishedAt ?? existing?.finishedAt,
    rounds: patch.rounds ?? existing?.rounds ?? 0,
    resultsCount: patch.resultsCount ?? existing?.resultsCount ?? 0,
    counters: patch.counters ?? existing?.counters,
    error: patch.error ?? (patch.status && patch.status !== "failed" ? undefined : existing?.error),
    snapshot: patch.snapshot !== undefined ? trimSnapshot(patch.snapshot) : existing?.snapshot,
  };
  return [merged, ...list.filter((t) => t.id !== patch.id)];
}

export function newTaskId() {
  return "T-" + Date.now().toString(36).toUpperCase();
}

export function formatDuration(startedAt: string, finishedAt?: string) {
  const ms = (finishedAt ? Date.parse(finishedAt) : Date.now()) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? s + " s" : Math.floor(s / 60) + " min " + (s % 60) + " s";
}
