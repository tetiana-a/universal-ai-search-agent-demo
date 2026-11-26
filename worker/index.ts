import * as Sentry from "@sentry/node";
import { run, type Task } from "graphile-worker";
import { Pool } from "pg";
import { beat, JOBS, recordDead, runJob, type JobName } from "@/lib/jobs";
import { reportChatId, sendMessage } from "@/lib/scout/telegram";
import { escapeHtml } from "@/lib/scout/text";
import { CRONTAB } from "./crontab";

// AURELIUS background queue: Graphile Worker on Supabase PostgreSQL (runs on Render). Start: npm run worker.

// Dead letter: failed jobs stay in graphile_worker.jobs (Graphile keeps them); we also copy
// them to public.aurelius_dead_jobs for a readable table in Supabase, /control and one alert.
const DEAD_SQL = `create table if not exists public.aurelius_dead_jobs (
  id bigserial primary key, job text not null, attempts int not null, error text not null, payload jsonb, failed_at timestamptz not null default now());
alter table public.aurelius_dead_jobs enable row level security;`;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (Supabase → Connect → Session pooler)");
  if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, environment: "worker", tracesSampleRate: 0 });

  const task = (name: JobName): Task => async (payload, helpers) => {
    try {
      helpers.logger.info("start " + name + " (attempt " + helpers.job.attempts + "/" + helpers.job.max_attempts + ")");
      await runJob(name);
    } catch (error) {
      if (helpers.job.attempts >= helpers.job.max_attempts) {
        const message = await recordDead(name, helpers.job.attempts, error);
        await helpers.query("insert into public.aurelius_dead_jobs (job, attempts, error, payload) values ($1, $2, $3, $4)", [name, helpers.job.attempts, message, JSON.stringify(payload ?? null)]).catch(() => null);
        const chat = await reportChatId().catch(() => "");
        if (chat) await sendMessage(chat, "⚠️ <b>Фоновая задача не выполнилась</b>\n" + escapeHtml(JOBS[name].label) + " · попыток " + helpers.job.attempts + "\n" + escapeHtml(message.slice(0, 200))).catch(() => null);
      } else {
        Sentry.captureException(error, { tags: { job: name, attempt: String(helpers.job.attempts) } });
      }
      throw error;
    }
  };

  // shortcut: TLS without CA check (Supabase pooler CA is not in Node's store); add the CA file if stricter TLS is required.
  // Supabase pooler needs TLS; the pool is shared by the queue, the heartbeat and the dead-letter insert.
  const pgPool = new Pool({ connectionString, max: 6, ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false } });
  pgPool.on("error", (e) => console.error("[worker] pg pool:", e.message));
  await pgPool.query(DEAD_SQL);
  const runner = await run({
    pgPool,
    concurrency: 3,
    pollInterval: 5000,
    crontab: CRONTAB,
    taskList: Object.fromEntries((Object.keys(JOBS) as JobName[]).map((n) => [n, task(n)])),
  });
  await runner.addJob("dispatch", {}, { jobKey: "dispatch", maxAttempts: 3 }); // first wave right after a deploy

  // Heartbeat every minute, only while the database answers: /control shows it, and the
  // Vercel/GitHub crons stand down while it is fresh (they take over after 5 min of silence).
  const startedAt = new Date().toISOString();
  const version = process.env.RENDER_GIT_COMMIT?.slice(0, 7);
  const tick = async () => {
    try { await pgPool.query("select 1"); await beat(startedAt, version); }
    catch (error) { console.error("[worker] heartbeat skipped:", error); }
  };
  await tick();
  const timer = setInterval(tick, 60_000);
  console.log("[worker] AURELIUS queue running");
  await runner.promise.finally(() => clearInterval(timer));
}

main().catch(async (error) => {
  console.error("[worker] fatal:", error);
  Sentry.captureException(error);
  await Sentry.flush(3000);
  process.exit(1);
});
