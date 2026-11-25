import { parseCrontab } from "graphile-worker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as dispatch } from "@/app/api/campaigns/dispatch/route";
import { beat, readWorkerStatus, recordDead, runJob, workerAlive, workerSummary, WORKER_STALE_MS } from "@/lib/jobs";
import { resetMemoryStore } from "@/lib/scout/store";
import { CRONTAB } from "@/worker/crontab";

const cron = () => new Request("https://x/api/campaigns/dispatch", { headers: { authorization: "Bearer test-only-secret" } });

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllEnvs();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("CRON_SECRET", "test-only-secret");
  vi.stubEnv("CAMPAIGN_AUTOPOST", "");
});

describe("background queue", () => {
  it("has a valid crontab with retries and job keys for every job", () => {
    const items = parseCrontab(CRONTAB);
    expect(items.map((i) => i.task).sort()).toEqual(["daily_campaigns", "daily_groups", "daily_scout", "dispatch"]);
    for (const i of items) { expect(i.options.maxAttempts).toBeGreaterThan(1); expect(i.options.jobKey).toBe(i.task); }
  });

  it("crons stand down while the worker heartbeat is fresh and take over when it is silent", async () => {
    expect(await workerAlive()).toBe(false);
    expect(await (await dispatch(cron())).json()).toMatchObject({ disabled: true });
    await beat(new Date().toISOString());
    expect(await workerAlive()).toBe(true);
    expect(await (await dispatch(cron())).json()).toMatchObject({ skipped: "worker" });
    vi.stubEnv("WORKER_FALLBACK", "always");
    expect(await workerAlive()).toBe(false);
  });

  it("summarises the state for /control", () => {
    const now = Date.now();
    const s = { at: now, startedAt: "", jobs: {}, dead: [] };
    expect(workerSummary(null).state).toBe("off");
    expect(workerSummary(s, now + 30_000).state).toBe("on");
    expect(workerSummary(s, now + WORKER_STALE_MS + 1).state).toBe("stale");
  });

  it("records job runs and keeps the last 20 dead jobs", async () => {
    await beat("t");
    await runJob("dispatch");
    for (let i = 0; i < 22; i++) await recordDead("dispatch", 3, new Error("boom " + i));
    const st = await readWorkerStatus();
    expect(st?.jobs.dispatch).toMatchObject({ ok: true, result: { disabled: true } });
    expect(st?.dead).toHaveLength(20);
    expect(st?.dead[0].error).toBe("boom 21");
  });
});
