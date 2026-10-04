import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/task/route";
import { clearReaderCache } from "@/lib/free-research";
import { resetLocalQuotaCounters } from "@/lib/plans";
import { EVENT_PAGE, VC_PAGE, json, mockFetch, postJson, verifyReply } from "./helpers";

const QUERY = "Find venture capital investors in Amsterdam for a B2B software startup";
const PAGES: Record<string, { title: string; text: string }> = {
  "https://northwave.vc": { title: "Northwave Ventures — Amsterdam VC fund", text: VC_PAGE },
  "https://northwave.vc/team": { title: "Team | Northwave Ventures", text: "Meet the Northwave Ventures partners. " + VC_PAGE },
  "https://amsterdam-networking.com/events/investor-night": { title: "Investor Networking Night Amsterdam", text: EVENT_PAGE },
};

function jinaSearchOk() {
  return {
    match: (url: string) => url.startsWith("https://s.jina.ai/"),
    respond: () => json({ code: 200, data: Object.entries(PAGES).map(([url, p]) => ({ url, title: p.title, description: p.text.slice(0, 160) })) }),
  };
}

function jinaReaderOk() {
  return {
    match: (url: string) => url.startsWith("https://r.jina.ai/"),
    respond: (url: string) => {
      const page = PAGES[url.slice("https://r.jina.ai/".length)];
      return page ? json({ data: { content: page.text } }) : new Response("not found", { status: 404 });
    },
  };
}

const request = (body: Record<string, unknown> = {}) => postJson("http://localhost/api/research/task", { query: QUERY, language: "en", ...body });

beforeEach(() => {
  clearReaderCache();
  resetLocalQuotaCounters();
  vi.stubEnv("RESEARCH_AI_PROVIDER", "free");
  vi.stubEnv("PLAN_ENFORCEMENT", "off");
  vi.stubEnv("JINA_API_KEY", "jina_test_key");
  vi.stubEnv("OPENROUTER_API_KEY", "or_test_key");
  vi.stubEnv("KEYLESS_SEARCH_PAUSE_MS", "0");
  vi.stubEnv("DIRECT_READ", "off");
  for (const key of ["GEMINI_API_KEY", "GROQ_API_KEY", "SEARXNG_URL", "PRO_OPENROUTER_MODEL", "OPENAI_API_KEY"]) vi.stubEnv(key, "");
  for (const key of ["BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "SERPER_API_KEY", "MOJEEK_API_KEY", "YANDEX_SEARCH_API_KEY", "NAVER_CLIENT_ID", "DATAFORSEO_LOGIN", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("research flow: explicit errors instead of empty results", () => {
  it("returns a clear 503 when keyless search is off and no search key is configured", async () => {
    vi.stubEnv("JINA_API_KEY", "");
    vi.stubEnv("KEYLESS_SEARCH", "off");
    const calls = mockFetch([]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe("JINA_API_KEY_MISSING");
    expect(body.error).toContain("JINA_API_KEY");
    expect(calls.length).toBe(0);
  });

  it("reports provider failure (HTTP 401) instead of zero results", async () => {
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ message: "unauthorized" }, 401) }]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe("SEARCH_PROVIDERS_FAILED");
    expect(body.error).toContain("JINA_API_KEY");
    expect(body.diagnostics.providers[0]).toMatchObject({ provider: "jina", status: "error", httpStatus: 401 });
  });

  it("falls back to another configured provider when Jina is rate limited", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "brave_key");
    mockFetch([
      { match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({}, 429) },
      { match: (u) => u.startsWith("https://api.search.brave.com/"), respond: () => json({ web: { results: [{ url: "https://northwave.vc", title: PAGES["https://northwave.vc"].title, description: VC_PAGE }] } }) },
      jinaReaderOk(),
      { match: (u) => u.includes("openrouter.ai"), respond: () => json({ error: { message: "upstream down" } }, 503) },
    ]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].url).toBe("https://northwave.vc");
    expect(body.providers.find((p: any) => p.provider === "jina").status).toBe("error");
    expect(body.providers.find((p: any) => p.provider === "brave").status).toBe("ok");
  });

  it("keeps live candidates as Manual review when AI extraction fails", async () => {
    mockFetch([jinaSearchOk(), jinaReaderOk(), { match: (u) => u.includes("openrouter.ai"), respond: () => json({ error: { message: "model overloaded" } }, 503) }]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("candidates_for_review");
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r: any) => r.status === "Manual review")).toBe(true);
    expect(body.results.some((r: any) => r.url.includes("/events/"))).toBe(false);
    expect(body.summary).toContain("HTTP 503");
    expect(body.aiStatus).toMatchObject({ ok: false, configured: true });
  });

  it("reports a true zero (providers answered, nothing found) with an explanation", async () => {
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: [] }) }]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("no_candidates");
    expect(body.results).toEqual([]);
    expect(body.summary.length).toBeGreaterThan(20);
  });
});

describe("research flow: normal successful run", () => {
  it("returns grounded, deduplicated, relevance-filtered results", async () => {
    const quote = "Northwave Ventures is an Amsterdam-based venture capital fund. We invest in early-stage B2B software companies";
    mockFetch([
      jinaSearchOk(),
      jinaReaderOk(),
      {
        match: (u) => u.includes("openrouter.ai"),
        respond: verifyReply({
          "https://northwave.vc": { keep: true, page_type: "entity", name: "Northwave Ventures", organization: "Northwave Ventures B.V.", specialization: "B2B software", location: "Amsterdam", investment_type: "VC", match: 85, evidence_quote: quote, why: "Amsterdam VC investing in B2B software" },
          "https://northwave.vc/team": { keep: true, page_type: "entity", name: "Northwave Ventures team", organization: "Northwave Ventures", match: 70, evidence_quote: "Meet the Northwave Ventures partners.", why: "Team page" },
          "https://amsterdam-networking.com/events/investor-night": { keep: false, page_type: "article", name: "Investor Networking Night Amsterdam", match: 20, why: "An event, not an investor" },
        }),
      },
    ]);
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("results");
    expect(body.results).toHaveLength(1);
    const [northwave] = body.results;
    expect(northwave.url).toBe("https://northwave.vc");
    expect(northwave.status).toBe("Verified");
    expect(northwave.qualityGate.gate).toBe("PASS");
    expect(northwave.qualityGate.checks.evidenceGrounded).toBe(true);
    expect(northwave.alternateUrls).toContain("https://northwave.vc/team");
    expect(body.stats.duplicatesRemoved).toBe(1);
    expect(body.rejectedCandidates.some((r: any) => r.url.includes("/events/"))).toBe(true);
    expect(body.summary).toContain("dropped");
    expect(body.sourceRegistry.find((s: any) => s.url === "https://northwave.vc").accessStatus).toBe("checked");
  });

  it("never marks a result Verified when its quote is not in the retrieved page", async () => {
    mockFetch([
      jinaSearchOk(),
      jinaReaderOk(),
      {
        match: (u) => u.includes("openrouter.ai"),
        respond: verifyReply({
          "https://northwave.vc": { keep: true, page_type: "entity", name: "Northwave Ventures", organization: "Northwave Ventures", specialization: "B2B software", location: "Amsterdam", match: 85, evidence_quote: "Northwave Ventures manages EUR 900m and invests in B2B software across Amsterdam.", why: "VC in Amsterdam" },
        }),
      },
    ]);
    const body = await (await POST(request())).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].status).toBe("Manual review");
    expect(body.results[0].qualityGate.gate).toBe("REVIEW");
    expect(body.results[0].qualityGate.dimensions.evidence.notes.join(" ")).toContain("not found");
  });
});

describe("plans", () => {
  it("enforces the free daily task limit with HTTP 429", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("FREE_DAILY_TASKS", "1");
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: [] }) }]);
    const first = await POST(request());
    expect(first.status).toBe(200);
    const second = await POST(request());
    const body = await second.json();
    expect(second.status).toBe(429);
    expect(body.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("does not charge quota for a task that failed on configuration", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("FREE_DAILY_TASKS", "1");
    vi.stubEnv("JINA_API_KEY", "");
    vi.stubEnv("KEYLESS_SEARCH", "off");
    mockFetch([]);
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("KEYLESS_SEARCH", "");
    vi.stubEnv("JINA_API_KEY", "jina_test_key");
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: [] }) }]);
    expect((await POST(request())).status).toBe(200);
  });

  it("clamps Deep depth and limits for the free plan", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: [] }) }]);
    const body = await (await POST(request({ depth: "Deep", maxSources: 999, maxResults: 99 }))).json();
    expect(body.plan.id).toBe("free");
    expect(body.plan.limits.depths).not.toContain("Deep");
  });

  it("grants Pro with a valid access key", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("PRO_ACCESS_KEYS", "pro-key-1234567890");
    mockFetch([{ match: (u) => u.startsWith("https://s.jina.ai/"), respond: () => json({ code: 200, data: [] }) }]);
    const body = await (await POST(postJson("http://localhost/api/research/task", { query: QUERY }, { "x-aurelius-plan-key": "pro-key-1234567890" }))).json();
    expect(body.plan.id).toBe("pro");
  });
});
