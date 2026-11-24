import { buildAnalytics, searchTotals } from "@/lib/analytics";
import { loadAllSources, readRun, readSearchHistory } from "@/lib/memory";
import { safeFilenamePart } from "@/lib/research-report";
import { createCsvBuffer, createJsonBuffer, createXlsxBuffer, neutralizeFormula } from "@/lib/server-exporters";
import { recordsWorkbook } from "@/lib/xlsx-style";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { listAll, logAction, readLog } from "@/lib/scout/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

function file(body: BodyInit, name: string, type: string) {
  return new Response(body, { headers: { ...noStore, "Content-Type": type, "Content-Disposition": "attachment; filename=\"" + name + "\"; filename*=UTF-8''" + encodeURIComponent(name) } });
}

function csv(rows: Record<string, unknown>[]) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cell = (v: unknown) => '"' + neutralizeFormula(typeof v === "object" && v !== null ? JSON.stringify(v) : v ?? "").replace(/"/g, '""') + '"';
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}


// GET ?view=summary — public totals for the home page (no personal data).
// Everything else needs the dashboard key: full analytics, one saved search, downloads.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "summary") return Response.json({ ok: true, ...(await searchTotals()) }, { headers: noStore });
  if (!isAuthorized(request)) return unauthorized();

  const runId = url.searchParams.get("run") || "";
  const format = url.searchParams.get("format") || "";
  const exportWhat = url.searchParams.get("export") || "";

  if (runId && !format) {
    const run = await readRun(runId);
    return run ? Response.json({ ok: true, run }, { headers: noStore }) : Response.json({ ok: false, error: "Поиск не найден (полные результаты хранятся для поисков после обновления)." }, { status: 404 });
  }

  if (runId && format) {
    const run = await readRun(runId);
    if (!run) return Response.json({ ok: false, error: "Поиск не найден." }, { status: 404 });
    const payload = { query: run.query, generatedAt: run.createdAt, stats: run.stats, results: run.results || [], sourceRegistry: run.sourceRegistry || [] };
    const base = "aurelius-" + safeFilenamePart(run.query || "search");
    await logAction({ actor: "human", action: "export." + format, detail: "Аналитика · " + String(run.query).slice(0, 80) });
    if (format === "xlsx") return file(new Uint8Array(await createXlsxBuffer(payload)), base + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    if (format === "csv") return file(new Uint8Array(createCsvBuffer(payload)), base + ".csv", "text/csv; charset=utf-8");
    return file(new Uint8Array(createJsonBuffer(payload)), base + ".json", "application/json");
  }

  if (exportWhat) {
    const stamp = new Date().toISOString().slice(0, 10);
    const [runs, journal] = await Promise.all([readSearchHistory(), readLog(5000)]);
    await logAction({ actor: "human", action: "export." + (format || "json"), detail: "Аналитика · " + exportWhat });
    if (exportWhat === "journal" && format === "csv") return file(csv(journal), "aurelius-journal-" + stamp + ".csv", "text/csv; charset=utf-8");
    if (exportWhat === "runs" && format === "csv") return file(csv(runs), "aurelius-searches-" + stamp + ".csv", "text/csv; charset=utf-8");
    const [sources, groups, posts, campaigns, tasks, analytics] = await Promise.all([
      loadAllSources(), listAll<any>("groups"), listAll<any>("group_posts"), listAll<any>("campaigns"), listAll<any>("campaign_tasks"), buildAnalytics(true),
    ]);
    if (format === "xlsx") {
      const insights = analytics.insights.map((i) => ({ уровень: i.level, вывод: i.title, детали: i.detail }));
      return file(new Uint8Array(await recordsWorkbook({ Выводы: insights, Поиски: runs, Журнал: journal, Источники: sources as any, Сообщества: groups, Публикации: posts, Кампании: campaigns, "Задачи кампаний": tasks })), "aurelius-all-" + stamp + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }
    return file(JSON.stringify({ analytics, searches: runs, journal, sources, groups, posts, campaigns, campaignTasks: tasks }, null, 2), "aurelius-all-" + stamp + ".json", "application/json");
  }

  const [analytics, runs, journal] = await Promise.all([buildAnalytics(url.searchParams.get("fresh") === "1"), readSearchHistory(500), readLog(1000)]);
  return Response.json({ ok: true, analytics, runs, journal }, { headers: noStore });
}
