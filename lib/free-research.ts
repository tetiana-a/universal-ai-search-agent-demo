import { type BackgroundResearchRequest, normalizeCompletedResearch, progressCounters } from "@/lib/background-research";
import { buildSourceMap, classLabel, pickBranches, roughEnglish, type SourceMap } from "@/lib/source-map";
import { buildAccessEscalationPlan } from "@/lib/access-escalation";
import { filterResearchResults } from "@/lib/relevance-gate";
import { configuredFallbackProviders, searchFallbackProviders } from "@/lib/provider-search";
import { ResearchError, type ProviderDiagnostic } from "@/lib/research-errors";
import { isSafePublicUrl } from "@/lib/url-safety";
import { isQuoteGrounded, normalizeResultUrl, registrableDomain } from "@/lib/result-quality";
import { keylessProviders, runKeylessSearch } from "@/lib/keyless-search";
import { directRead } from "@/lib/direct-reader";
import { configuredAiProviders, runStructuredExtraction } from "@/lib/free-ai";
import { cleanContact, fieldSchemaFor, heuristicFields } from "@/lib/task-profile";
import { verifyPagesWithAi, type VerifyOutcome } from "@/lib/ai-verify";
import { checkNumericCriteria, describeCriteria, hasNumericCriteria, parseNumericCriteria } from "@/lib/criteria";
import { classifyPage, isNoiseSource, pageTypeLabel, placeFromQuery, profileFromText, termCoverage, type PageType } from "@/lib/page-kind";
import { inferResearchKind } from "@/lib/relevance-gate";

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

type ReadStatus = "checked" | "unavailable" | "blocked" | "rate_limited" | "skipped" | "policy_restricted" | "auth_required";

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
      // Long enough to keep the item links of a list page; the AI only sees a short excerpt.
      content = content.slice(0, 24000);
      result = { content, status: content.trim() ? "checked" : "unavailable", httpStatus: response.status };
    }
  } catch {
    result = { content: "", status: "unavailable" };
  }
  // Keyless Jina is rate limited quickly; fall back to a robots-aware direct read.
  if (result.status !== "checked" && result.status !== "blocked" && process.env.DIRECT_READ !== "off") {
    const direct = await directRead(url);
    if (direct.status === "checked" || result.status === "unavailable") result = { content: direct.content, status: direct.status, httpStatus: direct.httpStatus };
  }
  READ_CACHE.set(url, { at: Date.now(), content: result.content, status: result.status });
  if (READ_CACHE.size > 300) READ_CACHE.delete(READ_CACHE.keys().next().value as string);
  return result;
}

function buildBranches(map: SourceMap, testMode = false, sourceMemory: BackgroundResearchRequest["sourceMemory"] = [], edition: "free" | "pro" = "free", round = 0) {
  const memoryBranches = (sourceMemory || [])
    .slice(0, 12)
    .flatMap((source) => {
      const domain = String(source?.domain || "").trim();
      return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? [`site:${domain} ${map.subject}`] : [];
    });
  const limit = testMode ? 3 : edition === "pro" ? 12 : 8;
  // Every class of source gets a turn; a continuation round moves on to the next branches.
  const core = pickBranches(map, memoryBranches.length ? limit - 1 : limit, round);
  // Keep one learned-source branch in the budget so memory is actually reused.
  const memoryPick = memoryBranches.length ? memoryBranches[round % memoryBranches.length] : undefined;
  return [...new Set([...core, ...(memoryPick ? [memoryPick] : [])])].slice(0, limit);
}

// Search engines and foreign portals match English (or local) words far better than a
// Russian sentence. With an AI key the task is turned into a short English phrase first.
// The free AI quota is small (about 50 requests a day on OpenRouter), so the AI is asked
// only when the built-in dictionary cannot translate the subject.
// Pages per AI call: fewer calls per search keeps the free daily quota for more searches.
const AI_BATCH_SIZE = Math.max(1, Number(process.env.FREE_AI_BATCH_SIZE || 6));

async function englishSubject(query: string, edition: "free" | "pro", deadlineAt: number) {
  if (!/[^\x00-\x7F]/.test(query) || !configuredAiProviders(edition).length || process.env.TRANSLATE_QUERY === "off") return "";
  if (roughEnglish(query, inferResearchKind(query), "")) return "";
  const out = await runStructuredExtraction({
    system: "Rewrite the user's search task as one short English web-search phrase (at most 12 words). Keep names, places, numbers and units. Return JSON {\"en\": \"...\"}.",
    user: query.slice(0, 600),
    schema: { type: "object", additionalProperties: false, properties: { en: { type: "string" } }, required: ["en"] },
    edition,
    deadlineAt: Math.min(deadlineAt, Date.now() + 8000),
    maxTokens: 120,
    perCallTimeoutMs: 7000,
  }).catch(() => null);
  const en = String(out?.parsed?.en || "").replace(/\s+/g, " ").trim();
  return /^[\x00-\x7F€£]+$/.test(en) ? en.slice(0, 160) : "";
}

const B2B_PLATFORM = /(^|\.)(made-in-china|alibaba|globalsources|europages|tradeindia|indiamart|ec21|ecplaza|tradekey|dhgate)\.[a-z.]+$/i;
const JUNK_HOST = /^(www\.)?(login|passport|sso|auth|accounts?|my|member|members|cart|buy|checkout|pay|payment|static|assets?|img\d*|images?|image\d*|pic|pics|photo|photos|media|cdn\d*|s\d*|m|help|service|sale|offer|insights|activity|message|messages|feedback|i)\./i;
const JUNK_PATH = /\/(login|log-in|logout|signin|sign-in|signup|sign-up|register|join|cart|basket|checkout|wishlist|favou?rites?|compare|account|my-?account|user|member|passport|auth|sso|privacy|terms|cookies?|contact|contact-us|about|about-us|blog|news|faq|help|search|tag|tags|category|static|assets|img|images|uploads?|media|cdn|feedback|inquiry|sitemap)(\/|$|\.)/i;
const JUNK_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|ico|svg|pdf|css|js|json|xml|zip|rar|mp4|mp3|woff2?|ttf)$/i;

// Links that are never an item: login, cart, account, static files, images, CDN hosts.
export function isJunkLink(url: URL) {
  return JUNK_HOST.test(url.hostname) || JUNK_PATH.test(url.pathname) || JUNK_EXT.test(url.pathname)
    || /[?&](action|do)=(login|cart|add|register)/i.test(url.search);
}

// Stage 3 of the spec: a list page (a portal's search results, a directory) is opened
// and the item pages it links to are read, instead of stopping at the list.
export function itemLinks(listUrl: string, content: string, limit = 6) {
  let base: URL;
  try { base = new URL(listUrl); } catch { return []; }
  const links = new Set<string>();
  const re = /\]\((https?:\/\/[^)\s]+)\)|href="(https?:\/\/[^"]+|\/[^"]+)"/g;
  for (const m of String(content || "").matchAll(re)) {
    let url: URL;
    try { url = new URL(m[1] || m[2], base); } catch { continue; }
    // Same site, including a platform's supplier subdomains (acme.en.made-in-china.com).
    if (registrableDomain(url.toString()) !== registrableDomain(base.toString())) continue;
    const subdomain = url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "");
    const path = url.pathname;
    if (isJunkLink(url)) continue;
    if (subdomain) {
      // A bare subdomain home page is only an item on B2B platforms (a supplier's shop).
      // Elsewhere a subdomain link must look like a detail page.
      if (!B2B_PLATFORM.test(registrableDomain(base.toString())) && !/\d{3,}|[a-z]+(?:-[a-z0-9]+){3,}/i.test(path)) continue;
    } else {
      if (path === base.pathname || path.split("/").filter(Boolean).length < 2) continue;
      // Detail pages usually carry an id or a long slug.
      if (!/\d{3,}|[a-z]+(?:-[a-z0-9]+){3,}/i.test(path)) continue;
    }
    url.hash = "";
    links.add(normalizeResultUrl(url.toString()));
    if (links.size >= limit) break;
  }
  return [...links].filter((u) => isSafePublicUrl(u));
}

// The page sentence that best supports a result: it names the entity, or covers most of the
// task's terms. Copied verbatim (whitespace aside) so the quality gate can find it.
export function groundedSentence(content: string, names: string[], query: string) {
  const clean = String(content || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^(Title|URL Source|Markdown Content|Published Time):.*$/gim, "")
    .replace(/[#*_>`|]/g, " ");
  const sentences = clean.split(/(?<=[.!?])\s+|\n+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 30 && x.length <= 320);
  const tokens = names.flatMap((n) => String(n || "").split(/\s+/)).filter((t) => t.length >= 4 && !/^(the|and|ltd|group|company)$/i.test(t)).slice(0, 4);
  let best = "";
  let bestScore = 0;
  for (const sentence of sentences.slice(0, 400)) {
    const lower = sentence.toLowerCase();
    const named = tokens.some((t) => lower.includes(t.toLowerCase())) ? 1 : 0;
    const score = named * 2 + termCoverage(query, sentence);
    if (score > bestScore) { best = sentence; bestScore = score; }
  }
  return bestScore >= 1 ? best : "";
}

function firstSentences(text: string, limit = 320) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut).trim();
}

// Candidates preserved for Manual Review when AI extraction is unavailable or returns nothing.
// Fields come only from the page text; the score reflects how much of the query the page covers.
export function fallbackResults(hits: FreeSearchHit[], input: BackgroundResearchRequest) {
  const kind = inferResearchKind(input.query);
  const ru = input.language === "ru";
  return hits.slice(0, input.maxResults).map((hit) => {
    const quote = firstSentences(hit.snippet || String(hit.content || ""));
    const text = [hit.title, hit.snippet, hit.content].filter(Boolean).join("\n");
    const fields = heuristicFields(kind, text);
    const pageType = classifyPage({ url: hit.url, title: hit.title, text }, kind);
    const entity = pageType === "entity";
    const place = placeFromQuery(input.query, text);
    const match = Math.round(30 + 55 * termCoverage(input.query, text)) - (entity ? 0 : 25);
    const why = entity
      ? (ru
          ? (hit.content ? "Страница прочитана, совпадение по запросу. AI-проверка не выполнялась, подтвердите вручную." : "Найдено поиском, страница не прочитана. Проверьте вручную.")
          : (hit.content ? "Page read and matches the query. Not checked by AI, confirm manually." : "Found by search, page not read. Confirm manually."))
      : pageTypeLabel(pageType, input.language) + (ru ? ": на странице могут быть подходящие варианты, но сама она не является результатом." : ": the page may list matching items but is not a result itself.");
    return {
      title: hit.title || hit.domain,
      organization: "",
      specialization: profileFromText(kind, text),
      geography: place,
      contact: "",
      investment_type: "",
      stage: "",
      ticket: "",
      location: place,
      area: "",
      price: "",
      match: Math.max(10, Math.min(85, match)),
      confidence: (hit.content ? 55 : 35) - (entity ? 0 : 15),
      evidence: quote || "Discovered by live web search; page evidence was not extracted.",
      evidence_quote: quote,
      status: "Manual review",
      source: hit.domain,
      source_type: hit.provider + "_search_candidate",
      url: hit.url,
      why,
      page_type: pageType,
      retrieved_at: hit.retrievedAt,
      freshness_days: 0,
      independent_verification: false,
      ...fields,
    };
  });
}

// Real entities first, then by score; listing pages and articles go to the end.
export function rankResults<T extends { page_type?: string; pageType?: string; match?: number }>(items: T[]) {
  const rank = (item: T) => ((item.page_type || item.pageType || "entity") === "entity" ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || Number(b.item.match || 0) - Number(a.item.match || 0) || a.index - b.index)
    .map((x) => x.item);
}

type ProviderRun = { hits: FreeSearchHit[]; diagnostics: ProviderDiagnostic[] };

async function discoverCandidates(queries: string[], language: "ru" | "en", deadlineAt: number): Promise<ProviderRun> {
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

  // Keyless search keeps the Free edition working without any paid or registered key.
  const keyless = keylessProviders();
  if (keyless.length && (!key || hits.length < 5 || process.env.KEYLESS_SEARCH === "always")) {
    const outcomes = await runKeylessSearch(queries, language, Math.min(deadlineAt - 34_000, Date.now() + 18_000));
    for (const provider of keyless) {
      const mine = outcomes.filter((o) => o.provider === provider);
      if (!mine.length) continue;
      const providerHits = mine.flatMap((o) => o.hits);
      const failed = mine.find((o) => !o.ok);
      const anyOk = mine.some((o) => o.ok);
      diagnostics.push({
        provider,
        status: !anyOk ? (failed?.status === "rate_limited" ? "rate_limited" : "error") : providerHits.length ? "ok" : "empty",
        httpStatus: !anyOk ? failed?.httpStatus : undefined,
        hits: providerHits.length,
        message: failed?.message,
      });
      for (const hit of providerHits) hits.push({ ...hit, retrievedAt: new Date().toISOString() });
    }
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
  if (jinaKey() || configuredFallbackProviders().length || keylessProviders().length) return;
  throw new ResearchError(
    "JINA_API_KEY_MISSING",
    language === "ru"
      ? "Поиск не настроен: бесплатный поиск без ключа выключен (KEYLESS_SEARCH=off), не задан JINA_API_KEY и нет ни одного запасного поискового провайдера (Brave, Tavily, Exa, Serper…). Уберите KEYLESS_SEARCH=off или добавьте ключ в Vercel → Settings → Environment Variables и сделайте Redeploy."
      : "Search is not configured: keyless search is off (KEYLESS_SEARCH=off), JINA_API_KEY is missing and no fallback search provider (Brave, Tavily, Exa, Serper…) is configured. Remove KEYLESS_SEARCH=off or add a key in Vercel → Settings → Environment Variables and redeploy.",
    503,
    { providers: [{ provider: "jina", status: "not_configured" }] },
  );
}

// Waits for work until a moment in time; whatever is unfinished then is left out.
async function untilDeadline(work: Promise<unknown>, at: number) {
  const wait = at - Date.now();
  if (wait <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, wait); })]);
  if (timer) clearTimeout(timer);
}

// NOSONAR - the free pipeline is a linear sequence of bounded stages; splitting it further hides the data flow.
export async function runFreeResearch(input: BackgroundResearchRequest) {
  const deadlineAt = input.deadlineAt ?? Date.now() + 55_000;
  assertSearchConfigured(input.language);

  const edition = input.edition === "pro" ? "pro" : "free";
  const round = Math.max(0, Math.floor(Number(input.continuation?.round || 0)));
  const excluded = new Set((input.continuation?.excludeUrls || []).map((u) => normalizeResultUrl(u).toLowerCase()).filter(Boolean));
  const sourceMap = buildSourceMap(input.query, { subjectEn: await englishSubject(input.query, edition, deadlineAt) });
  const queries = buildBranches(sourceMap, input.testMode === true, input.sourceMemory, edition, round);
  const discovery = await discoverCandidates(queries, input.language, deadlineAt);
  const discoveredTotal = discovery.hits.length;
  // Pages already reviewed in earlier rounds are not read again.
  const allHits = excluded.size ? discovery.hits.filter((hit) => !excluded.has(hit.url.toLowerCase())) : discovery.hits;
  const providerDiagnostics = discovery.diagnostics;

  // A search engine that answers with a human check (CAPTCHA) is reported as such, with
  // what to configure instead. It is never solved or bypassed, and never shown as "nothing found".
  const challenged = providerDiagnostics.filter((d) => d.status === "rate_limited");
  if (!discoveredTotal && challenged.length) {
    const ru = input.language === "ru";
    throw new ResearchError(
      "SEARCH_RATE_LIMITED",
      (ru
        ? "Поисковик " + challenged.map((d) => d.provider).join(", ") + " попросил подтвердить, что запрос делает человек (капча), и не выдал результатов. Обходить проверку мы не будем. Для стабильного бесплатного поиска добавьте в Vercel JINA_API_KEY (бесплатный ключ на jina.ai) или SEARXNG_URL, затем повторите поиск."
        : "Search engine " + challenged.map((d) => d.provider).join(", ") + " asked for a human check (CAPTCHA) and returned no results. It is not bypassed. For stable free search add JINA_API_KEY (free key at jina.ai) or SEARXNG_URL in Vercel and retry."),
      503,
      { providers: providerDiagnostics },
    );
  }
  if (!discoveredTotal && providerDiagnostics.every((d) => d.status === "error" || d.status === "not_configured" || d.status === "rate_limited")) {
    const reason = providerDiagnostics.filter((d) => d.message).map((d) => d.provider + ": " + d.message).join(" ");
    throw new ResearchError(
      "SEARCH_PROVIDERS_FAILED",
      (input.language === "ru" ? "Все поисковые провайдеры вернули ошибку, исследование не выполнено. " : "Every search provider failed, research was not performed. ") + reason,
      502,
      { providers: providerDiagnostics },
    );
  }

  let candidateHits = allHits.slice(0, Math.min(input.maxSources, input.testMode ? 8 : edition === "pro" ? 30 : 16));
  let usedMemoryFallback = false;

  // Providers answered but found nothing: try previously learned public sources before reporting zero.
  if (!candidateHits.length && Array.isArray(input.sourceMemory)) {
    const memory = input.sourceMemory
      .filter((source) => isSafePublicUrl(source?.url) && !excluded.has(normalizeResultUrl(String(source.url)).toLowerCase()))
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

  // Forums and videos are never results for an entity search, so they are not read.
  const kindForRead = sourceMap.kind;
  const toRead = candidateHits.filter((hit) => !isNoiseSource(hit.url, kindForRead));
  const readerLimit = Math.min(toRead.length, input.testMode ? 3 : edition === "pro" ? 14 : 8);
  // Stage 3: a list page (portal search, B2B category) is opened and the item pages it links
  // to are read right away, in parallel with the other reads. Reading stops early enough
  // to leave the AI check about 25 seconds.
  const followBudget = input.testMode ? 2 : edition === "pro" ? 10 : 6;
  const known = new Set(candidateHits.map((hit) => hit.url.toLowerCase()));
  const followUrls: string[] = [];
  const followed: FreeSearchHit[] = [];
  await untilDeadline(Promise.all(toRead.slice(0, readerLimit).map(async (hit) => {
    if (!hit.content) {
      const read = await jinaRead(hit.url);
      hit.content = read.content;
      hit.readStatus = read.status;
    }
    if (!hit.content || classifyPage({ url: hit.url, title: hit.title, text: hit.content }, sourceMap.kind) !== "listing_index") return;
    const mine: string[] = [];
    for (const url of itemLinks(hit.url, hit.content, 3)) {
      if (followUrls.length >= followBudget || known.has(url.toLowerCase()) || excluded.has(url.toLowerCase())) continue;
      known.add(url.toLowerCase());
      followUrls.push(url);
      mine.push(url);
    }
    await Promise.all(mine.map(async (url) => {
      const read = await jinaRead(url);
      if (!read.content) return;
      const title = (read.content.match(/^Title:\s*(.+)$/m)?.[1] || read.content.match(/^#\s+(.+)$/m)?.[1] || host(url)).trim();
      followed.push({ title, url, snippet: firstSentences(read.content.replace(/^(Title|URL Source|Markdown Content):.*$/gm, ""), 600), domain: host(url), content: read.content, provider: "followed_link", retrievedAt: new Date().toISOString(), readStatus: read.status });
    }));
  })), deadlineAt - 27_000);
  for (const hit of candidateHits) if (!hit.content) hit.readStatus = hit.readStatus || "skipped";
  candidateHits = [...followed.filter((hit) => hit.content), ...candidateHits];

  const sourceRegistry = candidateHits.map((hit) => {
    const status = hit.readStatus === "checked" || hit.content ? "checked" : hit.readStatus === "skipped" || !hit.readStatus ? "partial" : hit.readStatus;
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
      category: sourceMap.sources.find((src) => hit.domain === src.domain || hit.domain.endsWith("." + src.domain))
        ? classLabel(sourceMap, sourceMap.sources.find((src) => hit.domain === src.domain || hit.domain.endsWith("." + src.domain))!.classId, input.language)
        : hit.provider === "followed_link" ? (input.language === "ru" ? "Карточка из подборки" : "Item from a list page") : "web_search:" + hit.provider,
      access_status: plan.status,
      access_method: hit.content ? "page_reader" : hit.provider + "_search",
      reason: plan.reason,
      evidence_available: Boolean(hit.content),
      quality: hit.content ? 80 : 50,
      last_checked: hit.retrievedAt,
    };
  });

  // The rest of the source map: known sources for this task and country that this round
  // did not reach. They are listed honestly as not checked, or as not automatable.
  const hitDomains = new Set(candidateHits.map((hit) => hit.domain.replace(/^www\./, "")));
  let mappedOnly = 0;
  const ru = input.language === "ru";
  for (const source of sourceMap.sources) {
    if ([...hitDomains].some((d) => d === source.domain || d.endsWith("." + source.domain))) continue;
    const status = source.access === "auth_required" ? "auth_required" : source.access === "not_automatable" ? "not_automatable" : "partial";
    const reason = status === "auth_required"
      ? (ru ? "Нужен вход в аккаунт: автоматически не исследуется, только вручную." : "Login required: not researched automatically, manual only.")
      : status === "not_automatable"
        ? (ru ? "Правила площадки запрещают автоматический сбор: только ручная проверка." : "Platform rules forbid automated collection: manual review only.")
        : (ru ? "В карте источников; в этом раунде не проверялся. Нажмите «Продолжить»." : "In the source map; not checked in this round. Press Continue.");
    mappedOnly += 1;
    sourceRegistry.push({
      name: source.name,
      url: source.url,
      domain: source.domain,
      category: classLabel(sourceMap, source.classId, input.language),
      access_status: status,
      access_method: "source_map",
      reason,
      evidence_available: false,
      quality: 60,
      last_checked: new Date().toISOString(),
    });
  }

  const accessEvents = candidateHits
    .filter((hit) => hit.readStatus && hit.readStatus !== "checked" && hit.readStatus !== "skipped")
    .map((hit) => ({ url: hit.url, status: hit.readStatus as string, method: "jina_reader", reason: "Reader could not retrieve the page.", fallback: "search_snippet_manual_review" }));

  // Stage 4: verification and extraction. Forums, videos and social feeds are never
  // results for an entity search; every read page goes to the AI check when a key is set.
  const kind = inferResearchKind(input.query);
  const criteria = parseNumericCriteria(input.query);
  const hasAi = configuredAiProviders(edition).length > 0;
  const rejected: Array<{ title: string; url: string; reason: string; score: number }> = [];
  const noiseHits = candidateHits.filter((hit) => isNoiseSource(hit.url, kind));
  for (const hit of noiseHits) rejected.push({ title: hit.title || hit.domain, url: hit.url, reason: "forum_video_or_social", score: 5 });
  const usableHits = candidateHits.filter((hit) => !isNoiseSource(hit.url, kind));
  const readHits = usableHits.filter((hit) => Boolean(hit.content));
  const aiPages = readHits.slice(0, input.testMode ? 6 : edition === "pro" ? 18 : 12)
    .map((hit, index) => ({ id: index + 1, url: hit.url, title: hit.title, domain: hit.domain, content: String(hit.content || "") }));

  let verify: VerifyOutcome | null = null;
  if (hasAi && aiPages.length) {
    verify = await verifyPagesWithAi({ query: input.query, kind, criteria, language: input.language, pages: aiPages, edition, deadlineAt, batchSize: AI_BATCH_SIZE });
  }
  const aiQuota = Boolean(verify?.quotaExhausted) && !verify?.checkedPages;
  const aiError = !hasAi ? "No AI key configured (OPENROUTER_API_KEY, GEMINI_API_KEY or GROQ_API_KEY)."
    : aiQuota ? "AI check unavailable: the free daily AI limit is reached. " + (verify?.error || "")
    : verify && verify.error ? verify.error : "";
  const verifiedById = new Map((verify?.items || []).map((item) => [item.id, item]));
  const pageById = new Map(aiPages.map((page) => [page.id, page]));
  const hitByUrl = new Map(candidateHits.map((hit) => [hit.url, hit]));

  type Candidate = Record<string, any> & { url: string; page_type: string; match: number; status: string };
  const candidates: Candidate[] = [];
  let aiKept = 0;
  let aiDropped = 0;
  for (const [id, item] of verifiedById) {
    const page = pageById.get(id)!;
    const hit = hitByUrl.get(page.url)!;
    const pageText = [hit.title, hit.snippet, hit.content].filter(Boolean).join("\n");
    if (!item.keep) {
      aiDropped += 1;
      rejected.push({ title: item.name || hit.title, url: hit.url, reason: "ai_rejected: " + (item.why || item.page_type), score: item.match });
      continue;
    }
    aiKept += 1;
    // The AI's quote counts only if it is really on the page; otherwise a sentence from the
    // page that names the entity is used, so every kept result carries checkable evidence.
    const quote = item.evidence_quote && isQuoteGrounded(item.evidence_quote, pageText) ? item.evidence_quote : "";
    const substitute = quote ? "" : groundedSentence(String(hit.content || ""), [item.name, item.organization], input.query);
    const place = item.location || sourceMap.place || placeFromQuery(input.query, pageText);
    const ruleType = classifyPage({ url: hit.url, title: hit.title, text: pageText }, kind);
    candidates.push({
      ...heuristicFields(kind, pageText),
      title: item.name || hit.title || hit.domain,
      organization: item.organization,
      specialization: item.specialization || profileFromText(kind, pageText),
      geography: place,
      location: place,
      contact: cleanContact(item.contact),
      investment_type: item.investment_type,
      stage: item.stage,
      ticket: item.ticket,
      area: item.area,
      price: item.price,
      match: item.match,
      confidence: quote ? 82 : substitute ? 72 : 55,
      evidence: item.why || quote || substitute || firstSentences(hit.snippet || String(hit.content || "")),
      // An AI quote that is not on the page and has no substitute is kept so the gate flags it.
      evidence_quote: quote || substitute || item.evidence_quote,
      status: quote ? (item.match >= 70 ? "Verified" : "Reviewed") : substitute ? "Reviewed" : "Manual review",
      source: hit.domain,
      source_type: "ai_verified_page",
      url: hit.url,
      why: item.why,
      // The AI judged it a single entity; the rule classifier is only a second opinion for list pages.
      page_type: item.page_type === "entity" && ruleType !== "article" ? "entity" : item.page_type === "entity" ? ruleType : item.page_type,
      retrieved_at: hit.retrievedAt,
      freshness_days: 0,
      independent_verification: false,
    });
  }
  // Pages the AI did not answer for (no key, a failed batch) and pages that were not read
  // are checked by rules and always need manual review.
  const verifiedUrls = new Set([...verifiedById.keys()].map((id) => pageById.get(id)!.url));
  // When the AI check works, pages it did not see are not shown as results: they stay in the
  // source registry ("not checked") instead of filling the table with unverified pages.
  const aiWorked = Boolean(verify && verify.checkedPages > 0);
  const ruleHits = aiWorked
    ? readHits.filter((hit) => !verifiedUrls.has(hit.url) && aiPages.some((p) => p.url === hit.url))
    : [...readHits.filter((hit) => !verifiedUrls.has(hit.url)), ...usableHits.filter((hit) => !hit.content)];
  for (const item of fallbackResults(ruleHits, { ...input, maxResults: ruleHits.length })) candidates.push(item as Candidate);

  // Hard filters: numeric criteria, then page type. Articles never count as results for
  // an entity search; list and catalogue pages stay only when there are too few entities.
  let belowCriteria = 0;
  const entities: Candidate[] = [];
  const listPages: Candidate[] = [];
  for (const item of candidates) {
    const hit = hitByUrl.get(item.url);
    const pageText = [hit?.title, hit?.content || hit?.snippet].filter(Boolean).join("\n");
    const check = checkNumericCriteria(criteria, { area: item.area, price: item.price, title: item.title }, pageText);
    if (check.verdict === "fail") {
      belowCriteria += 1;
      rejected.push({ title: String(item.title || ""), url: item.url, reason: "criteria: " + check.reason, score: 0 });
      continue;
    }
    if (check.verdict === "unknown") {
      item.status = "Manual review";
      item.match = Math.max(0, Number(item.match || 0) - 10);
      item.why = [item.why, input.language === "ru" ? "Значение для критерия (" + describeCriteria(criteria, "ru") + ") на странице не указано." : "The page does not state a value for " + describeCriteria(criteria, "en") + "."].filter(Boolean).join(" ");
    } else if (check.areaM2 && !item.area) {
      item.area = Math.round(check.areaM2).toLocaleString("ru-RU") + " m²";
    }
    const type = String(item.page_type || "entity");
    if (type === "entity") entities.push(item);
    else if (kind !== "general" && (type === "article" || type === "forum_or_video" || type === "other")) {
      rejected.push({ title: String(item.title || ""), url: item.url, reason: "not_an_entity: " + type, score: Number(item.match || 0) });
    } else listPages.push({ ...item, status: "Manual review" });
  }
  const keepListPages = kind === "general" || (!aiWorked && entities.length < 3);
  if (!keepListPages) for (const item of listPages) rejected.push({ title: String(item.title || ""), url: item.url, reason: "list_page_kept_as_source", score: Number(item.match || 0) });

  const relevance = filterResearchResults([...entities, ...(keepListPages ? listPages : [])], input.query);
  rejected.push(...relevance.rejected);
  // A page the AI read and confirmed is not demoted by the keyword relevance rules.
  for (const item of relevance.kept) {
    if (item.source_type === "ai_verified_page" && item.relevanceTier === "review" && item.status !== "Manual review") {
      item.relevanceTier = "accept";
      item.relevanceReason = "ai_verified";
    }
  }
  const results = rankResults(relevance.kept).slice(0, input.maxResults);
  const usedCandidateFallback = results.length > 0 && !results.some((item) => item.status !== "Manual review");

  const outcome = results.length
    ? (usedCandidateFallback ? "candidates_for_review" : "results")
    : candidateHits.length ? "all_candidates_rejected" : "no_candidates";

  const aiLine = !hasAi
    ? (ru
        ? "ИИ-проверка не подключена: добавьте бесплатный OPENROUTER_API_KEY (или GEMINI_API_KEY / GROQ_API_KEY) в Vercel. Сейчас поля взяты со страниц правилами, результаты нужно проверить вручную."
        : "AI verification is not configured: add a free OPENROUTER_API_KEY (or GEMINI_API_KEY / GROQ_API_KEY). Fields were extracted by rules and need manual review.")
    : verify && verify.checkedPages
      ? (ru
          ? `ИИ-проверка (${verify.provider} · ${verify.model}): проверено страниц ${verify.checkedPages}, подошло ${aiKept}, отсеяно ${aiDropped}.` + (verify.error ? " Часть страниц ИИ не проверил: " + verify.error : "")
          : `AI verification (${verify.provider} · ${verify.model}): ${verify.checkedPages} pages checked, ${aiKept} kept, ${aiDropped} dropped.` + (verify.error ? " Some pages were not checked: " + verify.error : ""))
      : aiPages.length && aiQuota
        ? (ru ? "ИИ-проверка недоступна: дневной лимит бесплатного ИИ исчерпан. Результаты отобраны правилами, проверьте их вручную. Лимит обновится в 03:00 по Москве; чтобы снять его, добавьте бесплатный GEMINI_API_KEY или пополните OpenRouter на $10." : "AI check unavailable: the free daily AI limit is reached. Results were selected by rules and need manual review. The limit resets at 00:00 UTC; add a free GEMINI_API_KEY or $10 of OpenRouter credit to lift it.")
      : aiPages.length
        ? (ru ? "ИИ-проверка не сработала: " + aiError + " Поля взяты правилами, результаты нужно проверить вручную." : "AI verification failed: " + aiError + " Fields were extracted by rules and need manual review.")
        : "";
  if (hasAi && aiError) console.warn("[research] AI verification problem:", aiError);
  const criteriaLine = hasNumericCriteria(criteria)
    ? (ru ? `Критерий ${describeCriteria(criteria, "ru")}: не подошло ${belowCriteria}.` : `Criterion ${describeCriteria(criteria, "en")}: ${belowCriteria} did not match.`)
    : "";
  const notEntities = rejected.filter((r) => r.reason.startsWith("not_an_entity") || r.reason === "forum_video_or_social").length;
  const filterLine = notEntities
    ? (ru ? `Убрано статей, форумов и видео: ${notEntities}.` : `Articles, forums and videos removed: ${notEntities}.`)
    : "";

  const summaryParts = [
    aiLine,
    criteriaLine,
    filterLine,
    relevance.kept.length > results.length ? (ru ? `Показано ${results.length} из ${relevance.kept.length} подходящих (лимит результатов).` : `Showing ${results.length} of ${relevance.kept.length} matches (result limit).`) : "",
    !keepListPages && listPages.length ? (ru ? `Страниц-подборок: ${listPages.length}, они оставлены в реестре источников.` : `${listPages.length} list pages kept in the source registry.`) : "",
    usedMemoryFallback ? "Search returned nothing; learned sources from memory were re-read." : "",
    challenged.length ? (ru ? "Часть поисковых запросов остановлена капчей " + challenged.map((d) => d.provider).join(", ") + "; результаты неполные. Добавьте JINA_API_KEY или SEARXNG_URL." : "Some searches were stopped by a CAPTCHA from " + challenged.map((d) => d.provider).join(", ") + "; results are incomplete. Add JINA_API_KEY or SEARXNG_URL.") : "",
    usedCandidateFallback ? (ru ? "Все результаты требуют ручной проверки." : "All results need manual review.") : "",
    outcome === "no_candidates" ? (ru ? "Поисковые провайдеры ответили, но не нашли ни одной страницы по запросу. Попробуйте переформулировать запрос или расширить географию." : "Search providers responded but found no pages for this query. Try rephrasing or widening the geography.") : "",
    outcome === "all_candidates_rejected" ? (ru ? `Найдено ${candidateHits.length} кандидатов, но ни один не прошёл проверку (статьи, подборки, не тот критерий). Нажмите «Продолжить», чтобы проверить следующие источники.` : `${candidateHits.length} candidates were found but none passed verification (articles, list pages, criteria). Press Continue to check more sources.`) : "",
  ].filter(Boolean);

  const finalParsed = {
    query_understanding: {
      intent: "research",
      entity_type: kind,
      geography: [sourceMap.place || sourceMap.country || ""].filter(Boolean),
      languages: [input.language],
      criteria: [describeCriteria(criteria, input.language)].filter(Boolean),
      exclusions: kind === "general" ? [] : (ru ? ["статьи и подборки", "форумы и видео"] : ["articles and lists", "forums and videos"]),
      required_fields: [],
      source_classes: sourceMap.classes.map((c) => c.id),
    },
    search_plan: "Live web search (" + providerDiagnostics.filter((d) => d.status === "ok").map((d) => d.provider).join(", ") + ") + page reader + " + (verify?.provider ? verify.provider + " AI verification (" + verify.model + ")." : "rule-based extraction."),
    search_branches: queries,
    search_summary: summaryParts.join(" "),
    candidates_seen: discoveredTotal,
    duplicates_removed: 0,
    access_events: accessEvents,
    source_registry: sourceRegistry,
    results,
  };

  const sourceText = new Map<string, string>();
  for (const hit of candidateHits) sourceText.set(hit.url, [hit.snippet, hit.content].filter(Boolean).join("\n"));

  const normalized: any = normalizeCompletedResearch(
    { id: "free_" + Date.now().toString(36), status: "completed", output_text: JSON.stringify(finalParsed), output: [], usage: verify?.usage || null },
    input,
    { sourceText, rejected, preFiltered: true },
  );
  const aiModel = verify?.model || "rules";
  normalized.billing = { provider: verify?.provider || "rules", model: aiModel, billable: edition === "pro" && Boolean(process.env.PRO_OPENROUTER_MODEL) && verify?.provider === "openrouter", webSearchCalls: queries.length, usage: verify?.usage || null, background: false };
  normalized.task = { id: taskIdFrom(normalized.query), responseId: "free_" + Date.now().toString(36), providerStatus: "completed" };
  normalized.live = true;
  normalized.partial = false;
  normalized.degraded = Boolean(aiError) || usedCandidateFallback || usedMemoryFallback;
  normalized.outcome = outcome;
  normalized.providers = providerDiagnostics;
  normalized.aiStatus = {
    ok: Boolean(verify?.checkedPages) && !verify?.error,
    configured: hasAi,
    provider: verify?.provider,
    model: verify?.model,
    pagesChecked: verify?.checkedPages || 0,
    kept: aiKept,
    dropped: aiDropped,
    message: aiError || (verify?.checkedPages ? "ok" : "skipped"),
    quotaExhausted: Boolean(verify?.quotaExhausted),
    attempts: verify?.attempts || [],
  };
  normalized.stats.candidatesFound = discoveredTotal;
  normalized.edition = edition;
  normalized.taskKind = kind;
  normalized.fieldSchema = fieldSchemaFor(kind);
  normalized.progressCounters = progressCounters({
    discovered: discoveredTotal + followUrls.length + mappedOnly,
    knownSources: Number(input.knownSourceCount || 0),
    registry: normalized.sourceRegistry,
    // Found = every candidate extracted; after dedupe = what passed the checks minus duplicates
    // (before the display limit); filtered out = rejected by the AI, criteria or page type.
    recordsExtracted: candidates.length + noiseHits.length,
    afterDedupe: Math.max(0, relevance.kept.length - Number(normalized.stats.duplicatesRemoved || 0)),
    filteredOut: rejected.length,
    results: normalized.results,
  });
  normalized.continuation = {
    round: round + 1,
    seenUrls: [...new Set([...excluded, ...candidateHits.map((hit) => hit.url.toLowerCase())])].slice(-400),
    canContinue: allHits.length > candidateHits.length || queries.length > 1,
  };
  return normalized;
}

function taskIdFrom(query: string) {
  return "FREE-" + Buffer.from(query).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(-10).toUpperCase();
}

