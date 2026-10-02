import { BACKGROUND_RESEARCH_SCHEMA, type BackgroundResearchRequest, normalizeCompletedResearch } from "@/lib/background-research";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { buildAccessEscalationPlan } from "@/lib/access-escalation";

export type FreeSearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  content?: string;
  retrievedAt: string;
};

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

const useJinaKey = Boolean(process.env.JINA_API_KEY) && process.env.FREE_MODE_USE_JINA_KEY !== "false";

function normalizeUrl(url: unknown) {
  const raw = String(url ?? "").trim();
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/$/, "");
  }
}

function extractSearchRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload && typeof payload === "object") {
    // Some Jina responses expose a single result object.
    if (payload.url || payload.link) return [payload];
  }
  return [];
}

async function jinaSearch(query: string): Promise<FreeSearchHit[]> {
  // Jina Search uses the ?q= form for the SERP endpoint.
  const url = "https://s.jina.ai/?q=" + encodeURIComponent(query);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (useJinaKey && process.env.JINA_API_KEY) {
    headers.Authorization = "Bearer " + process.env.JINA_API_KEY;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];

  let payload: any = null;
  try { payload = await response.json(); } catch { return []; }

  return extractSearchRows(payload)
    .map((row: any) => {
      const itemUrl = normalizeUrl(row?.url || row?.link);
      return {
        title: String(row?.title || row?.name || itemUrl),
        url: itemUrl,
        snippet: String(row?.content || row?.description || row?.snippet || "").slice(0, 1400),
        domain: host(itemUrl),
        retrievedAt: new Date().toISOString(),
      };
    })
    .filter((row: FreeSearchHit) => /^https?:\/\//i.test(row.url) && row.domain);
}

async function jinaRead(url: string): Promise<string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.JINA_API_KEY) headers.Authorization = "Bearer " + process.env.JINA_API_KEY;

  const response = await fetch("https://r.jina.ai/" + url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return "";

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const item = payload?.data || payload;
    return String(item?.content || item?.text || item?.description || "").slice(0, 8000);
  }
  return (await response.text()).slice(0, 8000);
}

function buildBranches(
  query: string,
  language: "ru" | "en",
  testMode = false,
  sourceMemory: BackgroundResearchRequest["sourceMemory"] = [],
) {
  const matrix = buildSearchMatrix(query, language);
  const branches = matrix
    .sort((a, b) => b.priority - a.priority)
    .flatMap((branch) => Array.isArray(branch.queries) ? branch.queries : [])
    .filter(Boolean);

  const memoryBranches = sourceMemory
    .slice(0, 12)
    .flatMap((source) => {
      const domain = String(source?.domain || "").trim();
      return domain ? [`site:${domain} ${query}`] : [];
    });

  const limit = testMode ? 3 : 4;
  return [...new Set([query, ...memoryBranches, ...branches])].slice(0, limit);
}

function extractJsonText(response: any) {
  const message = response?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) {
    return message.content.map((part: any) => String(part?.text || "")).join("").trim();
  }
  return "";
}

function cleanJsonText(text: string) {
  const trimmed = text.trim().replace(/^\s*\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`\s*$/i, "");
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("Free AI returned invalid structured output.");
}

function fallbackResults(hits: FreeSearchHit[], input: BackgroundResearchRequest) {
  return hits.slice(0, input.maxResults).map((hit, index) => ({
    title: hit.title || hit.domain,
    organization: "",
    specialization: "",
    geography: "",
    contact: "",
    investment_type: "",
    stage: "",
    ticket: "",
    location: "",
    area: "",
    price: "",
    match: 60,
    confidence: 55,
    evidence: hit.snippet || "Live search candidate returned by Jina Search.",
    evidence_quote: hit.snippet || hit.title,
    status: "Manual review",
    source: hit.domain,
    source_type: "jina_search",
    url: hit.url,
    why: "Candidate discovered from live web search. Manual verification is required.",
    retrieved_at: hit.retrievedAt,
    freshness_days: 0,
    independent_verification: false,
  }));
}

export async function runFreeResearch(input: BackgroundResearchRequest) {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const queries = buildBranches(input.query, input.language, input.testMode === true, input.sourceMemory);
  const batches = await Promise.allSettled(queries.map((query) => jinaSearch(query)));
  const allHits: FreeSearchHit[] = [];
  const seen = new Set<string>();

  for (const batch of batches) {
    if (batch.status !== "fulfilled") continue;
    for (const hit of batch.value) {
      if (!seen.has(hit.url)) {
        seen.add(hit.url);
        allHits.push(hit);
      }
    }
  }

  let candidateHits = allHits.slice(0, Math.min(input.maxSources, input.testMode ? 8 : 16));

  // If the live search endpoint is unavailable or rate-limited, reuse previously
  // learned public source URLs instead of returning an unexplained empty result.
  if (!candidateHits.length && Array.isArray(input.sourceMemory)) {
    const memoryHits = await Promise.all(
      input.sourceMemory
        .slice(0, input.testMode ? 3 : 8)
        .filter((source) => /^https?:\\/\\//i.test(String(source?.url || "")))
        .map(async (source) => {
          const url = normalizeUrl(String(source.url));
          const content = await jinaRead(url);
          return content
            ? {
                title: String(source?.name || source?.domain || url),
                url,
                snippet: content.slice(0, 1400),
                domain: host(url),
                content,
                retrievedAt: new Date().toISOString(),
              }
            : null;
        }),
    );
    candidateHits = memoryHits.filter(Boolean) as FreeSearchHit[];
  }

  const readerLimit = Math.min(candidateHits.length, input.testMode ? 3 : 5);

  const readResults = await Promise.allSettled(
    candidateHits.slice(0, readerLimit).map(async (hit) => ({ hit, content: hit.content || await jinaRead(hit.url) })),
  );

  for (const result of readResults) {
    if (result.status === "fulfilled") result.value.hit.content = result.value.content;
  }

  const researchedHits = candidateHits.filter((hit) => Boolean(hit.content));
  const sourceRegistry = candidateHits.map((hit) => {
    const status = hit.content ? "checked" : "partial";
    const plan = buildAccessEscalationPlan({ url: hit.url, status, reason: hit.content ? "Public content retrieved." : "Search result discovered but page content was not retrieved." });
    return {
      name: hit.title || hit.domain,
      url: hit.url,
      domain: hit.domain,
      category: "web_search",
      access_status: plan.status,
      access_method: "jina_search_or_reader",
      reason: plan.reason,
      evidence_available: Boolean(hit.content || hit.snippet),
      quality: hit.content ? 80 : 55,
      last_checked: hit.retrievedAt,
    };
  });

  const evidencePack = researchedHits.map((hit, index) => ({
    id: index + 1,
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    content: String(hit.content || "").slice(0, 6000),
  }));

  const basePrompt = input.language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN;
  const system = basePrompt + "\n\nFREE-MODE RULES: Use only the supplied live web evidence. Do not invent URLs, organizations, people, figures, contact details or facts. Every result URL must exactly match one of the supplied evidence URLs. Prefer official pages, company pages, registries and primary sources when available. Return a result only when the supplied evidence supports it. If evidence is insufficient, use Manual review. Keep the response concise.";
  const user = [
    "USER QUERY:",
    input.query,
    "",
    "MODE: " + input.depth,
    "LIMITS: results=" + input.maxResults + ", sources=" + candidateHits.length,
    "",
    "LEARNED SOURCE MEMORY:",
    JSON.stringify(input.sourceMemory || []),
    "",
    "LIVE SEARCH BRANCHES:",
    ...queries.map((q) => "- " + q),
    "",
    "LIVE EVIDENCE:",
    JSON.stringify(evidencePack),
    "",
    "SOURCE REGISTRY:",
    JSON.stringify(sourceRegistry),
    "",
    "Return ONLY one JSON object matching the supplied schema. Do not add markdown fences.",
  ].join("\n");

  const freeModel = process.env.OPENROUTER_MODEL || "openrouter/free";
  const aiTimeoutMs = Number(
    process.env.FREE_AI_TIMEOUT_MS || (input.testMode ? 18000 : 24000),
  );

  let raw: any = null;
  let aiError = "";
  if (openRouterKey) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + openRouterKey,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.NEXT_PUBLIC_SITE_URL ||
            "https://universal-ai-search-agent-demo.vercel.app",
          "X-OpenRouter-Title": "Aurelius Universal AI Research Engine",
        },
        body: JSON.stringify({
          model: freeModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.1,
          max_tokens: input.testMode ? 3000 : 4500,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "aurelius_research",
              strict: true,
              schema: BACKGROUND_RESEARCH_SCHEMA,
            },
          },
        }),
        signal: AbortSignal.timeout(aiTimeoutMs),
      });

      raw = await response.json().catch(() => null);
      if (!response.ok) {
        aiError = String(
          raw?.error?.message || "OpenRouter free-model request failed.",
        );
      }
    } catch (error) {
      aiError =
        error instanceof Error ? error.message : "OpenRouter request failed.";
    }
  } else {
    aiError = "OPENROUTER_API_KEY is not configured; using live-search fallback.";
  }

  let parsed: any = null;
  if (raw && !aiError) {
    try {
      parsed = cleanJsonText(extractJsonText(raw));
    } catch {
      parsed = null;
      aiError = "Free AI returned invalid structured output.";
    }
  }

  if (!parsed) {
    parsed = {
      query_understanding: {
        intent: "research",
        entity_type: "unknown",
        geography: [],
        languages: [input.language],
        criteria: [],
        exclusions: [],
        required_fields: [],
        source_classes: ["web"],
      },
      search_plan:
        "Live public web search via Jina Search + Jina Reader; free AI enrichment when available.",
      search_branches: queries,
      search_summary: aiError
        ? `Live search completed. Free AI enrichment unavailable: ${aiError}`
        : "Live search completed; candidates are preserved for manual review.",
      candidates_seen: allHits.length,
      duplicates_removed: Math.max(0, allHits.length - candidateHits.length),
      access_events: [],
      source_registry: sourceRegistry,
      results: fallbackResults(
        researchedHits.length ? researchedHits : candidateHits,
        input,
      ),
    };
  }

  const allowedUrls = new Map(candidateHits.map((hit) => [hit.url, hit]));
  const safeResults = Array.isArray(parsed?.results)
    ? parsed.results
        .filter((item: any) => allowedUrls.has(normalizeUrl(item?.url)))
        .map((item: any) => {
          const hit = allowedUrls.get(normalizeUrl(item?.url))!;
          return {
            ...item,
            url: hit.url,
            source: item?.source || hit.domain,
            source_type: item?.source_type || "jina_reader",
            evidence: item?.evidence || hit.snippet,
            evidence_quote: item?.evidence_quote || hit.snippet,
            retrieved_at: item?.retrieved_at || hit.retrievedAt,
          };
        })
        .slice(0, input.maxResults)
    : [];

  const finalParsed = {
    query_understanding: parsed?.query_understanding || { intent: "research", entity_type: "unknown", geography: [], languages: [input.language], criteria: [], exclusions: [], required_fields: [], source_classes: ["web"] },
    search_plan: String(parsed?.search_plan || "Live web search with free AI extraction."),
    search_branches: Array.isArray(parsed?.search_branches) ? parsed.search_branches.map(String).slice(0, 20) : queries,
    search_summary: String(parsed?.search_summary || "Free AI research grounded in live web evidence."),
    candidates_seen: Number(parsed?.candidates_seen || allHits.length),
    duplicates_removed: Number(parsed?.duplicates_removed || Math.max(0, allHits.length - candidateHits.length)),
    access_events: Array.isArray(parsed?.access_events) ? parsed.access_events.slice(0, 30) : [],
    source_registry: sourceRegistry,
    results: safeResults.length ? safeResults : fallbackResults(researchedHits.length ? researchedHits : candidateHits, input),
  };

  const synthetic = {
    id: "free_" + Date.now().toString(36),
    status: "completed",
    output_text: JSON.stringify(finalParsed),
    output: [],
    usage: raw?.usage || null,
  };

  const normalized = normalizeCompletedResearch(synthetic, input);
  normalized.billing = {
    provider: "openrouter",
    model: freeModel,
    billable: false,
    webSearchCalls: queries.length,
    usage: raw?.usage || null,
    background: false,
  };
  normalized.task = {
    id: taskIdFrom(normalized.query),
    responseId: synthetic.id,
    providerStatus: "completed",
  };
  normalized.live = true;
  normalized.partial = false;
  return normalized;
}

function taskIdFrom(query: string) {
  return "FREE-" + Buffer.from(query).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(-10).toUpperCase();
}
