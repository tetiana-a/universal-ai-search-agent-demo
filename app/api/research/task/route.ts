import { NextResponse } from "next/server";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import { getSearchProviderCatalog, runProviderDiscovery } from "@/lib/provider-search";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { startBackgroundResearch, retrieveBackgroundResponse, cancelBackgroundResponse, backgroundProgress, normalizeCompletedResearch, type BackgroundResearchRequest } from "@/lib/background-research";

export const runtime = "nodejs";
export const maxDuration = 60;

function taskId(responseId: string) { return "AURE-" + responseId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase(); }

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  let body: BackgroundResearchRequest;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 }); }
  const query = String(body.query || "").trim();
  if (!query) return NextResponse.json({ error: "Query is required." }, { status: 400 });
  const language = body.language === "en" ? "en" : "ru";
  const testMode = body.testMode === true;
  const input: BackgroundResearchRequest = {
    query,
    language,
    depth: testMode ? "Quick" : (body.depth || "Deep"),
    maxResults: testMode ? 3 : Math.min(Math.max(Number(body.maxResults || 12), 4), 30),
    maxSources: testMode ? 8 : Math.min(Math.max(Number(body.maxSources || 50), 5), 120),
    maxPages: testMode ? 20 : Math.min(Math.max(Number(body.maxPages || 150), 20), 1500),
    multilingual: testMode ? false : body.multilingual !== false,
    followRelatedLinks: testMode ? false : body.followRelatedLinks !== false,
    testMode,
    sourceMemory: Array.isArray(body.sourceMemory) ? body.sourceMemory.slice(0, 40) : [],
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
  const basePrompt = language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN;
  const prompt = basePrompt + "\n\nSupplemental provider candidates:\n" + JSON.stringify(providerHints).slice(0, 20000);
  try {
    const response = await startBackgroundResearch(apiKey, input, prompt, providerCatalog, searchMatrix);
    const id = String(response?.id || ""); if (!id) throw new Error("OpenAI did not return a background response id.");
    const p = backgroundProgress(String(response?.status || "queued"));
    return NextResponse.json({ live: true, task: { id: taskId(id), responseId: id, status: String(response?.status || "queued"), progress: p.progress, stage: p.stage, createdAt: new Date().toISOString() }, pollAfterMs: 2500 }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start background research.";
    return NextResponse.json({ error: message, stage: "background_start", live: false }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const url = new URL(request.url); const responseId = url.searchParams.get("responseId")?.trim();
  if (!responseId) return NextResponse.json({ error: "responseId is required." }, { status: 400 });
  try {
    const response = await retrieveBackgroundResponse(apiKey, responseId);
    const status = String(response?.status || "queued"); const p = backgroundProgress(status);
    if (status === "completed") {
      const query = url.searchParams.get("query") || ""; const language = url.searchParams.get("language") === "en" ? "en" : "ru";
      const depthParam = url.searchParams.get("depth"); const depth = depthParam === "Quick" || depthParam === "Balanced" ? depthParam : "Deep";
      const input: BackgroundResearchRequest = { query, language, depth, maxResults: Math.min(Math.max(Number(url.searchParams.get("maxResults") || 12), 4), 30), maxSources: Math.min(Math.max(Number(url.searchParams.get("maxSources") || 50), 5), 120), maxPages: Math.min(Math.max(Number(url.searchParams.get("maxPages") || 150), 20), 1500), multilingual: true, followRelatedLinks: true };
      return NextResponse.json(normalizeCompletedResearch(response, input), { headers: { "Cache-Control": "no-store" } });
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
  const apiKey = process.env.OPENAI_API_KEY; if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });
  const url = new URL(request.url); const responseId = url.searchParams.get("responseId")?.trim();
  if (!responseId) return NextResponse.json({ error: "responseId is required." }, { status: 400 });
  try { const response = await cancelBackgroundResponse(apiKey, responseId); const p = backgroundProgress(String(response?.status || "cancelled")); return NextResponse.json({ live: true, task: { id: taskId(responseId), responseId, status: String(response?.status || "cancelled"), progress: p.progress, stage: p.stage } }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel background research." }, { status: 502 }); }
}