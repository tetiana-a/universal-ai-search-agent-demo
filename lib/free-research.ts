import { BACKGROUND_RESEARCH_SCHEMA, type BackgroundResearchRequest, normalizeCompletedResearch } from "@/lib/background-research";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU, taskSpecificRules } from "@/lib/research-prompts";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { buildAccessEscalationPlan } from "@/lib/access-escalation";
import { filterResearchResults } from "@/lib/relevance-gate";
import { configuredFallbackProviders, searchFallbackProviders } from "@/lib/provider-search";
import { ResearchError, type ProviderDiagnostic } from "@/lib/research-errors";
import { isSafePublicUrl } from "@/lib/url-safety";
import { normalizeResultUrl } from "@/lib/result-quality";

export type FreeSearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  content?: string;
  provider: string;
  retrievedAt: string;
  readStatus?: ReadStatus;
};

type ReadStatus = "checked" | "unavailable" | "blocked" | "rate_limited" | "skipped";

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function jinaKey() {
  return process.env.FREE_MODE_USE_JINA_KEY === "false" ? "" : String(process.env.JINA_API_KEY || "").trim();
}

function extractSearchRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  if (payload && typeof payload === "object" && (payload.url || payload.link)) return [payload];
  return [];
}

export function describeJinaFailure(status: number) {
  if (status === 401 || status === 403) return "Jina rejected the API key (HTTP " + status + "). Check JINA_API_KEY in Vercel.";
  if (status === 402) return "Jina account has no remaining balance (HTTP 402). Top up the Jina key or configure a fallback search provider.";
  if (status === 429) return "Jina rate limit reached (HTTP 429). Retry later or configure a fallback search provider.";
  if (status >= 500) return "Jina Search is temporarily unavailable (HTTP " + status + ").";
  return "Jina Search request failed (HTTP " + status + ").";
}

type SearchOutcome = { hits: FreeSearchHit[]; ok: boolean; httpStatus?: number; message?: string };

async function jinaSearch(query: string, key: string): Promise<SearchOutcome> {
  try {
    const response = await fetch("https://s.jina.ai/?q=" + encodeURIComponent(query), {
      headers: { Accept: "application/json", Authorization: "Bearer " + key, "X-Respond-With": "no-content" },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!response.ok) return { hits: [], ok: false, httpStatus: response.status, message: describeJinaFailure(response.status) };
    const payload = await response.json().catch(() => null);
    if (payload === null) return { hits: [], ok: false, httpStatus: response.status, message: "Jina Search returned a non-JSON response." };
    const hits = extractSearchRows(payload)
      .map((row: any) => {
        const itemUrl = normalizeResultUrl(row?.url || row?.link);
        return {
          title: String(row?.title || row?.name || itemUrl),
          url: itemUrl,
          snippet: String(row?.description || row?.snippet || row?.content || "").slice(0, 1400),
          domain: host(itemUrl),
          provider: "jina",
          retrievedAt: new Date().toISOString(),
        };
      })
      .filter((row: FreeSearchHit) => isSafePublicUrl(row.url) && row.domain);
    return { hits, ok: true };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { hits: [], ok: false, message: timeout ? "Jina Search timed out." : "Jina Search request failed: " + (error instanceof Error ? error.message : "network error") };
  }
}

// Short-lived per-instance cache so a warm function does not re-read the same page.
const READ_CACHE = new Map<string, { at: number; content: string; status: ReadStatus }>();
const READ_TTL_MS = 10 * 60 * 1000;

export function clearReaderCache() { READ_CACHE.clear(); }

async function jinaRead(url: string): Promise<{ content: string; status: ReadStatus; httpStatus?: number }> {
  if (!isSafePublicUrl(url)) return { content: "", status: "blocked" };
  const cached = READ_CACHE.get(url);
  if (cached && Date.now() - cached.at < READ_TTL_MS) return { content: cached.content, status: cached.status };

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = jinaKey();
  if (key) headers.Authorization = "Bearer " + key;

  let result: { content: string; status: ReadStatus; httpStatus?: number };
  try {
    const response = await fetch("https://r.jina.ai/" + url, { headers, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) {
      const status: ReadStatus = response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 || response.status === 451 ? "blocked" : "unavailable";
      result = { content: "", status, httpStatus: response.status };
    } else {
      const contentType = response.headers.get("content-type") || "";
      let content = "";
      if (contentType.includes("application/json")) {
        const payload = await response.json().catch(() => null);
        const item = payload?.data || payload;
        content = String(item?.content || item?.text || item?.description || "");
      } else {
        content = await response.text();
      }
      content = content.slice(0, 8000);
      result = { content, status: content.trim() ? "checked" : "unavailable", httpStatus: response.status };
    }
  } catch {
    result = { content: "", status: "unavailable" };
  }
  READ_CACHE.set(url, { at: Date.now(), content: result.content, status: result.status });
  if (READ_CACHE.size > 300) READ_CACHE.delete(READ_CACHE.keys().next().value as string);
  return result;
}

function buildBranches(query: string, language: "ru" | "en", testMode = false, sourceMemory: BackgroundResearchRequest["sourceMemory"] = []) {
  const matrix = buildSearchMatrix(query, language);
  const branches = matrix
    .sort((a, b) => b.priority - a.priority)
    .flatMap((branch) => Array.isArray(branch.queries) ? branch.queries : [])
    .filter(Boolean);
  const memoryBranches = sourceMemory
    .slice(0, 12)
    .flatMap((source) => {
      const domain = String(source?.domain || "").trim();
      return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? [`site:${domain} ${query}`] : [];
    });
  const limit = testMode ? 3 : 6;
  // Keep one learned-source branch in the budget so memory is actually reused.
  const core = [...new Set([query, ...branches])].slice(0, memoryBranches.length ? limit - 1 : limit);
  return [...new Set([...core, ...memoryBranches.slice(0, 1)])].slice(0, limit);
}

function extractJsonText(response: any) {
  const message = response?.choices?.[0]?.message;
  if (typeof message?.content === "string") return message.content.trim();
  if (Array.isArray(message?.content)) return message.content.map((part: any) => String(part?.text || "")).join("").trim();
  return "";
}

function cleanJsonText(text: string) {
  const trimmed = text.trim().replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try { return JSON.parse(trimmed); } catch {}
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new Error("Free AI returned invalid structured output.");
}

function firstSentences(text: string, limit = 320) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut).trim();
}

// Candidates preserved for Manual Review when AI extraction is unavailable or returns nothing.
export function fallbackResults(hits: FreeSearchHit[], input: BackgroundResearchRequest) {
  return hits.slice(0, input.maxResults).map((hit) => {
    const quote = firstSentences(hit.snippet || String(hit.content || ""));
    return {
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
      match: 50,
      confidence: 40,
      evidence: quote || "Discovered by live web search; page evidence was not extracted.",
      evidence_quote: quote,
      status: "Manual review",
      source: hit.domain,
      source_type: hit.provider + "_search_candidate",
      url: hit.url,
      why: "Live search candidate. AI extraction did not confirm it, so it needs manual review.",
      retrieved_at: hit.retrievedAt,
      freshness_days: 0,
      independent_verification: false,
    };
  });
}

type ProviderRun = { hits: FreeSearchHit[]; diagnostics: ProviderDiagnostic[] };

async function discoverCandidates(queries: string[], language: "ru" | "en"): Promise<ProviderRun> {
  const diagnostics: ProviderDiagnostic[] = [];
  const hits: FreeSearchHit[] = [];
  const key = jinaKey();
  const fallbacks = configuredFallbackProviders();

  if (key) {
    const outcomes = await Promise.all(queries.map((q) => jinaSearch(q, key)));
    const ok = outcomes.filter((o) => o.ok);
    for (const outcome of ok) hits.push(...outcome.hits);
    const failed = outcomes.find((o) => !o.ok);
    diagnostics.push({
      provider: "jina",
      status: ok.length === 0 ? "error" : hits.length ? "ok" : "empty",
      httpStatus: ok.length === 0 ? failed?.httpStatus : undefined,
      hits: hits.length,
      message: ok.length === 0 ? failed?.message : failed ? "Some branches failed: " + failed.message : undefined,
    });
  } else {
    diagnostics.push({ provider: "jina", status: "not_configured", message: "JINA_API_KEY is not set." });
  }

  const supplemental = process.env.SUPPLEMENTAL_SEARCH_ENABLED === "true";
  if (fallbacks.length && (supplemental || hits.length < 5)) {
    const fallbackQueries = queries.slice(0, Math.min(queries.length, Number(process.env.SUPPLEMENTAL_SEARCH_MAX_QUERIES || 3)));
    const batches = await Promise.all(fallbackQueries.map((q) => searchFallbackProviders(q, language)));
    const fallbackHits = batches.flat();
    for (const provider of fallbacks) {
      const count = fallbackHits.filter((h) => h.provider === provider).length;
      diagnostics.push({ provider, status: count ? "ok" : "empty", hits: count, message: count ? undefined : "No hits (provider error or no results)." });
    }
    for (const hit of fallbackHits) {
      const url = normalizeResultUrl(hit.url);
      if (!isSafePublicUrl(url)) continue;
      hits.push({ title: hit.title || hit.domain || url, url, snippet: String(hit.snippet || "").slice(0, 1400), domain: host(url), provider: hit.provider, retrievedAt: new Date().toISOString() });
    }
  }

  const seen = new Set<string>();
  const unique = hits.filter((hit) => {
    const k = hit.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { hits: unique, diagnostics };
}

function assertSearchConfigured(language: "ru" | "en") {
  if (jinaKey() || configuredFallbackProviders().length) return;
  throw new ResearchError(
    "JINA_API_KEY_MISSING",
    language === "ru"
      ? "Поиск не настроен: не задан JINA_API_KEY и нет ни одного запасного поискового провайдера (Brave, Tavily, Exa, Serper…). Добавьте JINA_API_KEY в Vercel → Settings → Environment Variables и сделайте Redeploy."
      : "Search is not configured: JINA_API_KEY is missing and no fallback search provider (Brave, Tavily, Exa, Serper…) is configured. Add JINA_API_KEY in Vercel → Settings → Environment Variables and redeploy.",
    503,
    { providers: [{ provider: "jina", status: "not_configured" }] },
  );
}

// NOSONAR - the free pipeline is a linear sequence of bounded stages; splitting it further hides the data flow.
export async function runFreeResearch(input: BackgroundResearchRequest) {
  const deadlineAt = input.deadlineAt ?? Date.now() + 55_000;
  assertSearchConfigured(input.language);

  const queries = buildBranches(input.query, input.language, input.testMode === true, input.sourceMemory);
  const discovery = await discoverCandidates(queries, input.language);
  const allHits = discovery.hits;
  const providerDiagnostics = discovery.diagnostics;

  if (!allHits.length && providerDiagnostics.every((d) => d.status === "error" || d.status === "not_configured")) {
    const reason = providerDiagnostics.filter((d) => d.message).map((d) => d.provider + ": " + d.message).join(" ");
    throw new ResearchError(
      "SEARCH_PROVIDERS_FAILED",
      (input.language === "ru" ? "Все поисковые провайдеры вернули ошибку, исследование не выполнено. " : "Every search provider failed, research was not performed. ") + reason,
      502,
      { providers: providerDiagnostics },
    );
  }

  let candidateHits = allHits.slice(0, Math.min(input.maxSources, input.testMode ? 8 : 16));
  let usedMemoryFallback = false;

  // Providers answered but found nothing: try previously learned public sources before reporting zero.
  if (!candidateHits.length && Array.isArray(input.sourceMemory)) {
    const memory = input.sourceMemory
      .filter((source) => isSafePublicUrl(source?.url))
      .slice(0, input.testMode ? 3 : 6);
    const memoryHits = await Promise.all(memory.map(async (source) => {
      const url = normalizeResultUrl(source.url);
      const read = await jinaRead(url);
      return read.content
        ? { title: String(source?.name || source?.domain || url), url, snippet: read.content.slice(0, 1400), domain: host(url), content: read.content, provider: "source_memory", retrievedAt: new Date().toISOString(), readStatus: read.status }
        : null;
    }));
    candidateHits = memoryHits.filter(Boolean) as FreeSearchHit[];
    usedMemoryFallback = candidateHits.length > 0;
  }

  const readerLimit = Math.min(candidateHits.length, input.testMode ? 3 : 8);
  await Promise.all(candidateHits.slice(0, readerLimit).map(async (hit) => {
    if (hit.content) return;
    const read = await jinaRead(hit.url);
    hit.content = read.content;
    hit.readStatus = read.status;
  }));
  for (const hit of candidateHits.slice(readerLimit)) hit.readStatus = hit.readStatus || "skipped";

  const researchedHits = candidateHits.filter((hit) => Boolean(hit.content));
  const sourceRegistry = candidateHits.map((hit) => {
    const status = hit.readStatus === "checked" || hit.content ? "checked" : hit.readStatus === "blocked" ? "blocked" : hit.readStatus === "rate_limited" ? "rate_limited" : hit.readStatus === "unavailable" ? "unavailable" : "partial";
    const reason = status === "checked"
      ? "Public page content retrieved."
      : status === "partial"
        ? "Discovered by search; page not read within the request budget."
        : "Page could not be read automatically (" + status + "); search snippet only.";
    const plan = buildAccessEscalationPlan({ url: hit.url, status, reason, rateLimited: status === "rate_limited" });
    return {
      name: hit.title || hit.domain,
      url: hit.url,
      domain: hit.domain,
      category: "web_search:" + hit.provider,
      access_status: plan.status,
      access_method: hit.content ? "jina_reader" : hit.provider + "_search",
      reason: plan.reason,
      evidence_available: Boolean(hit.content),
      quality: hit.content ? 80 : 50,
      last_checked: hit.retrievedAt,
    };
  });

  const accessEvents = candidateHits
    .filter((hit) => hit.readStatus && hit.readStatus !== "checked" && hit.readStatus !== "skipped")
    .map((hit) => ({ url: hit.url, status: hit.readStatus as string, method: "jina_reader", reason: "Reader could not retrieve the page.", fallback: "search_snippet_manual_review" }));

  const evidencePack = researchedHits.map((hit, index) => ({
    id: index + 1,
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet,
    content: String(hit.content || "").slice(0, 6000),
  }));
  // Snippet-only candidates are listed so the model may cite them, but only with Manual review status.
  const snippetPack = candidateHits.filter((hit) => !hit.content).slice(0, 10).map((hit) => ({ title: hit.title, url: hit.url, domain: hit.domain, snippet: hit.snippet }));

  const basePrompt = input.language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN;
  const system = basePrompt + taskSpecificRules(input.query, input.language);
  const user = [
    "USER QUERY:", input.query, "",
    "MODE: " + input.depth,
    "LIMITS: results=" + input.maxResults + ", sources=" + candidateHits.length, "",
    "LIVE SEARCH BRANCHES:", ...queries.map((q) => "- " + q), "",
    "LIVE EVIDENCE (full page text; quotes must be copied verbatim from here):", JSON.stringify(evidencePack), "",
    "SEARCH SNIPPETS (page not read; Manual review only):", JSON.stringify(snippetPack), "",
    "Return ONLY one JSON object matching the supplied schema. Do not add markdown fences.",
  ].join("\n");

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const freeModel = process.env.OPENROUTER_MODEL || "openrouter/free";
  const remaining = deadlineAt - Date.now() - 2500;
  const aiTimeoutMs = Math.min(Number(process.env.FREE_AI_TIMEOUT_MS || (input.testMode ? 18000 : 30000)), remaining);

  let raw: any = null;
  let aiError = "";
  if (!candidateHits.length) {
    aiError = "";
  } else if (!openRouterKey) {
    aiError = "OPENROUTER_API_KEY is not configured; candidates are shown for manual review.";
  } else if (aiTimeoutMs < 5000) {
    aiError = "Not enough time left for AI extraction; candidates are shown for manual review.";
  } else {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + openRouterKey,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://universal-ai-search-agent-demo.vercel.app",
          "X-OpenRouter-Title": "Aurelius Universal AI Research Engine",
        },
        body: JSON.stringify({
          model: freeModel,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0.1,
          max_tokens: input.testMode ? 3000 : 4500,
          response_format: { type: "json_schema", json_schema: { name: "aurelius_research", strict: true, schema: BACKGROUND_RESEARCH_SCHEMA } },
        }),
        signal: AbortSignal.timeout(aiTimeoutMs),
      });
      raw = await response.json().catch(() => null);
      if (!response.ok) aiError = "OpenRouter HTTP " + response.status + ": " + String(raw?.error?.message || "request failed");
    } catch (error) {
      aiError = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
        ? "AI extraction timed out after " + Math.round(aiTimeoutMs / 1000) + "s; candidates are shown for manual review."
        : "OpenRouter request failed: " + (error instanceof Error ? error.message : "network error");
    }
  }

  let parsed: any = null;
  if (raw && !aiError) {
    try { parsed = cleanJsonText(extractJsonText(raw)); } catch { aiError = "Free AI returned invalid structured output; candidates are shown for manual review."; }
  }

  const allowedUrls = new Map(candidateHits.map((hit) => [hit.url, hit]));
  const groundedResults = Array.isArray(parsed?.results)
    ? parsed.results
        .filter((item: any) => allowedUrls.has(normalizeResultUrl(item?.url)))
        .map((item: any) => {
          const hit = allowedUrls.get(normalizeResultUrl(item?.url))!;
          return {
            ...item,
            url: hit.url,
            source: item?.source || hit.domain,
            source_type: item?.source_type || (hit.content ? "jina_reader" : hit.provider + "_search"),
            evidence: item?.evidence || hit.snippet,
            evidence_quote: item?.evidence_quote || "",
            // A result whose page was never read cannot be more than Manual review.
            status: hit.content ? item?.status : "Manual review",
            retrieved_at: item?.retrieved_at || hit.retrievedAt,
          };
        })
    : [];
  const hallucinatedUrls = Array.isArray(parsed?.results) ? parsed.results.length - groundedResults.length : 0;

  const relevance = filterResearchResults(groundedResults, input.query, { geography: parsed?.query_understanding?.geography });
  let results = relevance.kept;
  let rejected = relevance.rejected;
  let usedCandidateFallback = false;
  if (!results.length && candidateHits.length) {
    const fallback = filterResearchResults(fallbackResults(researchedHits.length ? [...researchedHits, ...candidateHits.filter((h) => !h.content)] : candidateHits, { ...input, maxResults: input.maxResults * 2 }), input.query);
    results = fallback.kept;
    rejected = [...rejected, ...fallback.rejected];
    usedCandidateFallback = results.length > 0;
  }
  results = results.slice(0, input.maxResults);

  const outcome = results.length
    ? (usedCandidateFallback ? "candidates_for_review" : "results")
    : candidateHits.length ? "all_candidates_rejected" : "no_candidates";

  const summaryParts = [
    parsed?.search_summary ? String(parsed.search_summary) : "",
    aiError ? "AI: " + aiError : "",
    usedMemoryFallback ? "Search returned nothing; learned sources from memory were re-read." : "",
    usedCandidateFallback ? "Results are live search candidates kept for Manual review." : "",
    hallucinatedUrls > 0 ? hallucinatedUrls + " AI result(s) dropped because their URL was not among retrieved sources." : "",
    outcome === "no_candidates" ? (input.language === "ru" ? "Поисковые провайдеры ответили, но не нашли ни одной страницы по запросу. Попробуйте переформулировать запрос или расширить географию." : "Search providers responded but found no pages for this query. Try rephrasing or widening the geography.") : "",
    outcome === "all_candidates_rejected" ? (input.language === "ru" ? `Найдено ${candidateHits.length} кандидатов, но все отклонены фильтром релевантности (мероприятия, вакансии, новости и т.п.). Список отклонённых — в rejectedCandidates.` : `${candidateHits.length} candidates were found but all were rejected as noise (events, jobs, news…). See rejectedCandidates.`) : "",
  ].filter(Boolean);

  const finalParsed = {
    query_understanding: parsed?.query_understanding || { intent: "research", entity_type: "unknown", geography: [], languages: [input.language], criteria: [], exclusions: [], required_fields: [], source_classes: ["web"] },
    search_plan: String(parsed?.search_plan || "Live web search (" + providerDiagnostics.filter((d) => d.status === "ok").map((d) => d.provider).join(", ") + ") + Jina Reader + free AI extraction."),
    search_branches: queries,
    search_summary: summaryParts.join(" "),
    candidates_seen: allHits.length,
    duplicates_removed: 0,
    access_events: [...accessEvents, ...(Array.isArray(parsed?.access_events) ? parsed.access_events.slice(0, 20) : [])],
    source_registry: sourceRegistry,
    results,
  };

  const sourceText = new Map<string, string>();
  for (const hit of candidateHits) sourceText.set(hit.url, [hit.snippet, hit.content].filter(Boolean).join("\n"));

  const normalized: any = normalizeCompletedResearch(
    { id: "free_" + Date.now().toString(36), status: "completed", output_text: JSON.stringify(finalParsed), output: [], usage: raw?.usage || null },
    input,
    { sourceText, rejected, preFiltered: true },
  );
  normalized.billing = { provider: "openrouter", model: freeModel, billable: false, webSearchCalls: queries.length, usage: raw?.usage || null, background: false };
  normalized.task = { id: taskIdFrom(normalized.query), responseId: "free_" + Date.now().toString(36), providerStatus: "completed" };
  normalized.live = true;
  normalized.partial = false;
  normalized.degraded = Boolean(aiError) || usedCandidateFallback || usedMemoryFallback;
  normalized.outcome = outcome;
  normalized.providers = providerDiagnostics;
  normalized.aiStatus = aiError ? { ok: false, message: aiError } : { ok: Boolean(parsed), message: parsed ? "ok" : "skipped" };
  normalized.stats.candidatesFound = allHits.length;
  return normalized;
}

function taskIdFrom(query: string) {
  return "FREE-" + Buffer.from(query).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(-10).toUpperCase();
}
