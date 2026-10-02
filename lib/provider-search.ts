import { buildSearchMatrix } from "@/lib/search-matrix";
export type ProviderName =
  | "brave" | "exa" | "tavily" | "mojeek" | "yandex" | "naver" | "dataforseo"
  | "serper" | "jina" | "firecrawl";

export type ProviderSearchHit = {
  provider: ProviderName;
  engine?: string;
  title: string;
  url: string;
  snippet: string;
  score?: number;
  publishedAt?: string;
  domain?: string;
  category?: string;
  query?: string;
};

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function cleanUrl(value: unknown) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  return url;
}

async function braveSearch(query: string, country?: string, searchLang?: string): Promise<ProviderSearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const params = new URLSearchParams({ q: query, count: "20" });
  if (country) params.set("country", country);
  if (searchLang) params.set("search_lang", searchLang);
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
      headers: { accept: "application/json", "x-subscription-token": key },
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.web?.results || []).map((item: any) => {
      const url = cleanUrl(item?.url);
      return {
        provider: "brave" as const,
        engine: "brave-web",
        title: String(item?.title || ""),
        url,
        snippet: String(item?.description || item?.snippet || ""),
        publishedAt: item?.age || item?.page_age || undefined,
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function exaSearch(query: string): Promise<ProviderSearchHit[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, type: "auto", numResults: 20, contents: { highlights: true } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.results || []).map((item: any) => {
      const url = cleanUrl(item?.url || item?.id);
      return {
        provider: "exa" as const,
        engine: "exa",
        title: String(item?.title || ""),
        url,
        snippet: Array.isArray(item?.highlights) ? item.highlights.join(" ") : String(item?.text || item?.summary || ""),
        score: typeof item?.score === "number" ? item.score : undefined,
        publishedAt: item?.publishedDate || undefined,
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function tavilySearch(query: string): Promise<ProviderSearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: 20,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.results || []).map((item: any) => {
      const url = cleanUrl(item?.url);
      return {
        provider: "tavily" as const,
        engine: "tavily",
        title: String(item?.title || ""),
        url,
        snippet: String(item?.content || item?.snippet || ""),
        score: typeof item?.score === "number" ? item.score : undefined,
        publishedAt: item?.published_date || undefined,
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function mojeekSearch(query: string, country?: string, language?: string): Promise<ProviderSearchHit[]> {
  const key = process.env.MOJEEK_API_KEY;
  if (!key) return [];
  try {
    const params = new URLSearchParams({ q: query, api_key: key, fmt: "json", t: "20" });
    if (country) params.set("rb", country);
    if (language) params.set("lb", language.toUpperCase());
    const res = await fetch(`https://api.mojeek.com/search?${params.toString()}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const json: any = await res.json();
    const rows = json?.response?.results || json?.results || [];
    return rows.map((item: any) => {
      const url = cleanUrl(item?.url || item?.link);
      return {
        provider: "mojeek" as const,
        engine: "mojeek",
        title: String(item?.title || ""),
        url,
        snippet: String(item?.desc || item?.description || item?.snippet || ""),
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function yandexSearch(query: string, language = "ru"): Promise<ProviderSearchHit[]> {
  const key = process.env.YANDEX_SEARCH_API_KEY;
  if (!key) return [];
  try {
    const endpoint = process.env.YANDEX_SEARCH_API_URL || "https://searchapi.api.cloud.yandex.net/v2/web/search";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Api-Key ${key}` },
      body: JSON.stringify({ query: { searchText: query, searchFilter: "none", familyMode: "moderate", page: 0 }, sortSpec: { sortMode: "relevance" }, groupSpec: { groupMode: "flat", groupsOnPage: 20, docsInGroup: 1 }, maxPassages: 3, region: 225, l10n: language }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const docs = json?.results?.grouping?.[0]?.groups?.flatMap((g: any) => g?.documents || []) || json?.results?.searchResult?.documents || [];
    return docs.map((item: any) => {
      const url = cleanUrl(item?.url || item?.doc?.url);
      return {
        provider: "yandex" as const,
        engine: "yandex",
        title: String(item?.title || item?.doc?.title || ""),
        url,
        snippet: String(item?.snippet?.snippetText || item?.doc?.snippet?.snippetText || ""),
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function naverSearch(query: string): Promise<ProviderSearchHit[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];
  try {
    const url = `https://openapi.naver.com/v1/search/webkr.json?query=${encodeURIComponent(query)}&display=20&start=1&sort=sim`;
    const res = await fetch(url, {
      headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.items || []).map((item: any) => {
      const url = cleanUrl(item?.link);
      return {
        provider: "naver" as const,
        engine: "naver-web",
        title: String(item?.title || "").replace(/<[^>]+>/g, ""),
        url,
        snippet: String(item?.description || "").replace(/<[^>]+>/g, ""),
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

async function dataForSeoSearch(query: string, engine: string, locationCode?: number, languageCode = "en") : Promise<ProviderSearchHit[]> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return [];
  const supported = new Set(["google", "bing", "yahoo", "baidu", "naver", "seznam"]);
  if (!supported.has(engine)) return [];
  const payload = [{
    keyword: query,
    language_code: languageCode,
    location_code: locationCode || undefined,
    depth: 20,
  }];
  try {
    const basic = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch(`https://api.dataforseo.com/v3/serp/${engine}/organic/live/advanced`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${basic}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const items = json?.tasks?.flatMap((task: any) => task?.result?.flatMap((result: any) => result?.items || []) || []) || [];
    return items.map((item: any) => {
      const url = cleanUrl(item?.url || item?.link);
      return {
        provider: "dataforseo" as const,
        engine,
        title: String(item?.title || ""),
        url,
        snippet: String(item?.description || item?.snippet || ""),
        score: typeof item?.rank_group === "number" ? 1 / Math.max(1, item.rank_group) : undefined,
        domain: hostname(url), query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}



async function serperSearch(query: string): Promise<ProviderSearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({ q: query, num: 20 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.organic || []).map((item: any) => {
      const url = cleanUrl(item?.link);
      return {
        provider: "serper" as const,
        engine: "google-serper",
        title: String(item?.title || ""),
        url,
        snippet: String(item?.snippet || ""),
        domain: hostname(url),
        query,
      };
    }).filter((x: ProviderSearchHit) => x.url);
  } catch { return []; }
}

export async function publicReader(url: string, provider: "jina" | "firecrawl"): Promise<ProviderSearchHit[]> {
  if (!url) return [];
  try {
    if (provider === "jina") {
      const key = process.env.JINA_API_KEY;
      if (!key) return [];
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "text/plain" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) return [];
      const text = await res.text();
      return [{
        provider: "jina",
        engine: "jina-reader",
        title: url,
        url,
        snippet: text.slice(0, 1800),
        domain: hostname(url),
      }];
    }

    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) return [];
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const markdown = String(json?.data?.markdown || json?.markdown || "");
    return [{
      provider: "firecrawl",
      engine: "firecrawl",
      title: String(json?.data?.metadata?.title || url),
      url,
      snippet: markdown.slice(0, 1800),
      domain: hostname(url),
    }];
  } catch { return []; }
}


function extractCountryHint(geographyHint?: string) {
  const iso = geographyHint?.match(/\b[A-Z]{2}\b/);
  return iso?.[0]?.toLowerCase();
}

async function runProviderQuery(q: string, languageCode: string, country?: string) {
  const tasks: Promise<ProviderSearchHit[]>[] = [
    braveSearch(q, country, languageCode),
    exaSearch(q),
    tavilySearch(q),
    mojeekSearch(q, country, languageCode),
    yandexSearch(q, languageCode),
    naverSearch(q),
    serperSearch(q),
    dataForSeoSearch(q, "google", Number(process.env.DATAFORSEO_LOCATION_CODE || 0) || undefined, languageCode),
    dataForSeoSearch(q, "bing", Number(process.env.DATAFORSEO_LOCATION_CODE || 0) || undefined, languageCode),
    dataForSeoSearch(q, "yahoo", Number(process.env.DATAFORSEO_LOCATION_CODE || 0) || undefined, languageCode),
    dataForSeoSearch(q, "baidu", Number(process.env.DATAFORSEO_LOCATION_CODE || 0) || undefined, languageCode === "ru" ? "en" : languageCode),
    dataForSeoSearch(q, "naver", undefined, languageCode),
    dataForSeoSearch(q, "seznam", Number(process.env.DATAFORSEO_LOCATION_CODE || 0) || undefined, "cs"),
  ];
  const batches = await Promise.allSettled(tasks);
  const results: ProviderSearchHit[] = [];
  for (const batch of batches) {
    if (batch.status === "fulfilled") results.push(...batch.value);
  }
  return results;
}

export async function runProviderDiscovery(query: string, language: string, geographyHint?: string) {
  const q = query.trim();
  const country = extractCountryHint(geographyHint);
  const languageCode = language === "ru" ? "ru" : language === "cs" ? "cs" : language === "de" ? "de" : language === "uk" ? "uk" : "en";
  const maxQueries = Math.min(Math.max(Number(process.env.SUPPLEMENTAL_SEARCH_MAX_QUERIES || 8), 1), 20);
  const matrix = buildSearchMatrix(q, languageCode, geographyHint);
  const ranked = [...matrix].sort((a, b) => b.priority - a.priority);
  const social = ranked.filter((branch) => branch.className === "social_public");
  const core = ranked.filter((branch) => branch.className !== "social_public");
  const intentLooksCommunityOrPeople = /investor|people|person|specialist|expert|broker|agent|community|group|channel|forum|инвест|люд|специал|брокер|групп|канал|форум|інвест|люд|спец/.test(q.toLowerCase());
  const selectedBranches = [
    ...core.slice(0, Math.max(5, maxQueries - (intentLooksCommunityOrPeople ? 3 : 2))),
    ...(intentLooksCommunityOrPeople ? social.slice(0, 3) : social.slice(0, 2)),
  ];
  const queryList = [...new Set(selectedBranches
    .flatMap((branch) => branch.queries)
    .filter(Boolean))]
    .slice(0, maxQueries);

  const all: ProviderSearchHit[] = [];
  const batches = await Promise.allSettled(queryList.map((branchQuery) => runProviderQuery(branchQuery, languageCode, country)));
  for (const batch of batches) {
    if (batch.status === "fulfilled") all.push(...batch.value);
  }

  const seen = new Set<string>();
  return all.filter((hit) => {
    const key = `${hit.url.toLowerCase().replace(/#.*$/, "")}|${hit.engine || hit.provider}`;
    if (!hit.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}

export function getSearchProviderCatalog() {
  return [
    { id: "brave", type: "web", env: "BRAVE_SEARCH_API_KEY", status: process.env.BRAVE_SEARCH_API_KEY ? "configured" : "optional" },
    { id: "exa", type: "semantic", env: "EXA_API_KEY", status: process.env.EXA_API_KEY ? "configured" : "optional" },
    { id: "tavily", type: "ai_web", env: "TAVILY_API_KEY", status: process.env.TAVILY_API_KEY ? "configured" : "optional" },
    { id: "mojeek", type: "independent_web", env: "MOJEEK_API_KEY", status: process.env.MOJEEK_API_KEY ? "configured" : "optional" },
    { id: "yandex", type: "regional_web", env: "YANDEX_SEARCH_API_KEY", status: process.env.YANDEX_SEARCH_API_KEY ? "configured" : "optional" },
    { id: "naver", type: "regional_web", env: "NAVER_CLIENT_ID + NAVER_CLIENT_SECRET", status: process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET ? "configured" : "optional" },
    { id: "dataforseo", type: "serp_aggregator", env: "DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD", status: process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD ? "configured" : "optional" },
    { id: "serper", type: "serp_api", env: "SERPER_API_KEY", status: process.env.SERPER_API_KEY ? "configured" : "optional" },
    { id: "jina", type: "public_reader", env: "JINA_API_KEY", status: process.env.JINA_API_KEY ? "configured" : "optional" },
    { id: "firecrawl", type: "public_reader", env: "FIRECRAWL_API_KEY", status: process.env.FIRECRAWL_API_KEY ? "configured" : "optional" },
    { id: "openai_web_search", type: "live_web", env: "OPENAI_API_KEY", status: process.env.OPENAI_API_KEY ? "configured" : "required" },
  ];
}
