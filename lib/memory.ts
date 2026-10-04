import { inferResearchKind } from "@/lib/relevance-gate";

export type SourceHealth = "healthy" | "degraded" | "failing" | "unknown";

export type SourceMemoryRecord = {
  id: string;
  name: string;
  url: string;
  domain: string;
  category: string;
  quality: number;
  checks: number;
  successfulChecks: number;
  evidenceCount: number;
  resultCount: number;
  verifiedCount: number;
  reviewCount: number;
  duplicateCount: number;
  blockedCount: number;
  captchaCount: number;
  lastChecked: string;
  lastSuccessfulAt?: string;
  languages: string[];
  taskTypes: string[];
  queryExamples: string[];
  // Source Health: consecutive failed reads demote a source; a successful read restores it.
  healthStatus?: SourceHealth;
  consecutiveFailures?: number;
  failedChecks?: number;
  lastError?: string;
  sampleUrls?: string[];
};

export type ResearchLearningInput = {
  taskId?: string;
  query: string;
  sourceRegistry?: Array<any>;
  results?: Array<any>;
  stats?: Record<string, any>;
};

const SOURCE_INDEX_KEY = "aurelius:memory:source-index:v1";
const SEARCH_HISTORY_KEY = "aurelius:memory:search-history:v1";
const LEARNED_TASK_PREFIX = "aurelius:memory:learned-task:v1:";

const localSources = new Map<string, SourceMemoryRecord>();
const localHistory: any[] = [];

function redisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
}

function redisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}

export function persistentMemoryConfigured() {
  return Boolean(redisUrl() && redisToken());
}

export async function redisCommand<T = any>(command: string, args: Array<string | number> = []): Promise<T | null> {
  const base = redisUrl();
  const token = redisToken();
  if (!base || !token) return null;

  try {
    const response = await fetch(base, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command, ...args]),
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload?.result ?? null;
  } catch {
    return null;
  }
}

export async function redisPipeline(commands: Array<[string, ...Array<string | number>]>): Promise<any[]> {
  const base = redisUrl();
  const token = redisToken();
  if (!base || !token || !commands.length) return [];

  try {
    const response = await fetch(base + "/pipeline", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload.map((item) => item?.result) : [];
  } catch {
    return [];
  }
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яёіїєґ]+/gi, " ")
    .trim();
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "s_" + (hash >>> 0).toString(16);
}

function safeDomain(value: unknown) {
  try {
    return new URL(String(value || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function sourceKey(id: string) {
  return "aurelius:memory:source:v1:" + id;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function scoreSource(source: SourceMemoryRecord) {
  const evidenceRate = source.checks ? source.evidenceCount / source.checks : 0;
  const verifiedRate = source.resultCount ? source.verifiedCount / source.resultCount : 0;
  const accessRate = source.checks ? source.successfulChecks / source.checks : 0;
  const duplicateRate = source.resultCount + source.duplicateCount
    ? source.duplicateCount / (source.resultCount + source.duplicateCount)
    : 0;

  return Math.round(
    clamp(
      100 *
        (
          evidenceRate * 0.35 +
          verifiedRate * 0.30 +
          accessRate * 0.20 +
          (1 - duplicateRate) * 0.15
        ),
    ),
  );
}

function sourceFromRegistry(item: any, query: string): SourceMemoryRecord | null {
  const url = String(item?.url || "").trim();
  const domain = String(item?.domain || safeDomain(url)).trim().toLowerCase();
  if (!domain) return null;

  // One record per domain: different pages of the same site are the same source.
  const id = stableId("domain:" + domain);
  const kind = inferResearchKind(query);
  return {
    id,
    name: String(item?.name || domain),
    url,
    domain,
    category: String(item?.category || "web").trim(),
    quality: clamp(Number(item?.quality || 0)),
    checks: 0,
    successfulChecks: 0,
    evidenceCount: 0,
    resultCount: 0,
    verifiedCount: 0,
    reviewCount: 0,
    duplicateCount: 0,
    blockedCount: 0,
    captchaCount: 0,
    lastChecked: String(item?.lastChecked || new Date().toISOString()),
    languages: [],
    taskTypes: [kind],
    queryExamples: [query].filter(Boolean),
    healthStatus: "unknown",
    consecutiveFailures: 0,
    failedChecks: 0,
    sampleUrls: url ? [url] : [],
  };
}

const FAILED_ACCESS = new Set(["unavailable", "blocked", "auth_required", "policy_restricted", "captcha_required", "rate_limited", "not_automatable"]);

export function healthFor(source: Pick<SourceMemoryRecord, "consecutiveFailures" | "successfulChecks" | "checks">): SourceHealth {
  const failures = Number(source.consecutiveFailures || 0);
  if (failures >= 3) return "failing";
  if (failures > 0) return "degraded";
  return source.successfulChecks > 0 ? "healthy" : "unknown";
}

async function loadAllSources(): Promise<SourceMemoryRecord[]> {
  if (!persistentMemoryConfigured()) return Array.from(localSources.values());

  const ids = await redisCommand<string[]>("SMEMBERS", [SOURCE_INDEX_KEY]);
  const normalizedIds = Array.isArray(ids) ? ids.slice(0, 600) : [];
  if (!normalizedIds.length) return [];

  const rows = await redisPipeline(normalizedIds.map((id) => ["GET", sourceKey(id)]));
  const result: SourceMemoryRecord[] = [];
  for (const row of rows) {
    if (!row) continue;
    try {
      const parsed = typeof row === "string" ? JSON.parse(row) : row;
      if (parsed?.id) result.push(parsed);
    } catch {
      // Ignore corrupt legacy memory entries instead of breaking research.
    }
  }
  return result;
}

async function saveSources(sources: SourceMemoryRecord[]) {
  const limited = sources
    .sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))
    .slice(0, 600);

  if (!persistentMemoryConfigured()) {
    localSources.clear();
    for (const source of limited) localSources.set(source.id, source);
    return;
  }

  const commands: Array<[string, ...Array<string | number>]> = [];
  for (const source of limited) {
    commands.push(["SADD", SOURCE_INDEX_KEY, source.id]);
    commands.push(["SET", sourceKey(source.id), JSON.stringify(source)]);
  }
  if (commands.length) await redisPipeline(commands);
}

async function appendSearchHistory(entry: any) {
  const record = JSON.stringify(entry);
  if (!persistentMemoryConfigured()) {
    localHistory.unshift(entry);
    localHistory.splice(200);
    return;
  }

  await redisPipeline([
    ["LPUSH", SEARCH_HISTORY_KEY, record],
    ["LTRIM", SEARCH_HISTORY_KEY, 0, 199],
  ]);
}

async function wasTaskLearned(taskId: string) {
  if (!taskId) return false;
  if (!persistentMemoryConfigured()) return false;
  const value = await redisCommand<string>("GET", [LEARNED_TASK_PREFIX + taskId]);
  return Boolean(value);
}

async function markTaskLearned(taskId: string) {
  if (!taskId || !persistentMemoryConfigured()) return;
  await redisCommand("SET", [LEARNED_TASK_PREFIX + taskId, "1", "EX", 86400]);
}

function querySimilarity(query: string, source: SourceMemoryRecord) {
  const qTokens = new Set(normalizeText(query).split(/\s+/).filter((x) => x.length > 2));
  if (!qTokens.size) return 0;

  const haystack = normalizeText(
    [
      source.name,
      source.domain,
      source.category,
      ...source.taskTypes,
      ...source.queryExamples,
    ].join(" "),
  );
  let hits = 0;
  for (const token of qTokens) if (haystack.includes(token)) hits += 1;
  return hits / qTokens.size;
}

export async function getResearchMemoryContext(query: string, limit = 40) {
  const sources = await loadAllSources();
  const kind = inferResearchKind(query);
  const ranked = sources
    .filter((source) => (source.healthStatus || "unknown") !== "failing")
    .map((source) => {
      const similarity = querySimilarity(query, source);
      const sameKind = Array.isArray(source.taskTypes) && source.taskTypes.includes(kind) && kind !== "general";
      return { source, similarity, sameKind, rank: similarity * 0.5 + (sameKind ? 0.2 : 0) + Number(source.quality || 0) / 100 * 0.3 };
    })
    // Only reuse sources that are related to this task; unrelated high-quality sources only add noise.
    .filter((entry) => entry.similarity > 0 || entry.sameKind)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(1, Math.min(limit, 80)));

  return {
    persistent: persistentMemoryConfigured(),
    sources: ranked.map(({ source }) => ({
      name: source.name,
      url: source.url,
      domain: source.domain,
      category: source.category,
      quality: source.quality,
      lastChecked: source.lastChecked,
      taskTypes: source.taskTypes,
      healthStatus: source.healthStatus || "unknown",
    })),
  };
}

export async function recordResearchLearning(input: ResearchLearningInput) {
  const taskId = String(input.taskId || "").trim();
  if (taskId && (await wasTaskLearned(taskId))) {
    return { persisted: persistentMemoryConfigured(), skipped: true, learnedSources: 0 };
  }

  const now = new Date().toISOString();
  const query = String(input.query || "");
  const registry = Array.isArray(input.sourceRegistry) ? input.sourceRegistry : [];
  const results = Array.isArray(input.results) ? input.results : [];
  const stats = input.stats || {};

  const existing = await loadAllSources();
  const byId = new Map(existing.map((source) => [source.id, source]));
  let learnedSources = 0;

  // Collapse a run's registry to one entry per domain; the best access outcome wins.
  const statusRank = (item: any) => {
    const status = String(item?.accessStatus || item?.access_status || "partial");
    return status === "checked" ? 0 : FAILED_ACCESS.has(status) ? 2 : 1;
  };
  const perDomain = new Map<string, any>();
  for (const item of registry) {
    const domain = String(item?.domain || safeDomain(item?.url)).trim().toLowerCase();
    if (!domain) continue;
    const previous = perDomain.get(domain);
    if (!previous || statusRank(item) < statusRank(previous)) perDomain.set(domain, item);
  }

  for (const item of perDomain.values()) {
    const candidate = sourceFromRegistry(item, query);
    if (!candidate) continue;

    const current = byId.get(candidate.id) || candidate;
    const accessStatus = String(item?.accessStatus || item?.access_status || "partial");
    const sourceResults = results.filter((result) => {
      const resultDomain = safeDomain(result?.url);
      return resultDomain && (resultDomain === current.domain || resultDomain === safeDomain(current.url));
    });

    const verified = sourceResults.filter((result) => String(result?.status || "").toLowerCase() === "verified");
    const review = sourceResults.filter((result) => String(result?.status || "").toLowerCase() === "manual review" || String(result?.status || "").toLowerCase() === "reviewed");
    const gatePass = sourceResults.filter((result) => String(result?.qualityGate?.gate || "") === "PASS");

    const readSucceeded = accessStatus === "checked";
    const readFailed = FAILED_ACCESS.has(accessStatus);
    // "partial" means the page was discovered but not read: it is neither a success nor a failure.
    if (readSucceeded || readFailed) current.checks += 1;
    if (readSucceeded) {
      current.successfulChecks += 1;
      current.consecutiveFailures = 0;
      current.lastError = undefined;
    } else if (readFailed) {
      current.failedChecks = Number(current.failedChecks || 0) + 1;
      current.consecutiveFailures = Number(current.consecutiveFailures || 0) + 1;
      current.lastError = accessStatus + (item?.reason ? ": " + String(item.reason).slice(0, 160) : "");
    }
    current.healthStatus = healthFor(current);
    if (Boolean(item?.evidenceAvailable || item?.evidence_available) || sourceResults.some((result) => result?.evidence || result?.evidenceQuote)) current.evidenceCount += 1;
    current.resultCount += sourceResults.length;
    current.verifiedCount += verified.length + gatePass.length;
    current.reviewCount += review.length;
    current.blockedCount += ["blocked", "policy_restricted", "auth_required", "rate_limited"].includes(accessStatus) ? 1 : 0;
    current.captchaCount += accessStatus === "captcha_required" ? 1 : 0;
    current.duplicateCount += Math.max(0, Math.min(Number(stats.duplicatesRemoved || 0), sourceResults.length));
    current.lastChecked = now;
    if (sourceResults.length || accessStatus === "checked") current.lastSuccessfulAt = now;
    current.quality = scoreSource(current);
    current.queryExamples = Array.from(new Set([...current.queryExamples, query].filter(Boolean))).slice(-12);
    current.taskTypes = Array.from(new Set([...(current.taskTypes || []), ...candidate.taskTypes].filter(Boolean))).slice(-12);
    current.name = current.name || candidate.name;
    if (candidate.url && (readSucceeded || sourceResults.length)) {
      current.sampleUrls = Array.from(new Set([candidate.url, ...(current.sampleUrls || [])])).slice(0, 5);
      current.url = candidate.url;
    }
    current.url = current.url || candidate.url;
    current.domain = current.domain || candidate.domain;
    current.category = current.category || candidate.category;

    byId.set(current.id, current);
    learnedSources += 1;
  }

  const learned = Array.from(byId.values());
  await saveSources(learned);
  await appendSearchHistory({
    taskId,
    query,
    createdAt: now,
    results: results.length,
    verified: results.filter((result) => String(result?.status || "").toLowerCase() === "verified").length,
    duplicatesRemoved: Number(stats.duplicatesRemoved || 0),
    qualified: Number(stats.qualified || results.length),
    sourceCount: registry.length,
    persistent: persistentMemoryConfigured(),
  });

  if (taskId) await markTaskLearned(taskId);

  return { persisted: persistentMemoryConfigured(), skipped: false, learnedSources };
}

export async function getMemoryHealth() {
  const sources = await loadAllSources();
  const health = { healthy: 0, degraded: 0, failing: 0, unknown: 0 } as Record<SourceHealth, number>;
  for (const source of sources) health[source.healthStatus || "unknown"] += 1;
  return {
    persistent: persistentMemoryConfigured(),
    sourceCount: sources.length,
    health,
    backend: persistentMemoryConfigured() ? "upstash-redis-rest" : "process-memory-fallback",
  };
}
