import { NextResponse } from "next/server";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import type { ResearchQueryUnderstanding, LiveSourceRecord, AccessEvent } from "@/lib/research-contract";
import { getSearchProviderCatalog, runProviderDiscovery } from "@/lib/provider-search";
import { buildSearchMatrix } from "@/lib/search-matrix";

export const runtime = "nodejs";
export const maxDuration = 300;

type ResearchRequest = {
  query?: string;
  language?: "ru" | "en";
  maxResults?: number;
  depth?: "Quick" | "Balanced" | "Deep";
  maxSources?: number;
  maxPages?: number;
  multilingual?: boolean;
  followRelatedLinks?: boolean;
};

type ResearchResult = {
  id: number;
  title: string;
  location: string;
  area: string;
  price: string;
  match: number;
  evidence: string;
  evidenceQuote: string;
  status: "Verified" | "Reviewed" | "Manual review";
  source: string;
  sourceType: string;
  sourceDomain: string;
  url: string;
  why: string;
  retrievedAt: string;
  freshnessDays: number;
  confidence: number;
  independentVerification: boolean;
};

function outputText(response: any) {
  return typeof response?.output_text === "string" ? response.output_text : "";
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, " ")
    .trim();
}

function dedupeResults(items: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of items) {
    const key = [
      item?.url,
      normalize(String(item?.title || "")),
      normalize(String(item?.location || "")),
      normalize(String(item?.area || "")),
    ].join("|");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return { out, removed: Math.max(0, items.length - out.length) };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";

  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured. Add it to Vercel Environment Variables to enable live web research." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as ResearchRequest;
  const query = String(body.query || "").trim();
  const language = body.language === "en" ? "en" : "ru";
  const depth = body.depth || "Deep";
  const maxResults = Math.min(Math.max(Number(body.maxResults || 12), 4), 20);
  const maxSources = Math.min(Math.max(Number(body.maxSources || 50), 5), 150);
  const maxPages = Math.min(Math.max(Number(body.maxPages || 200), 20), 2500);
  const multilingual = body.multilingual !== false;
  const followRelatedLinks = body.followRelatedLinks !== false;

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      query_understanding: {
        type: "object",
        additionalProperties: false,
        properties: {
          intent: { type: "string" },
          entity_type: { type: "string" },
          geography: { type: "array", items: { type: "string" } },
          languages: { type: "array", items: { type: "string" } },
          criteria: { type: "array", items: { type: "string" } },
          exclusions: { type: "array", items: { type: "string" } },
          required_fields: { type: "array", items: { type: "string" } },
          source_classes: { type: "array", items: { type: "string" } },
        },
        required: ["intent", "entity_type", "geography", "languages", "criteria", "exclusions", "required_fields", "source_classes"],
      },
      search_plan: { type: "string" },
      search_branches: { type: "array", items: { type: "string" }, maxItems: 30 },
      search_summary: { type: "string" },
      candidates_seen: { type: "integer", minimum: 0 },
      duplicates_removed: { type: "integer", minimum: 0 },
      access_events: {
        type: "array",
        maxItems: 80,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            url: { type: "string" },
            status: { type: "string" },
            method: { type: "string" },
            reason: { type: "string" },
            fallback: { type: "string" },
          },
          required: ["url", "status", "method", "reason", "fallback"],
        },
      },
      source_registry: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            url: { type: "string" },
            domain: { type: "string" },
            category: { type: "string" },
            access_status: {
              type: "string",
              enum: ["checked", "partial", "unavailable", "blocked", "auth_required", "policy_restricted"],
            },
            access_method: { type: "string" },
            reason: { type: "string" },
            evidence_available: { type: "boolean" },
            quality: { type: "integer", minimum: 0, maximum: 100 },
          },
          required: ["name", "url", "domain", "category", "access_status", "access_method", "reason", "evidence_available", "quality"],
        },
      },
      results: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            location: { type: "string" },
            area: { type: "string" },
            price: { type: "string" },
            match: { type: "integer", minimum: 0, maximum: 100 },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            evidence: { type: "string" },
            evidence_quote: { type: "string" },
            status: { type: "string", enum: ["Verified", "Reviewed", "Manual review"] },
            source: { type: "string" },
            source_type: { type: "string" },
            url: { type: "string" },
            why: { type: "string" },
            retrieved_at: { type: "string" },
            freshness_days: { type: "integer", minimum: 0 },
            independent_verification: { type: "boolean" },
          },
          required: [
            "title", "location", "area", "price", "match", "confidence", "evidence", "evidence_quote",
            "status", "source", "source_type", "url", "why", "retrieved_at", "freshness_days", "independent_verification",
          ],
        },
      },
    },
    required: ["query_understanding", "search_plan", "search_branches", "search_summary", "candidates_seen", "duplicates_removed", "access_events", "source_registry", "results"],
  };

  const supplementalEnabled = process.env.SUPPLEMENTAL_SEARCH_ENABLED !== "false";
  const searchMatrix = buildSearchMatrix(query, language);
  const providerHints = supplementalEnabled ? await runProviderDiscovery(query, language) : [];
  const providerCatalog = getSearchProviderCatalog();
  const providerHintBlock = providerHints.slice(0, 120).map((hit: any) => ({
    provider: hit.provider,
    engine: hit.engine,
    query: hit.query,
    title: hit.title,
    url: hit.url,
    domain: hit.domain,
    snippet: hit.snippet.slice(0, 700),
  }));

  const systemPrompt = language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN;
  const userPrompt = language === "ru"
    ? `Исходный запрос пользователя:
${query}

Режим: ${depth}. Целевые лимиты: до ${maxSources} источников, до ${maxPages} страниц/URL, до ${maxResults} итоговых результатов.
Мультиязычное расширение: ${multilingual ? "включено" : "выключено"}. Исследование связанных страниц: ${followRelatedLinks ? "включено" : "выключено"}.

КАТАЛОГ ПОИСКА:
${JSON.stringify(providerCatalog)}

МАТРИЦА ВЕТОК:
${JSON.stringify(searchMatrix)}

КАНДИДАТЫ ОТ ДОПОЛНИТЕЛЬНЫХ ПОИСКОВЫХ СИСТЕМ:
${JSON.stringify(providerHintBlock)}

РАБОТАЙ КАК DATA-ACQUISITION ENGINE:
- Сначала разложи запрос на сущность, географию, критерии, исключения и обязательные поля.
- Не ограничивайся одним поисковиком: используй независимые ветки general web, official/government, specialist directories, companies/suppliers, documents/open data, news, local/maps, jobs и public social/community discovery.
- Используй несколько поисковых систем/региональных индексов, когда они доступны, включая Brave, Exa, Tavily, Mojeek, Yandex, Naver и SERP-агрегацию Google/Bing/Yahoo/Baidu/Naver/Seznam.
- Для подходящих задач выполняй discovery публичных страниц Facebook, Telegram, LinkedIn, Reddit, YouTube, Meetup, Discord, Quora и публичных форумов через разрешённые индексы/APIs. Закрытые группы, чужие аккаунты и обход авторизации не использовать.
- Используй региональные языки, локальные термины, синонимы, разные написания географии и специальные query-операторы.
- Не останавливайся на первых нескольких результатах; расширяй ветки, пока recall продолжает расти или достигнуты лимиты.
- Для каждого источника реши, был ли он реально проверен, частично проверен, недоступен, заблокирован или требует авторизации.
- В results обязательно укажи evidence_quote, прямой URL и confidence.
- Удаляй очевидные дубли до выдачи.
- Если первичный источник доступен, проверяй факт в нём, а не только по поисковому сниппету.
- Если данных мало, честно снижай статус результата, а не заполняй пробелы догадками.

После исследования обязательно вызови emit_research_results с полным структурированным результатом.`
    : `User request:
${query}

Mode: ${depth}. Target limits: up to ${maxSources} sources, ${maxPages} pages/URLs, ${maxResults} final results.
Multilingual expansion: ${multilingual ? "on" : "off"}. Related-page exploration: ${followRelatedLinks ? "on" : "off"}.

SEARCH PROVIDER CATALOG:
${JSON.stringify(providerCatalog)}

SEARCH BRANCH MATRIX:
${JSON.stringify(searchMatrix)}

SUPPLEMENTAL SEARCH CANDIDATES:
${JSON.stringify(providerHintBlock)}

WORK AS A DATA-ACQUISITION ENGINE:
- First decompose the request into entity, geography, criteria, exclusions and required fields.
- Do not limit discovery to one search engine: use independent branches for general web, official/government, specialist directories, companies/suppliers, documents/open data, news, local/maps, jobs and public social/community discovery.
- Use multiple engines/regional indexes when available, including Brave, Exa, Tavily, Mojeek, Yandex, Naver and SERP aggregation for Google/Bing/Yahoo/Baidu/Naver/Seznam.
- For relevant tasks, discover public Facebook, Telegram, LinkedIn, Reddit, YouTube, Meetup, Discord, Quora and public forum pages through permitted indexes/APIs. Do not access closed groups, borrowed accounts or bypass authentication.
- Expand with regional languages, local terms, synonyms, geography variants and specialized query operators.
- Do not stop at the first few hits; expand branches until useful recall stops improving or limits are reached.
- For each source classify whether it was actually checked, partial, unavailable, blocked or auth-required.
- Every result must include evidence_quote, direct URL and confidence.
- Prefer the underlying primary source over a search snippet whenever available.
- Remove obvious duplicates before emission.
- When evidence is weak, lower the result status rather than guessing.

After the research, you MUST call emit_research_results with the full structured result.`

  const tools = [
    { type: "web_search", search_context_size: depth === "Deep" ? "high" : "medium" },
    {
      type: "function",
      name: "emit_research_results",
      description: "Emit the complete structured research dataset after real web research. Ground every field in evidence; never invent unknown values.",
      parameters: schema,
      strict: true,
    },
  ];

  const startedAt = Date.now();
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      max_output_tokens: 9000,
    }),
  });

  const response = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json({ error: response?.error?.message || "OpenAI live research request failed.", diagnostics: { upstreamStatus: upstream.status } }, { status: upstream.status });
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const functionCall = output.find((item: any) => item?.type === "function_call" && item?.name === "emit_research_results");
  let parsed: any = null;

  if (functionCall?.arguments) {
    try {
      parsed = JSON.parse(functionCall.arguments);
    } catch {
      return NextResponse.json({ error: "The structured function-call arguments were invalid JSON.", diagnostics: { functionCallFound: true } }, { status: 502 });
    }
  } else {
    const raw = outputText(response).trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { parsed = JSON.parse(raw.slice(first, last + 1)); } catch { parsed = null; }
    }
    if (!parsed) {
      return NextResponse.json({ error: "The live research response could not be converted into structured data.", diagnostics: { outputTypes: output.map((item: any) => item?.type).filter(Boolean) } }, { status: 502 });
    }
  }

  const webSources = new Set<string>();
  for (const item of output) {
    if (item?.type === "web_search_call") {
      const sources = item?.action?.sources;
      if (Array.isArray(sources)) for (const source of sources) if (typeof source?.url === "string") webSources.add(source.url);
    }
    if (item?.type === "message" && Array.isArray(item?.content)) {
      for (const part of item.content) {
        for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (typeof annotation?.url === "string") webSources.add(annotation.url);
        }
      }
    }
  }

  const rawResults = Array.isArray(parsed?.results) ? parsed.results.slice(0, maxResults) : [];
  const deduped = dedupeResults(rawResults);
  const retrievedAt = new Date().toISOString();

  const results: ResearchResult[] = deduped.out.map((item: any, index: number) => ({
    id: index + 1,
    title: String(item?.title || "Untitled result"),
    location: String(item?.location || "not specified"),
    area: String(item?.area || "not specified"),
    price: String(item?.price || "not specified"),
    match: Math.max(0, Math.min(100, Number(item?.match || 0))),
    confidence: Math.max(0, Math.min(100, Number(item?.confidence || 0))),
    evidence: String(item?.evidence || "No evidence summary"),
    evidenceQuote: String(item?.evidence_quote || ""),
    status: ["Verified", "Reviewed", "Manual review"].includes(item?.status) ? item.status : "Reviewed",
    source: String(item?.source || "Web source"),
    sourceType: String(item?.source_type || "web"),
    sourceDomain: getDomain(String(item?.url || "")),
    url: String(item?.url || ""),
    why: String(item?.why || ""),
    retrievedAt: String(item?.retrieved_at || retrievedAt),
    freshnessDays: Math.max(0, Number(item?.freshness_days || 0)),
    independentVerification: Boolean(item?.independent_verification),
  }));

  const sourceRegistry: LiveSourceRecord[] = (Array.isArray(parsed?.source_registry) ? parsed.source_registry : []).slice(0, maxSources).map((source: any) => ({
    name: String(source?.name || "Unknown source"),
    url: String(source?.url || ""),
    domain: String(source?.domain || getDomain(String(source?.url || ""))),
    category: String(source?.category || "web"),
    accessStatus: String(source?.access_status || "partial") as LiveSourceRecord["accessStatus"],
    accessMethod: String(source?.access_method || "web_search"),
    reason: String(source?.reason || ""),
    evidenceAvailable: Boolean(source?.evidence_available),
    quality: Math.max(0, Math.min(100, Number(source?.quality || 0))),
  }));

  for (const hit of providerHints) {
    if (!sourceRegistry.some((source) => source.url === hit.url)) {
      sourceRegistry.push({
        name: hit.title || hit.domain || hit.url,
        url: hit.url,
        domain: hit.domain || getDomain(hit.url),
        category: `provider:${hit.provider}`,
        accessStatus: "partial",
        accessMethod: hit.provider,
        reason: "Discovery hint returned by supplemental search provider; page verification is separate.",
        evidenceAvailable: Boolean(hit.snippet),
        quality: Math.max(45, Math.min(90, Math.round((hit.score || 0.6) * 100))),
      });
    }
  }

  const accessEvents: AccessEvent[] = (Array.isArray(parsed?.access_events) ? parsed.access_events : []).slice(0, 80).map((event: any) => ({
    url: String(event?.url || ""),
    status: String(event?.status || "partial"),
    method: String(event?.method || "web_search"),
    reason: String(event?.reason || ""),
    fallback: String(event?.fallback || "manual_review_or_alternate_source"),
  }));

  const sourceUrls = new Set<string>(webSources);
  for (const source of sourceRegistry) if (source.url) sourceUrls.add(source.url);
  for (const result of results) if (result.url) sourceUrls.add(result.url);

  const resultDomains = new Set<string>();
  for (const result of results) if (result.sourceDomain) resultDomains.add(result.sourceDomain);
  const sourceDomains = new Set<string>(sourceRegistry.map((s) => s.domain).filter(Boolean));
  for (const domain of resultDomains) sourceDomains.add(domain);

  const gatedResults = results.map((item) => {
    const checks = {
      sourceUrl: Boolean(item.url),
      sourceName: Boolean(item.source),
      evidence: Boolean(item.evidence && item.evidence !== "No evidence summary"),
      evidenceQuote: Boolean(item.evidenceQuote),
      title: Boolean(item.title && item.title !== "Untitled result"),
      location: Boolean(item.location && item.location !== "not specified"),
      structuredValue: Boolean((item.area && item.area !== "not specified") || (item.price && item.price !== "not specified")),
      confidence: item.confidence >= 70,
      sourceCaptured: webSources.size === 0 || webSources.has(item.url) || sourceRegistry.some((s) => s.url === item.url || s.domain === item.sourceDomain),
      statusAllowed: ["Verified", "Reviewed", "Manual review"].includes(item.status),
    };
    const passed = Object.values(checks).filter(Boolean).length;
    const total = Object.keys(checks).length;
    const gate = passed === total ? "PASS" : passed >= Math.ceil(total * 0.75) ? "REVIEW" : "FAIL";
    return {
      ...item,
      qualityGate: {
        gate,
        passed,
        total,
        checks,
        independentVerification: item.independentVerification,
        note: gate === "PASS"
          ? "Deterministic evidence/source checks passed; independent second-source confirmation is reported separately."
          : "Manual review required before treating this record as fully verified.",
      },
    };
  });

  const passCount = gatedResults.filter((item) => item.qualityGate.gate === "PASS").length;
  const reviewCount = gatedResults.filter((item) => item.qualityGate.gate === "REVIEW").length;
  const failCount = gatedResults.filter((item) => item.qualityGate.gate === "FAIL").length;
  const evidenceCount = gatedResults.filter((item) => item.qualityGate.checks.evidence && item.qualityGate.checks.evidenceQuote).length;
  const averageConfidence = gatedResults.length ? Math.round(gatedResults.reduce((sum, item) => sum + item.confidence, 0) / gatedResults.length) : 0;
  const blockedCount = sourceRegistry.filter((source) => source.accessStatus === "blocked" || source.accessStatus === "policy_restricted").length;
  const manualCount = sourceRegistry.filter((source) => source.accessStatus === "auth_required" || source.accessStatus === "partial").length;
  const candidatesSeen = Number(parsed?.candidates_seen || rawResults.length);
  const duplicatesRemoved = Math.max(Number(parsed?.duplicates_removed || 0), deduped.removed);

  const queryUnderstanding: ResearchQueryUnderstanding = {
    intent: String(parsed?.query_understanding?.intent || "research"),
    entityType: String(parsed?.query_understanding?.entity_type || "unknown"),
    geography: Array.isArray(parsed?.query_understanding?.geography) ? parsed.query_understanding.geography.map(String) : [],
    languages: Array.isArray(parsed?.query_understanding?.languages) ? parsed.query_understanding.languages.map(String) : [],
    criteria: Array.isArray(parsed?.query_understanding?.criteria) ? parsed.query_understanding.criteria.map(String) : [],
    exclusions: Array.isArray(parsed?.query_understanding?.exclusions) ? parsed.query_understanding.exclusions.map(String) : [],
    requiredFields: Array.isArray(parsed?.query_understanding?.required_fields) ? parsed.query_understanding.required_fields.map(String) : [],
    sourceClasses: Array.isArray(parsed?.query_understanding?.source_classes) ? parsed.query_understanding.source_classes.map(String) : [],
  };

  return NextResponse.json({
    live: true,
    model,
    query,
    generatedAt: retrievedAt,
    elapsedMs: Date.now() - startedAt,
    searchPlan: String(parsed?.search_plan || ""),
    summary: String(parsed?.search_summary || ""),
    queryUnderstanding,
    searchBranches: Array.isArray(parsed?.search_branches) ? parsed.search_branches.map(String).slice(0, 30) : [],
    sourceRegistry,
    accessEvents,
    results: gatedResults,
    sourceUrls: Array.from(sourceUrls),
    sourceDomains: Array.from(sourceDomains),
    stats: {
      sourcesFound: sourceDomains.size,
      sourcesChecked: sourceRegistry.filter((source) => source.accessStatus === "checked").length,
      sourcesBlocked: blockedCount,
      sourcesManualReview: manualCount,
      pagesProcessed: new Set(results.map((result) => result.url).filter(Boolean)).size,
      recordsExtracted: candidatesSeen,
      duplicatesRemoved,
      qualified: passCount + reviewCount,
      evidenceCoverage: gatedResults.length ? Math.round((evidenceCount / gatedResults.length) * 100) : 0,
      averageConfidence,
      supplementalProviderHits: providerHints.length,
    },
    qualityGate: {
      total: gatedResults.length,
      pass: passCount,
      review: reviewCount,
      fail: failCount,
      independentVerification: gatedResults.some((result) => result.independentVerification),
      ruleSet: [
        "source URL present",
        "source name present",
        "evidence summary present",
        "evidence quote present",
        "title present",
        "location present",
        "area or price present",
        "confidence >= 70",
        "source captured",
        "allowed verification status",
      ],
    },
  });
}
