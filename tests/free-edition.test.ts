import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/research/task/route";
import { POST as CLARIFY } from "@/app/api/research/clarify/route";
import { GET as MODE } from "@/app/api/research/mode/route";
import { clearReaderCache } from "@/lib/free-research";
import { resetLocalQuotaCounters } from "@/lib/plans";
import { parseDuckDuckGoHtml, parseDuckDuckGoLite, unwrapDuckDuckGoUrl } from "@/lib/keyless-search";
import { parseRobots, robotsAllows, htmlToText } from "@/lib/direct-reader";
import { applyClarifications, clarifyingQuestions, heuristicFields } from "@/lib/task-profile";
import { VC_PAGE, aiResult, json, mockFetch, openRouterReply, postJson, researchPayload } from "./helpers";

const LAND_PAGE = "Terreno urbanizable en venta en Madrid. Parcela de 12.500 m² en Valdebebas. Precio: 3.200.000 €. Contacto: info@fincas-madrid.es, +34 910 000 000.";
const DDG_HTML = `
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ffincas-madrid.es%2Fterreno-valdebebas&amp;rut=abc">Terreno <b>urbanizable</b> Valdebebas</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Parcela de 12.500 m² en Madrid &amp; alrededores</a>
</div>
<div class="result result--ad results_links">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=bing">Ad</a></h2>
</div>
<div class="result results_links web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsubastas.example.es%2Flote%2F77">Subasta de suelo en Madrid</a></h2>
  <a class="result__snippet" href="#">Lote 77: suelo rústico 15.000 m²</a>
</div>`;

const QUERY = "Найди земельные участки в Мадриде площадью от 10 000 м²";
const request = (body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  postJson("http://localhost/api/research/task", { query: QUERY, language: "ru", ...body }, headers);

function ddgOk(html = DDG_HTML) {
  return { match: (u: string) => u.startsWith("https://html.duckduckgo.com/"), respond: () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }) };
}
function keylessReader(pages: Record<string, string>) {
  return {
    match: (u: string) => u.startsWith("https://r.jina.ai/"),
    respond: (u: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)?.Authorization).toBeUndefined();
      const text = pages[u.slice("https://r.jina.ai/".length)];
      return text ? json({ data: { content: text } }) : new Response("nope", { status: 404 });
    },
  };
}

beforeEach(() => {
  clearReaderCache();
  resetLocalQuotaCounters();
  vi.stubEnv("PLAN_ENFORCEMENT", "on");
  vi.stubEnv("KEYLESS_SEARCH_PAUSE_MS", "0");
  vi.stubEnv("DIRECT_READ", "off");
  for (const key of ["RESEARCH_AI_PROVIDER", "JINA_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "SEARXNG_URL", "KEYLESS_SEARCH", "PRO_OPENROUTER_MODEL", "OPENAI_API_KEY", "PRO_ACCESS_KEYS", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "SERPER_API_KEY", "MOJEEK_API_KEY", "YANDEX_SEARCH_API_KEY", "NAVER_CLIENT_ID", "DATAFORSEO_LOGIN", "KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"]) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("keyless search parsing", () => {
  it("parses DuckDuckGo HTML results, unwraps redirect links and skips ads", () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML);
    expect(hits.map((h) => h.url)).toEqual(["https://fincas-madrid.es/terreno-valdebebas", "https://subastas.example.es/lote/77"]);
    expect(hits[0].title).toBe("Terreno urbanizable Valdebebas");
    expect(hits[0].snippet).toContain("12.500 m² en Madrid & alrededores");
  });

  it("parses the lite DuckDuckGo layout", () => {
    const html = `<a rel="nofollow" href="https://example.org/a" class='result-link'>Example A</a><td class='result-snippet'>Snippet A</td>`;
    expect(parseDuckDuckGoLite(html)).toEqual([{ title: "Example A", url: "https://example.org/a", snippet: "Snippet A", domain: "example.org", provider: "duckduckgo" }]);
  });

  it("drops ad and private links", () => {
    expect(unwrapDuckDuckGoUrl("https://duckduckgo.com/y.js?ad=1")).toBe("");
    expect(parseDuckDuckGoHtml(`<div class="result"><a class="result__a" href="http://127.0.0.1/admin">x</a></div>`)).toEqual([]);
  });
});

describe("direct reader", () => {
  it("honours robots.txt disallow rules for every crawler", () => {
    const rules = parseRobots("User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /private\nDisallow: /*.pdf$");
    expect(robotsAllows(rules, "/listings/1")).toBe(true);
    expect(robotsAllows(rules, "/private/area")).toBe(false);
    expect(robotsAllows(rules, "/doc.pdf")).toBe(false);
    expect(robotsAllows(rules, "/g/page")).toBe(true);
  });

  it("turns HTML into readable text without scripts", () => {
    const text = htmlToText("<html><head><title>Plot</title><script>var x=1</script></head><body><p>12 500 m&sup2;</p><p>3&nbsp;200&nbsp;000 &euro;</p></body></html>");
    expect(text).toContain("Plot");
    expect(text).not.toContain("var x");
  });
});

describe("task profile", () => {
  it("extracts listing fields that literally appear in the text", () => {
    expect(heuristicFields("real_estate", LAND_PAGE)).toMatchObject({ area: "12.500 m²", contact: expect.stringContaining("info@fincas-madrid.es") });
    expect(heuristicFields("real_estate", LAND_PAGE).price).toContain("3.200.000");
    expect(heuristicFields("investor", VC_PAGE).ticket).toContain("EUR 500k to EUR 3m");
  });

  it("asks only about criteria the query leaves open", () => {
    const land = clarifyingQuestions(QUERY);
    expect(land.kind).toBe("real_estate");
    expect(land.questions.map((q) => q.id)).not.toContain("geography");
    expect(land.questions.map((q) => q.id)).not.toContain("area");
    expect(land.questions.map((q) => q.id)).toContain("budget");
    const investors = clarifyingQuestions("Find investors for my startup");
    expect(investors.kind).toBe("investor");
    expect(investors.questions.map((q) => q.id)).toEqual(expect.arrayContaining(["geography", "sector", "stage"]));
    expect(applyClarifications("Find investors", { sector: "B2B SaaS", empty: " " }, "en")).toBe("Find investors\nDetails: B2B SaaS");
  });

  it("serves clarifying questions and result columns over HTTP", async () => {
    const response = await CLARIFY(postJson("http://localhost/api/research/clarify", { query: "Find investors in Amsterdam" }));
    const body = await response.json();
    expect(body.kind).toBe("investor");
    expect(body.fieldSchema.map((f: any) => f.key)).toEqual(expect.arrayContaining(["organization", "ticket", "contact", "url"]));
  });
});

describe("Free edition without any keys", () => {
  it("searches DuckDuckGo, reads pages through keyless Jina and extracts fields by rules", async () => {
    const calls = mockFetch([ddgOk(), keylessReader({ "https://fincas-madrid.es/terreno-valdebebas": LAND_PAGE })]);
    const response = await POST(request({ testMode: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.edition).toBe("free");
    expect(body.providers.find((p: any) => p.provider === "duckduckgo")).toMatchObject({ status: "ok" });
    expect(body.aiStatus.ok).toBe(false);
    expect(body.aiStatus.message).toContain("No AI key");
    const plot = body.results.find((r: any) => r.url === "https://fincas-madrid.es/terreno-valdebebas");
    expect(plot.status).toBe("Manual review");
    expect(plot.area).toBe("12.500 m²");
    expect(body.taskKind).toBe("real_estate");
    expect(body.fieldSchema.map((f: any) => f.key)).toEqual(expect.arrayContaining(["price", "area", "location"]));
    // 2 pages from search plus the Spanish source map (portals, banks, auctions, social).
    expect(body.progressCounters.sourcesChecked).toBe(1);
    expect(body.progressCounters.sourcesDiscovered).toBeGreaterThan(10);
    expect(body.progressCounters.sourcesUnavailable).toBeGreaterThan(0);
    const idealista = body.sourceRegistry.find((s: any) => s.domain === "idealista.com");
    expect(idealista).toMatchObject({ accessStatus: "partial", category: "Порталы недвижимости" });
    expect(body.sourceRegistry.find((s: any) => s.domain === "facebook.com").accessStatus).toBe("not_automatable");
    expect(body.progressCounters.resultsFound).toBeGreaterThan(0);
    expect(body.continuation.round).toBe(1);
    expect(body.continuation.seenUrls).toContain("https://fincas-madrid.es/terreno-valdebebas");
    expect(calls.every((c) => !c.url.includes("openrouter") && !c.url.includes("openai"))).toBe(true);
  });

  it("reports a DuckDuckGo human check as rate limited instead of bypassing it", async () => {
    mockFetch([
      { match: (u) => u.includes("duckduckgo.com"), respond: () => new Response('<div class="anomaly-modal">', { status: 202 }) },
    ]);
    const response = await POST(request({ testMode: true }));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe("SEARCH_PROVIDERS_FAILED");
    expect(body.diagnostics.providers.find((p: any) => p.provider === "duckduckgo").status).toBe("rate_limited");
  });

  it("falls back from OpenRouter to Gemini when the first free model fails", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "or_key");
    vi.stubEnv("GEMINI_API_KEY", "gm_key");
    mockFetch([
      ddgOk(),
      keylessReader({ "https://fincas-madrid.es/terreno-valdebebas": LAND_PAGE }),
      { match: (u) => u.includes("openrouter.ai"), respond: () => json({ error: { message: "free model busy" } }, 429) },
      {
        match: (u) => u.includes("generativelanguage.googleapis.com"),
        respond: () => openRouterReply(researchPayload([
          aiResult({ title: "Parcela Valdebebas 12.500 m²", location: "Madrid", area: "12.500 m²", price: "3.200.000 €", url: "https://fincas-madrid.es/terreno-valdebebas", source: "fincas-madrid.es", evidence: "Land plot", evidence_quote: "Parcela de 12.500 m² en Valdebebas." }),
        ])),
      },
    ]);
    const body = await (await POST(request({ testMode: true }))).json();
    expect(body.aiStatus).toMatchObject({ ok: true, provider: "gemini" });
    expect(body.aiStatus.attempts[0]).toMatchObject({ provider: "openrouter", ok: false });
    expect(body.results[0].price).toBe("3.200.000 €");
  });

  it("continues a task without re-reading pages from earlier rounds", async () => {
    const calls = mockFetch([ddgOk(), keylessReader({ "https://subastas.example.es/lote/77": "Subasta de suelo en Madrid. Lote 77: suelo rústico 15.000 m², precio de salida 900.000 €." })]);
    const body = await (await POST(request({ testMode: true, continuation: { round: 1, excludeUrls: ["https://fincas-madrid.es/terreno-valdebebas", "http://10.0.0.1/x"] } }))).json();
    expect(body.results.map((r: any) => r.url)).not.toContain("https://fincas-madrid.es/terreno-valdebebas");
    expect(calls.some((c) => c.url.includes("r.jina.ai/https://fincas-madrid.es"))).toBe(false);
    expect(body.continuation.round).toBe(2);
    expect(body.continuation.seenUrls).toEqual(expect.arrayContaining(["https://fincas-madrid.es/terreno-valdebebas", "https://subastas.example.es/lote/77"]));
  });
});

describe("Pro edition", () => {
  it("uses the stronger OpenRouter model and larger limits with a Pro key", async () => {
    vi.stubEnv("PRO_ACCESS_KEYS", "pro-key-1234567890");
    vi.stubEnv("OPENROUTER_API_KEY", "or_key");
    vi.stubEnv("PRO_OPENROUTER_MODEL", "anthropic/claude-sonnet");
    let model = "";
    mockFetch([
      ddgOk(),
      keylessReader({ "https://fincas-madrid.es/terreno-valdebebas": LAND_PAGE }),
      { match: (u) => u.includes("openrouter.ai"), respond: (_u, init) => { model = JSON.parse(String(init?.body)).model; return openRouterReply(researchPayload([])); } },
    ]);
    const body = await (await POST(request({}, { "x-aurelius-plan-key": "pro-key-1234567890" }))).json();
    expect(body.plan.id).toBe("pro");
    expect(body.edition).toBe("pro");
    expect(model).toBe("anthropic/claude-sonnet");
    expect(body.billing.billable).toBe(true);
  });

  it("describes both editions and their limitations", async () => {
    const body = await (await MODE(new Request("http://localhost/api/research/mode"))).json();
    expect(body.edition).toBe("free");
    expect(body.editions.free.pipeline).toBe("free");
    expect(body.editions.free.search).toContain("duckduckgo");
    expect(body.editions.free.limitations).toContain("no_ai_key_rule_based_extraction");
    expect(body.editions.pro.plan.limits.maxSources).toBeGreaterThan(body.editions.free.plan.limits.maxSources);
  });

  it("routes Pro to OpenAI deep research only when OPENAI_API_KEY is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("PRO_ACCESS_KEYS", "pro-key-1234567890");
    const free = await (await MODE(new Request("http://localhost/api/research/mode"))).json();
    expect(free.provider).toBe("free");
    const pro = await (await MODE(new Request("http://localhost/api/research/mode", { headers: { "x-aurelius-plan-key": "pro-key-1234567890" } }))).json();
    expect(pro.provider).toBe("paid");
    expect(pro.editions.pro.ai[0].provider).toBe("openai");
  });
});
