import * as Sentry from "@sentry/nextjs";
import { configuredAiProviders, runStructuredExtraction } from "@/lib/free-ai";
import { readWorkerStatus, workerSummary } from "@/lib/jobs";
import { isCronRequest, unauthorized } from "@/lib/scout/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Production self-check (GitHub → Actions → «Production self-check»): one tiny call to every
// configured AI provider, one test event to Sentry, and the background-queue state.
export async function GET(request: Request) {
  if (!isCronRequest(request)) return unauthorized();
  const deadline = Date.now() + 100_000;
  const ai = [];
  for (const p of configuredAiProviders("free")) {
    const r = await runStructuredExtraction({
      system: "You are a health check.", user: "Return {\"ok\": true}.", schema: { type: "object", properties: { ok: { type: "boolean" } } },
      deadlineAt: Math.min(deadline, Date.now() + 25_000), maxTokens: 30, perCallTimeoutMs: 20_000, prefer: p.id,
    });
    const own = r.attempts.filter((a) => a.provider === p.id);
    ai.push({ provider: p.id, ok: r.provider === p.id, model: r.provider === p.id ? r.model : own[0]?.model, error: r.provider === p.id ? undefined : own.map((a) => a.message).join(" ").slice(0, 300) });
  }
  let sentry: { configured: boolean; eventId?: string; sent?: boolean } = { configured: Boolean(process.env.SENTRY_DSN) };
  if (sentry.configured) {
    const eventId = Sentry.captureException(new Error("AURELIUS self-check: Sentry test event (not a real error)"), { tags: { selfcheck: "yes" } });
    sentry = { ...sentry, eventId, sent: await Sentry.flush(5000) };
  }
  return Response.json({ ok: true, at: new Date().toISOString(), ai, sentry, worker: workerSummary(await readWorkerStatus()) });
}
