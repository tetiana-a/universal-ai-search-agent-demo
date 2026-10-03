// Chat-completion providers for structured extraction, tried in order until one
// answers. Every provider here has a free tier; Pro can point OpenRouter at a
// stronger paid model with PRO_OPENROUTER_MODEL.

export type AiProviderId = "openrouter" | "gemini" | "groq";
export type Edition = "free" | "pro";

type AiProvider = { id: AiProviderId; label: string; endpoint: string; key: string; model: string; strictSchema: boolean; headers?: Record<string, string> };

export function configuredAiProviders(edition: Edition = "free"): AiProvider[] {
  const out: AiProvider[] = [];
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (openRouterKey) {
    const freeModel = process.env.OPENROUTER_MODEL || "openrouter/free";
    out.push({
      id: "openrouter",
      label: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      key: openRouterKey,
      model: edition === "pro" ? (process.env.PRO_OPENROUTER_MODEL || freeModel) : freeModel,
      strictSchema: true,
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://universal-ai-search-agent-demo.vercel.app",
        "X-OpenRouter-Title": "Aurelius Universal AI Research Engine",
      },
    });
  }
  const geminiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "").trim();
  if (geminiKey) {
    out.push({
      id: "gemini",
      label: "Google Gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: geminiKey,
      model: (edition === "pro" && process.env.PRO_GEMINI_MODEL) || process.env.GEMINI_MODEL || "gemini-2.5-flash",
      strictSchema: false,
    });
  }
  const groqKey = String(process.env.GROQ_API_KEY || "").trim();
  if (groqKey) {
    out.push({
      id: "groq",
      label: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      key: groqKey,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      strictSchema: false,
    });
  }
  return out;
}

function extractText(response: any) {
  const message = response?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) return message.content.map((part: any) => String(part?.text || "")).join("").trim();
  return "";
}

export function parseJsonLoose(text: string) {
  const trimmed = text.trim().replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("invalid structured output");
}

export type AiAttempt = { provider: AiProviderId; model: string; ok: boolean; message?: string };
export type AiExtraction = { parsed: any | null; usage: any; provider?: AiProviderId; model?: string; attempts: AiAttempt[]; error: string };

// Tries each configured provider until one returns valid JSON or the time budget runs out.
export async function runStructuredExtraction(options: {
  system: string;
  user: string;
  schema: unknown;
  edition?: Edition;
  deadlineAt: number;
  maxTokens: number;
  perCallTimeoutMs: number;
}): Promise<AiExtraction> {
  const providers = configuredAiProviders(options.edition || "free");
  const attempts: AiAttempt[] = [];
  if (!providers.length) {
    return { parsed: null, usage: null, attempts, error: "No AI key configured (OPENROUTER_API_KEY, GEMINI_API_KEY or GROQ_API_KEY); results were extracted by rules and need manual review." };
  }
  for (const provider of providers) {
    const remaining = options.deadlineAt - Date.now() - 2500;
    const timeoutMs = Math.min(options.perCallTimeoutMs, remaining);
    if (timeoutMs < 5000) {
      attempts.push({ provider: provider.id, model: provider.model, ok: false, message: "Not enough time left for AI extraction; candidates are shown for manual review." });
      break;
    }
    const responseFormat = provider.strictSchema
      ? { type: "json_schema", json_schema: { name: "aurelius_research", strict: true, schema: options.schema } }
      : { type: "json_object" };
    const user = provider.strictSchema ? options.user : options.user + "\n\nJSON SCHEMA (follow exactly):\n" + JSON.stringify(options.schema);
    try {
      const response = await fetch(provider.endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + provider.key, "Content-Type": "application/json", ...(provider.headers || {}) },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "system", content: options.system }, { role: "user", content: user }],
          temperature: 0.1,
          max_tokens: options.maxTokens,
          response_format: responseFormat,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw: any = await response.json().catch(() => null);
      if (!response.ok) {
        attempts.push({ provider: provider.id, model: provider.model, ok: false, message: provider.label + " HTTP " + response.status + ": " + String(raw?.error?.message || "request failed") });
        continue;
      }
      try {
        const parsed = parseJsonLoose(extractText(raw));
        attempts.push({ provider: provider.id, model: provider.model, ok: true });
        return { parsed, usage: raw?.usage || null, provider: provider.id, model: provider.model, attempts, error: "" };
      } catch {
        attempts.push({ provider: provider.id, model: provider.model, ok: false, message: provider.label + " returned invalid structured output." });
      }
    } catch (error) {
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      attempts.push({
        provider: provider.id,
        model: provider.model,
        ok: false,
        message: timeout
          ? provider.label + ": AI extraction timed out after " + Math.round(timeoutMs / 1000) + "s."
          : provider.label + " request failed: " + (error instanceof Error ? error.message : "network error"),
      });
    }
  }
  const error = attempts.filter((a) => a.message).map((a) => a.message).join(" ") + " Candidates are shown for manual review.";
  return { parsed: null, usage: null, attempts, error };
}
