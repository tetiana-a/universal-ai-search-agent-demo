import { captureException } from "@sentry/core";
import { getValue, setValue } from "@/lib/scout/store";

// Background jobs shared by the Graphile Worker (worker/, on Render) and the Vercel/GitHub crons.
// While the worker is alive the crons stand down, so each job runs from exactly one place;
// if the worker stops, the old schedule takes over again by itself (fallback, nothing to switch).

export type JobName = "dispatch" | "daily_campaigns" | "daily_groups" | "daily_scout";
export type JobRun = { at: string; ok: boolean; ms: number; error?: string; result?: unknown };
export type DeadJob = { at: string; job: string; attempts: number; error: string };
export type WorkerStatus = { at: number; startedAt: string; version?: string; jobs: Partial<Record<JobName, JobRun>>; dead: DeadJob[] };

// Separate keys, so the heartbeat and a finishing job never overwrite each other.
const BEAT_KEY = "worker:beat";
const JOB_KEY = "worker:job:";
const DEAD_KEY = "worker:dead";
export const WORKER_STALE_MS = 5 * 60_000; // heartbeat runs every minute; 5 min of silence = stopped

export const JOBS: Record<JobName, { label: string; run: () => Promise<unknown> }> = {
  // Imports are lazy: a cron route loads only the code of its own job.
  dispatch: { label: "Публикации по расписанию", run: async () => {
    const c = await import("@/lib/scout/campaigns");
    if (process.env.CAMPAIGN_AUTOPOST !== "on") return { disabled: true };
    await c.markDispatch();
    return c.dispatchBotTasks(undefined, Date.now() + 10 * 60_000);
  } },
  daily_campaigns: { label: "Кампании: план, партнёры, отчёт", run: async () => (await import("@/lib/scout/campaigns")).runDaily(Date.now() + 25 * 60_000) },
  daily_groups: { label: "Обновление базы сообществ", run: async () => {
    const p = await import("@/lib/scout/client-profile");
    const profile = await p.runProfileBatch(Date.now() + 10 * 60_000);
    const campaign = await p.refreshOneCampaign(Date.now() + 20 * 60_000).catch(() => null);
    return { profile, campaign };
  } },
  daily_scout: { label: "Разведчик: скан и отчёт", run: async () => {
    const [{ runScan }, { sendDailyReport }] = await Promise.all([import("@/lib/scout/scan"), import("@/lib/scout/report")]);
    // The report goes out even if the scan failed: dialogues, drafts and meetings still matter.
    const stats = await runScan({ actor: "cron", deadlineAt: Date.now() + 10 * 60_000 }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    const report = await sendDailyReport("cron");
    return { stats, report: { ok: report.ok, error: report.error } };
  } },
};

export async function readWorkerStatus(): Promise<WorkerStatus | null> {
  const names = Object.keys(JOBS) as JobName[];
  const [beatValue, dead, ...runs] = await Promise.all([
    getValue<{ at: number; startedAt: string; version?: string }>(BEAT_KEY),
    getValue<DeadJob[]>(DEAD_KEY),
    ...names.map((n) => getValue<JobRun>(JOB_KEY + n)),
  ].map((p) => (p as Promise<unknown>).catch(() => null))) as [{ at: number; startedAt: string; version?: string } | null, DeadJob[] | null, ...(JobRun | null)[]];
  if (!beatValue) return null;
  const jobs: WorkerStatus["jobs"] = {};
  names.forEach((n, i) => { if (runs[i]) jobs[n] = runs[i]!; });
  return { ...beatValue, jobs, dead: dead || [] };
}

export function workerAliveIn(status: WorkerStatus | null, now = Date.now()) {
  return Boolean(status && now - status.at < WORKER_STALE_MS);
}

// Crons ask this first: true → the worker owns the schedule, the cron does nothing.
export async function workerAlive() {
  if (String(process.env.WORKER_FALLBACK || "").toLowerCase() === "always") return false;
  return workerAliveIn(await readWorkerStatus());
}

export async function beat(startedAt: string, version?: string) {
  await setValue(BEAT_KEY, { at: Date.now(), startedAt, version }, 7 * 86_400).catch(() => null);
}

// Runs one job and records the outcome for /control. Throws on failure so the queue retries it.
export async function runJob(name: JobName) {
  const started = Date.now();
  try {
    const result = await JOBS[name].run();
    await setValue(JOB_KEY + name, { at: new Date().toISOString(), ok: true, ms: Date.now() - started, result } satisfies JobRun).catch(() => null);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setValue(JOB_KEY + name, { at: new Date().toISOString(), ok: false, ms: Date.now() - started, error: message.slice(0, 300) } satisfies JobRun).catch(() => null);
    throw error;
  }
}

// Last attempt failed: keep it on /control (last 20) and report it once.
export async function recordDead(job: string, attempts: number, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  captureException(error, { tags: { job, dead_letter: "yes" } });
  const dead = (await getValue<DeadJob[]>(DEAD_KEY).catch(() => null)) || [];
  await setValue(DEAD_KEY, [{ at: new Date().toISOString(), job, attempts, error: message }, ...dead].slice(0, 20)).catch(() => null);
  return message;
}

// Text for /control: is the background queue running, stopped, or not set up yet.
export function workerSummary(status: WorkerStatus | null, now = Date.now()) {
  if (!status) return { state: "off" as const, text: "Не подключена. Публикации идут через GitHub каждые 15 минут." };
  const minutes = Math.floor((now - status.at) / 60_000);
  if (minutes * 60_000 >= WORKER_STALE_MS) return { state: "stale" as const, text: "Молчит " + minutes + " мин. Работает запасной вариант (GitHub и Vercel)." };
  return { state: "on" as const, text: "Работает. Последний сигнал " + (minutes < 1 ? "меньше минуты" : minutes + " мин") + " назад." };
}
