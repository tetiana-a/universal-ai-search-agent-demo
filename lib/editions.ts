import { configuredAiProviders, type Edition } from "@/lib/free-ai";
import { configuredFallbackProviders } from "@/lib/provider-search";
import { keylessProviders } from "@/lib/keyless-search";
import { getPlans, publicPlanInfo, type Plan } from "@/lib/plans";

// Two editions of the same agent:
//  - Free: keyless search (DuckDuckGo / SearXNG), Jina Reader without a key or with
//    its free key, free-tier AI (OpenRouter free models, Gemini, Groq) or rule-based
//    extraction when no AI key is set. Never needs a paid key.
//  - Pro: the same pipeline with larger budgets, paid search APIs when configured, a
//    stronger OpenRouter model (PRO_OPENROUTER_MODEL) or OpenAI deep research with
//    web search when OPENAI_API_KEY is set.

export type Pipeline = "free" | "paid";

export function researchMode() {
  const value = String(process.env.RESEARCH_AI_PROVIDER || "auto").toLowerCase();
  return value === "free" || value === "paid" || value === "openai" ? value : "auto";
}

export function pipelineFor(plan: Plan): Pipeline {
  const mode = researchMode();
  if (mode === "free") return "free";
  const openAi = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  if (mode === "paid" || mode === "openai") return openAi ? "paid" : "free";
  return plan.id === "pro" && openAi ? "paid" : "free";
}

export function editionFor(plan: Plan): Edition {
  return plan.id === "pro" ? "pro" : "free";
}

function searchStack(edition: Edition) {
  const stack: string[] = [];
  if (process.env.JINA_API_KEY) stack.push("jina");
  stack.push(...keylessProviders());
  const paid = configuredFallbackProviders();
  if (edition === "pro" || process.env.SUPPLEMENTAL_SEARCH_ENABLED === "true") stack.push(...paid);
  else if (paid.length) stack.push(...paid.map((p) => p + " (fallback)"));
  return stack;
}

// What each edition can do on this deployment right now, with honest limitations.
export function editionCapabilities() {
  const plans = getPlans();
  const openAi = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  const describe = (edition: Edition) => {
    const plan = edition === "pro" ? plans.pro : plans.free;
    const ai = configuredAiProviders(edition).map((p) => ({ provider: p.id, model: p.model }));
    const pipeline = pipelineFor(plan);
    const limitations: string[] = [];
    if (!ai.length && pipeline === "free") limitations.push("no_ai_key_rule_based_extraction");
    if (!process.env.JINA_API_KEY) limitations.push("jina_reader_keyless_rate_limited");
    if (!process.env.SEARXNG_URL && !process.env.JINA_API_KEY && !configuredFallbackProviders().length) limitations.push("duckduckgo_only_may_rate_limit");
    if (!process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) limitations.push("source_base_not_persistent");
    limitations.push("no_login_or_captcha_sources");
    return {
      edition,
      pipeline,
      ai: pipeline === "paid" ? [{ provider: "openai", model: process.env.OPENAI_MODEL || "gpt-5.5" }] : ai,
      search: pipeline === "paid" ? ["openai_web_search", ...searchStack(edition)] : searchStack(edition),
      plan: publicPlanInfo(plan),
      limitations,
    };
  };
  return { mode: researchMode(), openAiConfigured: openAi, free: describe("free"), pro: describe("pro") };
}
