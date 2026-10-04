// Chat-completion providers for structured extraction, tried in order until one
// answers. Every provider here has a free tier; Pro can point OpenRouter at a
// stronger paid model with PRO_OPENROUTER_MODEL.

export type AiProviderId = "openrouter" | "gemini" | "groq";
export type Edition = "free" | "pro";

type AiProvider = { id: AiProviderId; label: string; endpoint: string; key: string; model: string; models?: string[]; headers?: Record<string, string> };

// Free OpenRouter model IDs come and go. When OPENROUTER_MODEL is not set, the current
// free models are read from OpenRouter's public model list and the best few are tried in
// turn. These IDs are only the fallback when that list cannot be fetched.
export const FALLBACK_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
];
const PREFERRED_FREE = [/llama-3\.3-70b/i, /deepseek-(chat|v3)/i, /gemini.*flash/i, /qwen.*(72b|235b|max)/i, /llama-4/i, /mistral-(small|medium)/i, /gpt-oss/i];
let freeModelCache: { at: number; models: string[] } | null = null;

// Only text-in/text-out chat models that support JSON output are usable; music, image,
// audio and embedding models (e.g. Lyria) are never picked even when listed as free.
const NOT_CHAT = /lyria|image|imagen|audio|music|tts|whisper|speech|veo|video|embed|rerank|guard|moderation|vision-only|omni/i;
const REASONING = /reason|thinking|r1\b|qwq/i;

export function rankFreeModels(list: any[]): string[] {
  const free = (Array.isArray(list) ? list : []).filter((m) => {
    const id = String(m?.id || "");
    const prompt = Number(m?.pricing?.prompt ?? NaN);
    const completion = Number(m?.pricing?.completion ?? NaN);
    const isFree = id.endsWith(":free") && (Number.isNaN(prompt) || prompt === 0) && (Number.isNaN(completion) || completion === 0);
    const out = m?.architecture?.output_modalities;
    const input = m?.architecture?.input_modalities;
    const textOnlyOut = !Array.isArray(out) || (out.length > 0 && out.every((x: string) => x === "text"));
    const textIn = !Array.isArray(input) || input.includes("text");
    const params = Array.isArray(m?.supported_parameters) ? m.supported_parameters : null;
    const json = !params || params.includes("response_format") || params.includes("structured_outputs");
    return id && isFree && textOnlyOut && textIn && json && !NOT_CHAT.test(id) && Number(m?.context_length || 0) >= 16000;
  });
  const score = (m: any) => {
    const id = String(m.id);
    const pref = PREFERRED_FREE.findIndex((re) => re.test(id));
    // Reasoning models spend the small token budget on thinking and often return no JSON.
    return [pref === -1 ? 99 : pref, REASONING.test(id) ? 1 : 0, -Number(m?.context_length || 0)];
  };
  return free
    .map((m) => ({ id: String(m.id), s: score(m) }))
    .sort((a, b) => a.s[0] - b.s[0] || a.s[1] - b.s[1] || a.s[2] - b.s[2])
    .map((m) => m.id);
}

// Per-instance memory: the model that last answered with valid JSON is tried first, and a
// model that failed (bad request, not JSON) is skipped for a while.
const modelHealth = new Map<string, { goodAt?: number; badUntil?: number }>();
const BAD_FOR_MS = 15 * 60 * 1000;
export function markModel(model: string, ok: boolean) {
  const h = modelHealth.get(model) || {};
  if (ok) modelHealth.set(model, { goodAt: Date.now() });
  else modelHealth.set(model, { ...h, badUntil: Date.now() + BAD_FOR_MS });
}
export function orderByHealth(models: string[]) {
  const now = Date.now();
  const usable = models.filter((m) => !((modelHealth.get(m)?.badUntil || 0) > now));
  const list = usable.length ? usable : models;
  return [...list].sort((a, b) => (modelHealth.get(b)?.goodAt || 0) - (modelHealth.get(a)?.goodAt || 0));
}

export function resetFreeModelCache() { freeModelCache = null; modelHealth.clear(); }

async function freeOpenRouterModels(): Promise<string[]> {
  if (freeModelCache && Date.now() - freeModelCache.at < 60 * 60 * 1000) return freeModelCache.models;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(3500), cache: "no-store" });
    const payload: any = await response.json().catch(() => null);
    const ranked = rankFreeModels(payload?.data).slice(0, 6);
    if (ranked.length) {
      freeModelCache = { at: Date.now(), models: ranked };
      return ranked;
    }
  } catch (error) {
    console.warn("[ai] could not read OpenRouter model list:", error instanceof Error ? error.message : error);
  }
  return FALLBACK_FREE_MODELS;
}

export function configuredAiProviders(edition: Edition = "free"): AiProvider[] {
  const out: AiProvider[] = [];
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || "").trim();
  if (openRouterKey) {
    const configured = String((edition === "pro" && process.env.PRO_OPENROUTER_MODEL) || process.env.OPENROUTER_MODEL || "").trim();
    out.push({
      id: "openrouter",
      label: "OpenRouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      key: openRouterKey,
      // "auto-free" means: pick from the current free models at call time.
      model: configured || "auto-free",
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://universal-ai-search-agent-demo.vercel.app",
        "X-Title": "Aurelius Universal AI Research Engine",
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
  // One call to one model. A model that rejects response_format is retried once without it.
  async function call(provider: AiProvider, model: string, timeoutMs: number, withFormat: boolean) {
    const user = options.user + "\n\nJSON SCHEMA (follow exactly, return only the JSON object):\n" + JSON.stringify(options.schema);
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + provider.key, "Content-Type": "application/json", ...(provider.headers || {}) },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: options.system }, { role: "user", content: user }],
        temperature: 0.1,
        max_tokens: options.maxTokens,
        ...(withFormat ? { response_format: { type: "json_object" } } : {}),
        // OpenRouter: route only to models that honour response_format (the free router
        // otherwise lands on models that answer in prose).
        ...(withFormat && provider.id === "openrouter" ? { provider: { require_parameters: true } } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw: any = await response.json().catch(() => null);
    return { response, raw };
  }

  for (const provider of providers) {
    // OpenRouter: the configured model first, then current free models as a fallback.
    const models = provider.id !== "openrouter"
      ? [provider.model]
      : orderByHealth([...new Set([...(provider.model === "auto-free" ? [] : [provider.model]), ...(await freeOpenRouterModels())])]);
    for (const model of models.slice(0, 4)) {
      const remaining = options.deadlineAt - Date.now() - 1500;
      const timeoutMs = Math.min(options.perCallTimeoutMs, remaining);
      if (timeoutMs < 4000) {
        attempts.push({ provider: provider.id, model, ok: false, message: provider.label + ": not enough time left for AI verification." });
        break;
      }
      try {
        let { response, raw } = await call(provider, model, timeoutMs, true);
        const errText = String(raw?.error?.message || raw?.error || "");
        if (!response.ok && (response.status === 400 || response.status === 404 || response.status === 422) && /response_format|json|structured|parameter/i.test(errText)) {
          ({ response, raw } = await call(provider, model, Math.min(timeoutMs, options.deadlineAt - Date.now() - 1500), false));
        }
        if (!response.ok || raw?.error) {
          const message = provider.label + " " + model + " HTTP " + response.status + ": " + String(raw?.error?.message || raw?.error?.metadata?.raw || "request failed").slice(0, 240);
          console.warn("[ai] " + message);
          attempts.push({ provider: provider.id, model, ok: false, message });
          if (response.status !== 429) markModel(model, false);
          continue;
        }
        try {
          const parsed = parseJsonLoose(extractText(raw));
          attempts.push({ provider: provider.id, model: String(raw?.model || model), ok: true });
          markModel(model, true);
          return { parsed, usage: raw?.usage || null, provider: provider.id, model: String(raw?.model || model), attempts, error: "" };
        } catch {
          const finish = String(raw?.choices?.[0]?.finish_reason || "");
          const snippet = extractText(raw).replace(/\s+/g, " ").slice(0, 200);
          const message = provider.label + " " + String(raw?.model || model) + " returned text that is not valid JSON" + (finish ? " (finish_reason " + finish + ")" : "") + (snippet ? ": " + snippet : ": empty answer") + ".";
          console.warn("[ai] " + message);
          attempts.push({ provider: provider.id, model, ok: false, message });
          markModel(model, false);
        }
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        const message = timeout
          ? provider.label + " " + model + ": no answer within " + Math.round(timeoutMs / 1000) + "s."
          : provider.label + " " + model + " request failed: " + (error instanceof Error ? error.message : "network error");
        console.warn("[ai] " + message);
        attempts.push({ provider: provider.id, model, ok: false, message });
      }
    }
  }
  const error = attempts.filter((a) => a.message).map((a) => a.message).join(" ") + " Candidates are shown for manual review.";
  return { parsed: null, usage: null, attempts, error };
}
