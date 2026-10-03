import { NextResponse } from "next/server";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import { getSearchProviderCatalog, runProviderDiscovery } from "@/lib/provider-search";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { startBackgroundResearch, retrieveBackgroundResponse, cancelBackgroundResponse, backgroundProgress, normalizeCompletedResearch, type BackgroundResearchRequest } from "@/lib/background-research";
import { runFreeResearch } from "@/lib/free-research";
import { getResearchMemoryContext, recordResearchLearning } from "@/lib/memory";
import { errorBody } from "@/lib/research-errors";
import { checkResearchQuota, clampToPlan, publicPlanInfo, refundResearchQuota, resolvePlan } from "@/lib/plans";
import { taskSpecificRules } from "@/lib/research-prompts";
import { isSafePublicUrl } from "@/lib/url-safety";

export const runtime = "nodejs";
export const maxDuration = 60;

// Client-supplied source memory is untrusted: keep only public http(s) URLs and plain fields.
function sanitizeSourceMemory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((item: any) => {
    const url = String(item?.url || "").trim();
    if (url && !isSafePublicUrl(url)) return [];
    return [{
      name: String(item?.name || "").slice(0, 160),
      url,
      domain: String(item?.domain || "").slice(0, 120),
      category: String(item?.category || "").slice(0, 60),
      quality: Number(item?.quality || 0),
      lastChecked: String(item?.lastChecked || ""),
    }];
  });
}

async function readJson(request: Request) {
  try { return { ok: true as const, body: await request.json() }; } catch { return { ok: false as const, body: null }; }
}

function taskId(responseId: string) { return "AURE-" + responseId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase(); }

export async function POST(request: Request) {
  const provider = (process.env.RESEARCH_AI_PROVIDER || "free").toLowerCase();
  const parsed = await readJson(request);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid JSON request body.", code: "INVALID_REQUEST" }, { status: 400 });
  const body: any = parsed.body || {};
  const query = String(body?.query || "").trim();
  if (!query) return NextResponse.json({ error: "Query is required.", code: "INVALID_REQUEST" }, { status: 400 });
  if (query.length > 2000) return NextResponse.json({ error: "Query is too long (max 2000 characters).", code: "INVALID_REQUEST" }, { status: 400 });

  const plan = resolvePlan(request);
  const quota = await checkResearchQuota(request, plan);
  if (!quota.allowed) {
    const e = errorBody(quota.error);
    return NextResponse.json({ ...e.body, plan: publicPlanInfo(plan), usage: quota.usage }, { status: e.status });
  }
  const planInfo = { ...publicPlanInfo(plan), usage: quota.usage };
  const language = body?.language === "en" ? "en" : "ru";
  const testMode = body?.testMode === true;
  const limits = clampToPlan(plan, { depth: testMode ? "Quick" : body?.depth, maxResults: body?.maxResults, maxSources: body?.maxSources, maxPages: body?.maxPages });

  if (provider === "free") {
    try {
      const memoryContext = await getResearchMemoryContext(query, 40);
      const input: BackgroundResearchRequest = {
        query,
        language,
        depth: limits.depth,
        maxResults: testMode ? 3 : Math.min(limits.maxResults, 15),
        maxSources: testMode ? 8 : Math.min(limits.maxSources, 30),
        maxPages: testMode ? 20 : Math.min(limits.maxPages, 200),
        multilingual: testMode ? false : body?.multilingual !== false,
        followRelatedLinks: testMode ? false : body?.followRelatedLinks !== false,
        testMode,
        deadlineAt: Date.now() + (maxDuration - 6) * 1000,
        sourceMemory: [...memoryContext.sources, ...sanitizeSourceMemory(body?.sourceMemory)].slice(0, 60),
      };
      const result = await runFreeResearch(input);
      await Promise.race([
        recordResearchLearning({
          taskId: String(result?.task?.responseId || result?.task?.id || ""),
          query,
          sourceRegistry: result?.sourceRegistry || [],
          results: result?.results || [],
          stats: result?.stats || {},
        }),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
      return NextResponse.json({ ...result, memory: { persistent: memoryContext.persistent }, plan: planInfo }, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const e = errorBody(error, "Free research failed.");
      if (e.status >= 500) {
        await refundResearchQuota(request, plan);
        planInfo.usage = { ...quota.usage, used: Math.max(0, quota.usage.used - 1), remaining: Math.min(quota.usage.limit, quota.usage.remaining + 1) };
      }
      return NextResponse.json({ ...e.body, plan: planInfo }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured.", code: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
  const memoryContext = await getResearchMemoryContext(query, 40);
  const input: BackgroundResearchRequest = {
    query,
    language,
    depth: limits.depth,
    maxResults: testMode ? 3 : Math.max(4, limits.maxResults),
    maxSources: testMode ? 8 : limits.maxSources,
    maxPages: testMode ? 20 : limits.maxPages,
    multilingual: testMode ? false : body.multilingual !== false,
    followRelatedLinks: testMode ? false : body.followRelatedLinks !== false,
    testMode,
    sourceMemory: [...memoryContext.sources, ...sanitizeSourceMemory(body.sourceMemory)].slice(0, 60),
  };
  const providerCatalog = getSearchProviderCatalog();
  const searchMatrix = buildSearchMatrix(query, language);
  let providerHints: unknown[] = [];
  if (!testMode && process.env.SUPPLEMENTAL_SEARCH_ENABLED !== "false") {
    try {
      providerHints = await Promise.race([
        runProviderDiscovery(query, language),
        new Promise<unknown[]>((resolve) => setTimeout(() => resolve([]), Number(process.env.SUPPLEMENTAL_SEARCH_TIMEOUT_MS || 5000))),
      ]);
    } catch { providerHints = []; }
  }
  const basePrompt = (language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN) + taskSpecificRules(query, language);
  const prompt = basePrompt + "\n\nSupplemental provider candidates:\n" + JSON.stringify(providerHints).slice(0, 20000);
  try {
    const response = await startBackgroundResearch(apiKey, input, prompt, providerCatalog, searchMatrix);
    const id = String(response?.id || ""); if (!id) throw new Error("OpenAI did not return a background response id.");
    const p = backgroundProgress(String(response?.status || "queued"));
    return NextResponse.json({ live: true, task: { id: taskId(id), responseId: id, status: String(response?.status || "queued"), progress: p.progress, stage: p.stage, createdAt: new Date().toISOString() }, pollAfterMs: 2500, plan: planInfo }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start background research.";
    return NextResponse.json({ error: message, code: "SEARCH_PROVIDERS_FAILED", stage: "background_start", live: false }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const provider = (process.env.RESEARCH_AI_PROVIDER || "free").toLowerCase();
  if (provider === "free") return NextResponse.json({ error: "Free research tasks are completed in the initial request; polling is not required." }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const url = new URL(request.url); const responseId = url.searchParams.get("responseId")?.trim();
  if (!responseId) return NextResponse.json({ error: "responseId is required." }, { status: 400 });
  try {
    const response = await retrieveBackgroundResponse(apiKey, responseId);
    const status = String(response?.status || "queued"); const p = backgroundProgress(status);
    if (status === "completed") {
      const query = url.searchParams.get("query") || "";
      const memoryContext = await getResearchMemoryContext(query, 40);
      const language = url.searchParams.get("language") === "en" ? "en" : "ru";
      const depthParam = url.searchParams.get("depth"); const depth = depthParam === "Quick" || depthParam === "Balanced" ? depthParam : "Deep";
      const input: BackgroundResearchRequest = { query, language, depth, maxResults: Math.min(Math.max(Number(url.searchParams.get("maxResults") || 12), 4), 30), maxSources: Math.min(Math.max(Number(url.searchParams.get("maxSources") || 50), 5), 120), maxPages: Math.min(Math.max(Number(url.searchParams.get("maxPages") || 150), 20), 1500), multilingual: true, followRelatedLinks: true };
      const result = normalizeCompletedResearch(response, input);
      await Promise.race([
        recordResearchLearning({
          taskId: String(responseId),
          query,
          sourceRegistry: result?.sourceRegistry || [],
          results: result?.results || [],
          stats: result?.stats || {},
        }),
        new Promise((resolve) => setTimeout(resolve, 1800)),
      ]);
      return NextResponse.json({ ...result, memory: { persistent: memoryContext.persistent } }, { headers: { "Cache-Control": "no-store" } });
    }
    if ([ "failed", "cancelled", "incomplete" ].includes(status)) {
      const reason = String(response?.incomplete_details?.reason || response?.error?.message || ("Background research ended with status: " + status));
      return NextResponse.json({ live: true, partial: true, task: { id: taskId(responseId), responseId, status, progress: 95, stage: 5 }, error: reason, incompleteDetails: response?.incomplete_details || null }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ live: true, task: { id: taskId(responseId), responseId, status, progress: p.progress, stage: p.stage } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrieve background research.";
    return NextResponse.json({ error: message, stage: "background_poll", live: false, responseId }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const provider = (process.env.RESEARCH_AI_PROVIDER || "free").toLowerCase();
  if (provider === "free") return NextResponse.json({ live: true, cancelled: true, status: "cancelled" }, { headers: { "Cache-Control": "no-store" } });
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const url = new URL(request.url); const responseId = url.searchParams.get("responseId")?.trim();
  if (!responseId) return NextResponse.json({ error: "responseId is required." }, { status: 400 });
  try { const response = await cancelBackgroundResponse(apiKey, responseId); const p = backgroundProgress(String(response?.status || "cancelled")); return NextResponse.json({ live: true, task: { id: taskId(responseId), responseId, status: String(response?.status || "cancelled"), progress: p.progress, stage: p.stage } }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel background research." }, { status: 502 }); }
}