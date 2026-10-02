import { accessEscalationSummary, buildAccessEscalationPlan, type AccessEscalationPlan } from "@/lib/access-escalation";
import type { AccessEvent, LiveSourceRecord, ResearchQueryUnderstanding } from "@/lib/research-contract";

export type BackgroundResearchRequest = {
  query: string;
  language: "ru" | "en";
  depth: "Quick" | "Balanced" | "Deep";
  maxResults: number;
  maxSources: number;
  maxPages: number;
  multilingual: boolean;
  followRelatedLinks: boolean;
  sourceMemory?: Array<{ name?: string; url?: string; domain?: string; category?: string; quality?: number; lastChecked?: string }>;
};

export const BACKGROUND_RESEARCH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    query_understanding: { type: "object", additionalProperties: false, properties: {
      intent: { type: "string" }, entity_type: { type: "string" },
      geography: { type: "array", items: { type: "string" } },
      languages: { type: "array", items: { type: "string" } },
      criteria: { type: "array", items: { type: "string" } },
      exclusions: { type: "array", items: { type: "string" } },
      required_fields: { type: "array", items: { type: "string" } },
      source_classes: { type: "array", items: { type: "string" } },
    }, required: ["intent","entity_type","geography","languages","criteria","exclusions","required_fields","source_classes"] },
    search_plan: { type: "string" },
    search_branches: { type: "array", items: { type: "string" }, maxItems: 40 },
    search_summary: { type: "string" },
    candidates_seen: { type: "integer", minimum: 0 },
    duplicates_removed: { type: "integer", minimum: 0 },
    access_events: { type: "array", maxItems: 120, items: { type: "object", additionalProperties: false, properties: {
      url: { type: "string" }, status: { type: "string" }, method: { type: "string" }, reason: { type: "string" }, fallback: { type: "string" },
    }, required: ["url","status","method","reason","fallback"] } },
    source_registry: { type: "array", maxItems: 180, items: { type: "object", additionalProperties: false, properties: {
      name: { type: "string" }, url: { type: "string" }, domain: { type: "string" }, category: { type: "string" },
      access_status: { type: "string", enum: ["checked","partial","unavailable","blocked","auth_required","policy_restricted","captcha_required","rate_limited","not_automatable"] },
      access_method: { type: "string" }, reason: { type: "string" }, evidence_available: { type: "boolean" }, quality: { type: "integer", minimum: 0, maximum: 100 }, last_checked: { type: "string" },
    }, required: ["name","url","domain","category","access_status","access_method","reason","evidence_available","quality","last_checked"] } },
    results: { type: "array", maxItems: 60, items: { type: "object", additionalProperties: false, properties: {
      title: { type: "string" }, location: { type: "string" }, area: { type: "string" }, price: { type: "string" },
      match: { type: "integer", minimum: 0, maximum: 100 }, confidence: { type: "integer", minimum: 0, maximum: 100 },
      evidence: { type: "string" }, evidence_quote: { type: "string" }, status: { type: "string", enum: ["Verified","Reviewed","Manual review"] },
      source: { type: "string" }, source_type: { type: "string" }, url: { type: "string" }, why: { type: "string" }, retrieved_at: { type: "string" },
      freshness_days: { type: "integer", minimum: 0 }, independent_verification: { type: "boolean" },
    }, required: ["title","location","area","price","match","confidence","evidence","evidence_quote","status","source","source_type","url","why","retrieved_at","freshness_days","independent_verification"] } },
  },
  required: ["query_understanding","search_plan","search_branches","search_summary","candidates_seen","duplicates_removed","access_events","source_registry","results"],
} as const;

function normalize(value: unknown) {
  let text = "";
  if (value === null || value === undefined) text = "";
  else if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else {
    try { text = JSON.stringify(value); } catch { text = ""; }
  }
  return text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9а-яёіїєґ]+/gi, " ").trim();
}
function normalizeUrl(value: unknown) { const raw = String(value ?? "").trim(); try { const u = new URL(raw); u.hash = ""; u.searchParams.sort(); return u.toString().replace(/\/$/, ""); } catch { return raw.replace(/\/$/, ""); } }
function getDomain(value: unknown) { try { return new URL(String(value ?? "")).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }
function unique<T>(items: T[]) { return Array.from(new Set(items)); }
function outputText(response: any) {
  return typeof response?.output_text === "string" ? response.output_text.trim() : "";
}

function parseResearchJson(text: string) {
  const trimmed = text.trim();
  const unfenced = trimmed.replace(/^\s*\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`\s*$/i, "");
  try { return JSON.parse(unfenced); } catch {}
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(unfenced.slice(first, last + 1)); } catch {}
  }
  throw new Error("Background research returned invalid JSON.");
}

function dedupeResults(items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const identity = [normalize(item?.title), normalize(item?.location), normalize(item?.area)].join("|");
    const key = identity || normalizeUrl(item?.url);
    const bucket = groups.get(key) ?? []; bucket.push(item); groups.set(key, bucket);
  }
  const out: any[] = []; let removed = 0;
  for (const bucket of groups.values()) { bucket.sort((a,b) => Number(b?.confidence ?? 0) - Number(a?.confidence ?? 0)); out.push(bucket[0]); removed += Math.max(0, bucket.length - 1); }
  return { out, removed };
}

// NOSONAR - source traversal intentionally handles multiple Responses output shapes.
function collectWebSources(response: any) {
  const sources: Array<{ url: string; title: string; domain: string }> = []; const seen = new Set<string>();
  const push = (source: any) => { const url = normalizeUrl(source?.url); if (!url || seen.has(url)) return; seen.add(url); sources.push({ url, title: String(source?.title ?? ""), domain: getDomain(url) }); };
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type === "web_search_call") for (const source of Array.isArray(item?.action?.sources) ? item.action.sources : []) push(source);
    if (item?.type === "message") for (const part of Array.isArray(item?.content) ? item.content : []) for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) push(annotation);
  }
  return sources;
}

export function buildBackgroundResponseBody(input: BackgroundResearchRequest, systemPrompt: string, providerCatalog: unknown, searchMatrix: unknown) {
  const memory = Array.isArray(input.sourceMemory) ? input.sourceMemory.slice(0, 120) : [];
  const memoryBlock = memory.length > 0 ? JSON.stringify(memory) : "No prior source memory is available yet.";
  const instructions = input.language === "ru"
    ? "Проведи глубокое исследование по запросу. Сначала пойми задачу, географию, критерии и обязательные поля. Создай широкую карту источников и исследуй их. Используй сохраненную память источников, но ищи новые источники. Не считай сниппет проверкой: для результата нужен прямой URL и evidence_quote. Отделяй discovered от checked. Если источник требует CAPTCHA, Cloudflare, auth или rate limit, классифицируй это честно и используй разрешенные альтернативы. Не обходи защиту, не используй чужие аккаунты или cookies и не spoof fingerprint. Возвращай только данные, которые можно подтвердить. В финальном JSON держи source_registry не более 40 записей, access_events не более 30 записей, search_branches не более 20; выдавай максимум maxResults лучших подтвержденных результатов. Не повторяй большие тексты страниц."
    : "Perform deep research. Understand the task, geography, criteria and required fields first. Build a broad source map and research it. Use saved source memory but actively discover new sources. A search snippet is not verification: results need a direct URL and evidence_quote. Distinguish discovered from checked sources. If a source requires CAPTCHA, Cloudflare, auth or rate limit, classify it honestly and use allowed alternatives. Do not bypass access controls, use third-party accounts/cookies, or spoof fingerprints. Return only supportable data. In the final JSON keep source_registry to 40 entries max, access_events to 30 entries max, search_branches to 20 entries max, and return at most maxResults best verified results. Do not repeat large page text.";
  return {
    model: process.env.OPENAI_MODEL || "gpt-5.5", background: true, store: true,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: instructions + "\n\nUSER QUERY:\n" + input.query + "\n\nMODE: " + input.depth + "\nLIMITS: sources=" + input.maxSources + ", urls=" + input.maxPages + ", results=" + input.maxResults + "\nMULTILINGUAL=" + input.multilingual + "\nFOLLOW_RELATED_LINKS=" + input.followRelatedLinks + "\n\nSEARCH PROVIDER CATALOG:\n" + JSON.stringify(providerCatalog) + "\n\nSEARCH MATRIX:\n" + JSON.stringify(searchMatrix) + "\n\nSOURCE MEMORY:\n" + memoryBlock + "\n\nReturn ONLY a single JSON object matching the research contract. Do not use Markdown fences, commentary, or prose outside JSON. Every result must contain a real URL and evidence_quote." },
    ],
    tools: [{ type: "web_search", search_context_size: input.depth === "Deep" ? "high" : "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    reasoning: { effort: input.depth === "Deep" ? "medium" : "low" },
    // Background mode is intentionally kept on plain text output. Structured Outputs have had
    // intermittent background-mode failures; the completed payload is validated locally instead.

    max_output_tokens: input.depth === "Deep" ? 30000 : input.depth === "Balanced" ? 18000 : 12000,
  };
}

export async function startBackgroundResearch(apiKey: string, input: BackgroundResearchRequest, systemPrompt: string, providerCatalog: unknown, searchMatrix: unknown) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(buildBackgroundResponseBody(input, systemPrompt, providerCatalog, searchMatrix)),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data?.error?.message || "Failed to start background research."));
  return data;
}

export async function retrieveBackgroundResponse(apiKey: string, responseId: string) {
  const response = await fetch("https://api.openai.com/v1/responses/" + encodeURIComponent(responseId), {
    headers: { Authorization: "Bearer " + apiKey }, signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data?.error?.message || "Failed to retrieve background research."));
  return data;
}

export async function cancelBackgroundResponse(apiKey: string, responseId: string) {
  const response = await fetch("https://api.openai.com/v1/responses/" + encodeURIComponent(responseId) + "/cancel", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey }, signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(String(data?.error?.message || "Failed to cancel background research."));
  return data;
}

export function backgroundProgress(status: string) {
  if (status === "completed") return { progress: 100, stage: 6, label: "completed" };
  if ([ "failed", "cancelled", "incomplete" ].includes(status)) return { progress: 100, stage: 5, label: status };
  if (status === "queued") return { progress: 8, stage: 0, label: "queued" };
  return { progress: 55, stage: 4, label: "researching" };
}

// NOSONAR - this function is a deterministic normalization pipeline with several required validation stages.
export function normalizeCompletedResearch(response: any, input: BackgroundResearchRequest) {
  const text = outputText(response);
  if (!text) throw new Error("Background research completed without structured output.");
  const parsed = parseResearchJson(text);
  const retrievedSources = collectWebSources(response);
  const sourceUrls = new Set(retrievedSources.map((s) => s.url));
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
  const filtered = rawResults.filter((item: any) => { const url = normalizeUrl(item?.url); return Boolean(url) && (sourceUrls.size === 0 || sourceUrls.has(url) || retrievedSources.some((s) => s.domain === getDomain(url))); });
  const deduped = dedupeResults(filtered); const now = new Date().toISOString();
  const results = deduped.out.slice(0, input.maxResults).map((item: any, i: number) => ({
    id: i + 1, title: String(item?.title || "Untitled result"), location: String(item?.location || "not specified"),
    area: String(item?.area || "not specified"), price: String(item?.price || "not specified"),
    match: Math.max(0, Math.min(100, Number(item?.match || 0))), confidence: Math.max(0, Math.min(100, Number(item?.confidence || 0))),
    evidence: String(item?.evidence || ""), evidenceQuote: String(item?.evidence_quote || ""),
    status: ["Verified","Reviewed","Manual review"].includes(item?.status) ? item.status : "Reviewed",
    source: String(item?.source || "Web source"), sourceType: String(item?.source_type || "web"), sourceDomain: getDomain(item?.url),
    url: normalizeUrl(item?.url), why: String(item?.why || ""), retrievedAt: String(item?.retrieved_at || now),
    freshnessDays: Math.max(0, Number(item?.freshness_days || 0)), independentVerification: Boolean(item?.independent_verification),
  }));
  const sourcePlans: AccessEscalationPlan[] = [];
  const sourceRegistry: LiveSourceRecord[] = (Array.isArray(parsed.source_registry) ? parsed.source_registry : []).slice(0, input.maxSources).map((s: any) => {
    const url = normalizeUrl(s?.url); const plan = buildAccessEscalationPlan({
      url, status: String(s?.access_status || "partial"), requiresAuth: String(s?.access_status || "").toLowerCase() === "auth_required",
      rateLimited: String(s?.access_status || "").toLowerCase() === "rate_limited", captcha: String(s?.access_status || "").toLowerCase() === "captcha_required",
      policyRestricted: String(s?.access_status || "").toLowerCase() === "policy_restricted", reason: String(s?.reason || ""),
    }); sourcePlans.push(plan);
    return { name: String(s?.name || "Unknown source"), url, domain: String(s?.domain || getDomain(url)), category: String(s?.category || "web"),
      accessStatus: plan.status as LiveSourceRecord["accessStatus"], accessMethod: String(s?.access_method || "web_search"), reason: plan.reason,
      evidenceAvailable: Boolean(s?.evidence_available), quality: Math.max(0, Math.min(100, Number(s?.quality || 0))), lastChecked: String(s?.last_checked || now) };
  });
  const accessEvents: AccessEvent[] = (Array.isArray(parsed.access_events) ? parsed.access_events : []).slice(0, 120).map((e: any) => ({
    url: normalizeUrl(e?.url), status: String(e?.status || "partial"), method: String(e?.method || "web_search"), reason: String(e?.reason || ""), fallback: String(e?.fallback || "alternate_source"),
  }));
  const gated = results.map((result: any) => {
    const checks = { sourceUrl: Boolean(result.url), sourceName: Boolean(result.source), evidence: Boolean(result.evidence), evidenceQuote: Boolean(result.evidenceQuote),
      title: Boolean(result.title && result.title !== "Untitled result"), location: Boolean(result.location && result.location !== "not specified"),
      structuredValue: Boolean((result.area && result.area !== "not specified") || (result.price && result.price !== "not specified")), confidence: result.confidence >= 70,
      sourceCaptured: sourceUrls.size === 0 || sourceUrls.has(result.url) || sourceRegistry.some((s) => s.url === result.url || s.domain === result.sourceDomain),
      statusAllowed: ["Verified","Reviewed","Manual review"].includes(result.status) };
    const passed = Object.values(checks).filter(Boolean).length; const total = Object.keys(checks).length; const gate = passed === total ? "PASS" : passed >= Math.ceil(total * 0.75) ? "REVIEW" : "FAIL";
    return { ...result, qualityGate: { gate, passed, total, checks, independentVerification: result.independentVerification } };
  });
  const pass = gated.filter((r: any) => r.qualityGate.gate === "PASS").length; const review = gated.filter((r: any) => r.qualityGate.gate === "REVIEW").length; const fail = gated.filter((r: any) => r.qualityGate.gate === "FAIL").length;
  const evidence = gated.filter((r: any) => r.qualityGate.checks.evidence && r.qualityGate.checks.evidenceQuote).length;
  const queryUnderstanding: ResearchQueryUnderstanding = {
    intent: String(parsed?.query_understanding?.intent || "research"), entityType: String(parsed?.query_understanding?.entity_type || "unknown"),
    geography: Array.isArray(parsed?.query_understanding?.geography) ? parsed.query_understanding.geography.map(String) : [], languages: Array.isArray(parsed?.query_understanding?.languages) ? parsed.query_understanding.languages.map(String) : [],
    criteria: Array.isArray(parsed?.query_understanding?.criteria) ? parsed.query_understanding.criteria.map(String) : [], exclusions: Array.isArray(parsed?.query_understanding?.exclusions) ? parsed.query_understanding.exclusions.map(String) : [],
    requiredFields: Array.isArray(parsed?.query_understanding?.required_fields) ? parsed.query_understanding.required_fields.map(String) : [], sourceClasses: Array.isArray(parsed?.query_understanding?.source_classes) ? parsed.query_understanding.source_classes.map(String) : [],
  };
  const escalation = accessEscalationSummary(sourcePlans); const accessCheckpoints = sourcePlans.flatMap((p) => p.checkpoint?.required ? [p.checkpoint] : []);
  const sourceDomains = unique([...sourceRegistry.map((s) => s.domain), ...results.map((r) => r.sourceDomain)].filter(Boolean));
  return { live: true, partial: false, status: "completed", query: input.query, generatedAt: now, searchPlan: String(parsed?.search_plan || ""), summary: String(parsed?.search_summary || ""),
    queryUnderstanding, searchBranches: Array.isArray(parsed?.search_branches) ? parsed.search_branches.map(String).slice(0, 40) : [], sourceRegistry, accessEvents, accessCheckpoints, results: gated,
    sourceUrls: unique([...retrievedSources.map((s) => s.url), ...sourceRegistry.map((s) => s.url), ...results.map((r) => r.url)].filter(Boolean)), sourceDomains,
    stats: { sourcesFound: sourceDomains.length, sourcesChecked: sourceRegistry.filter((s) => s.accessStatus === "checked").length,
      sourcesBlocked: sourceRegistry.filter((s) => ["blocked","policy_restricted","captcha_required"].includes(s.accessStatus)).length,
      sourcesManualReview: sourceRegistry.filter((s) => ["auth_required","partial","captcha_required","rate_limited"].includes(s.accessStatus)).length,
      pagesProcessed: unique(results.map((r) => r.url).filter(Boolean)).length, recordsExtracted: rawResults.length, duplicatesRemoved: Math.max(Number(parsed?.duplicates_removed || 0), deduped.removed),
      qualified: pass + review, evidenceCoverage: gated.length ? Math.round((evidence / gated.length) * 100) : 0, averageConfidence: gated.length ? Math.round(gated.reduce((sum: number, r: any) => sum + r.confidence, 0) / gated.length) : 0 },
    accessEscalation: escalation, qualityGate: { total: gated.length, pass, review, fail, independentVerification: gated.some((r: any) => r.independentVerification),
      ruleSet: ["source URL present","source name present","evidence summary present","evidence quote present","title present","location present","area or price present","confidence >= 70","source captured","allowed verification status"] },
    billing: { provider: "openai", model: process.env.OPENAI_MODEL || "gpt-5.5", billable: true, webSearchCalls: Array.isArray(response?.output) ? response.output.filter((x: any) => x?.type === "web_search_call").length : 0, usage: response?.usage ?? null, background: true },
    task: { id: response?.id ? "AURE-" + String(response.id).replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase() : "", responseId: String(response?.id || ""), providerStatus: String(response?.status || "") },
  };
}