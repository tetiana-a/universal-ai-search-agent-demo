import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/task/route";
import { clearReaderCache } from "@/lib/free-research";
import { resetLocalQuotaCounters } from "@/lib/plans";
import { checkNumericCriteria, parseNumericCriteria } from "@/lib/criteria";
import { rankFreeModels, resetFreeModelCache, runStructuredExtraction } from "@/lib/free-ai";
import { buildSourceMap, pickBranches, roughEnglish } from "@/lib/source-map";
import { isNoiseSource } from "@/lib/page-kind";
import { json, mockFetch, openRouterReply, postJson, verifyReply } from "./helpers";

beforeEach(() => {
  clearReaderCache();
  resetLocalQuotaCounters();
  resetFreeModelCache();
  vi.stubEnv("RESEARCH_AI_PROVIDER", "free");
  vi.stubEnv("PLAN_ENFORCEMENT", "off");
  vi.stubEnv("JINA_API_KEY", "jina_test_key");
  vi.stubEnv("OPENROUTER_API_KEY", "or_test_key");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("TRANSLATE_QUERY", "off");
  vi.stubEnv("DIRECT_READ", "off");
  for (const key of ["GEMINI_API_KEY", "GROQ_API_KEY", "SEARXNG_URL", "PRO_OPENROUTER_MODEL", "OPENAI_API_KEY", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "SERPER_API_KEY", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("numeric criteria", () => {
  it("reads minimum area and maximum price from Russian and English tasks", () => {
    expect(parseNumericCriteria("Найди земельные участки в Мадриде от 10 000 м²")).toEqual({ minAreaM2: 10000 });
    expect(parseNumericCriteria("plots in Madrid at least 2 ha, up to 500 000 €")).toEqual({ minAreaM2: 20000, maxPrice: 500000 });
    expect(parseNumericCriteria("участки площадью 1,5 га и более до 2 млн евро")).toEqual({ minAreaM2: 15000, maxPrice: 2000000 });
  });

  it("fails a plot below the minimum, passes one above, and flags a missing value", () => {
    const c = { minAreaM2: 10000 };
    expect(checkNumericCriteria(c, { title: "Parcela 3.200 m2 en Madrid" }).verdict).toBe("fail");
    expect(checkNumericCriteria(c, { area: "1,2 ha" }).verdict).toBe("pass");
    expect(checkNumericCriteria(c, { title: "Parcela en Madrid" }, "Sin superficie").verdict).toBe("unknown");
  });
});

describe("AI provider", () => {
  it("picks current free models from the OpenRouter list", () => {
    const list = [
      { id: "openai/gpt-5", pricing: { prompt: "0.00001", completion: "0.00003" }, context_length: 400000 },
      { id: "some/tiny-model:free", pricing: { prompt: "0", completion: "0" }, context_length: 8000 },
      { id: "mistralai/mistral-small-3.2-24b-instruct:free", pricing: { prompt: "0", completion: "0" }, context_length: 96000 },
      { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" }, context_length: 131000, supported_parameters: ["response_format"] },
    ];
    expect(rankFreeModels(list)).toEqual(["meta-llama/llama-3.3-70b-instruct:free", "mistralai/mistral-small-3.2-24b-instruct:free"]);
  });

  it("moves to the next free model on a rate limit and retries without response_format when a model rejects it", async () => {
    const bodies: any[] = [];
    mockFetch([
      { match: (u) => u.endsWith("/api/v1/models"), respond: () => json({ data: [
        { id: "a/first:free", pricing: { prompt: "0", completion: "0" }, context_length: 32000 },
        { id: "b/second:free", pricing: { prompt: "0", completion: "0" }, context_length: 32000 },
      ] }) },
      { match: (u) => u.endsWith("/chat/completions"), respond: (_u, init) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (body.model === "a/first:free") return json({ error: { message: "Rate limit exceeded: free-models-per-min" } }, 429);
        if (body.response_format) return json({ error: { message: "response_format is not supported by this model" } }, 400);
        return openRouterReply({ ok: true });
      } },
    ]);
    const out = await runStructuredExtraction({ system: "s", user: "u", schema: {}, deadlineAt: Date.now() + 30000, maxTokens: 50, perCallTimeoutMs: 10000 });
    expect(out.parsed).toEqual({ ok: true });
    expect(out.model).toBe("b/second:free");
    expect(out.attempts[0]).toMatchObject({ ok: false, model: "a/first:free" });
    expect(out.attempts[0].message).toContain("429");
    expect(bodies.map((b) => [b.model, Boolean(b.response_format)])).toEqual([["a/first:free", true], ["b/second:free", true], ["b/second:free", false]]);
  });
});

describe("filtering for entity searches", () => {
  const QUERY = "Find land plots in Madrid from 10 000 m²";
  const PAGES: Record<string, { title: string; text: string }> = {
    "https://fincas-madrid.es/parcela-valdebebas": { title: "Parcela urbana Valdebebas 12.500 m²", text: "Parcela urbana en venta en Valdebebas, Madrid. Superficie 12.500 m². Precio 3.200.000 €." },
    "https://fincas-madrid.es/parcela-small": { title: "Parcela Las Rozas", text: "Parcela en venta en Las Rozas, Madrid. Superficie 3.200 m². Precio 450.000 €." },
    "https://blog.example.com/blog/how-to-buy-land-in-spain": { title: "How to buy land in Spain: guide", text: "A guide to buying land in Madrid and Spain, 10 000 m² plots and more." },
    "https://www.reddit.com/r/spain/comments/abc/land_madrid": { title: "Buying land near Madrid?", text: "Anyone bought a 10 000 m² plot near Madrid?" },
    "https://www.youtube.com/watch?v=xyz": { title: "Land for sale Madrid tour", text: "Video tour of land in Madrid." },
  };

  it("drops forums, videos, articles and plots below the minimum area, keeps the matching plot", async () => {
    mockFetch([
      { match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: Object.entries(PAGES).map(([url, p]) => ({ url, title: p.title, description: p.text })) }) },
      { match: (u) => u.startsWith("https://r.jina.ai/"), respond: (u) => { const p = PAGES[u.slice("https://r.jina.ai/".length)]; return p ? json({ data: { content: p.text } }) : new Response("", { status: 404 }); } },
      { match: (u) => u.endsWith("/api/v1/models"), respond: () => json({ data: [{ id: "x/model:free", pricing: { prompt: "0", completion: "0" }, context_length: 64000 }] }) },
      { match: (u) => u.endsWith("/chat/completions"), respond: verifyReply({
        "https://fincas-madrid.es/parcela-valdebebas": { keep: true, page_type: "entity", name: "Parcela urbana Valdebebas", location: "Madrid", area: "12.500 m²", price: "3.200.000 €", match: 90, evidence_quote: "Superficie 12.500 m².", why: "Plot in Madrid above 10 000 m²" },
        // The model wrongly keeps a small plot: the hard filter still drops it.
        "https://fincas-madrid.es/parcela-small": { keep: true, page_type: "entity", name: "Parcela Las Rozas", location: "Madrid", area: "3.200 m²", match: 70, evidence_quote: "Superficie 3.200 m².", why: "Plot near Madrid" },
      }) },
    ]);
    const response = await POST(postJson("http://localhost/api/research/task", { query: QUERY, language: "en", testMode: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.aiStatus).toMatchObject({ ok: true, configured: true, model: "x/model:free" });
    expect(body.results.map((r: any) => r.url)).toEqual(["https://fincas-madrid.es/parcela-valdebebas"]);
    expect(body.results[0].status).toBe("Verified");
    const reasons = Object.fromEntries(body.rejectedCandidates.map((r: any) => [r.url, r.reason]));
    expect(reasons["https://fincas-madrid.es/parcela-small"]).toContain("criteria");
    expect(reasons["https://www.reddit.com/r/spain/comments/abc/land_madrid"]).toBe("forum_video_or_social");
    expect(reasons["https://www.youtube.com/watch?v=xyz"]).toBe("forum_video_or_social");
    expect(body.summary).toContain("x/model:free");
  });

  it("treats Reddit and YouTube as noise for entity searches only", () => {
    expect(isNoiseSource("https://www.reddit.com/r/led/x", "company")).toBe(true);
    expect(isNoiseSource("https://youtu.be/abc", "investor")).toBe(true);
    expect(isNoiseSource("https://www.reddit.com/r/led/x", "general")).toBe(false);
    expect(isNoiseSource("https://www.made-in-china.com/x", "company")).toBe(false);
  });
});

describe("manufacturer searches", () => {
  it("search B2B platforms and factory sites first, in English, without forums", () => {
    const query = "Найди производителей светодиодных светильников в Китае";
    expect(roughEnglish(query, "company", "China")).toBe("LED lighting manufacturers China");
    const map = buildSourceMap(query);
    const picked = pickBranches(map, 8);
    expect(picked.some((q) => q.startsWith("site:made-in-china.com LED lighting"))).toBe(true);
    expect(picked.some((q) => q.startsWith("site:globalsources.com") || q.startsWith("site:alibaba.com"))).toBe(true);
    expect(picked.some((q) => /Co\., Ltd/.test(q))).toBe(true);
    expect(picked.some((q) => /reddit/.test(q))).toBe(false);
  });
});
