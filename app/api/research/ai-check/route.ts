import { NextResponse } from "next/server";
import { configuredAiProviders, runStructuredExtraction } from "@/lib/free-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live check of the AI verification step: which providers are configured (never the keys),
// which model answered, and the exact error of each failed attempt.
export async function GET() {
  const providers = configuredAiProviders("free").map((p) => ({ provider: p.id, model: p.model }));
  if (!providers.length) {
    return NextResponse.json({ ok: false, providers, message: "No AI key configured: set OPENROUTER_API_KEY, GEMINI_API_KEY or GROQ_API_KEY." }, { headers: { "Cache-Control": "no-store" } });
  }
  const started = Date.now();
  const out = await runStructuredExtraction({
    system: "Return JSON only.",
    user: "Return {\"ok\": true, \"word\": \"aurelius\"}.",
    schema: { type: "object", properties: { ok: { type: "boolean" }, word: { type: "string" } }, required: ["ok", "word"] },
    deadlineAt: Date.now() + 25_000,
    maxTokens: 60,
    perCallTimeoutMs: 20_000,
  });
  return NextResponse.json(
    { ok: Boolean(out.parsed), providers, answeredBy: out.provider ? { provider: out.provider, model: out.model } : null, ms: Date.now() - started, attempts: out.attempts, error: out.error || undefined },
    { headers: { "Cache-Control": "no-store" } },
  );
}
