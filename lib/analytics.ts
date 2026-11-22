import { loadAllSources, readSearchHistory, persistentMemoryConfigured } from "@/lib/memory";
import { listAll, readLog } from "@/lib/scout/store";
import type { LogEntry } from "@/lib/scout/types";

// Platform analytics computed only from stored data (search history, source memory,
// journal, groups, posts, campaigns). Nothing here is estimated or invented: with no
// data every counter is 0 and the insights say so.

export type Insight = { level: "risk" | "warn" | "good" | "idea"; title: string; detail: string };

const DAY = 86_400_000;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const dayOf = (iso: string) => String(iso || "").slice(0, 10);
const norm = (q: string) => String(q || "").toLowerCase().replace(/\s+/g, " ").trim();
const isError = (e: LogEntry) => /error|fail|block/i.test(e.action);

function countBy<T>(items: T[], key: (item: T) => string) {
  const out: Record<string, number> = {};
  for (const item of items) { const k = key(item) || "—"; out[k] = (out[k] || 0) + 1; }
  return out;
}

// One summary row per search; cheap enough for the home page.
export async function searchTotals() {
  const runs = await readSearchHistory();
  const sum = (k: string) => runs.reduce((acc, r) => acc + n(r?.[k]), 0);
  return {
    persistent: persistentMemoryConfigured(),
    searches: runs.length,
    results: sum("results"),
    verified: sum("verified"),
    qualified: sum("qualified"),
    duplicatesRemoved: sum("duplicatesRemoved"),
    // Older history rows only stored sourceCount.
    sourcesFound: runs.reduce((acc, r) => acc + n(r?.sourcesFound ?? r?.sourceCount), 0),
    sourcesChecked: sum("sourcesChecked"),
    pagesProcessed: sum("pagesProcessed"),
    lastSearchAt: runs[0]?.createdAt || null,
  };
}

let cache: { at: number; value: Awaited<ReturnType<typeof compute>> } | null = null;

export async function buildAnalytics(fresh = false) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}

async function compute() {
  const [runs, sources, journal, groups, posts, queue, campaigns, tasks] = await Promise.all([
    readSearchHistory(),
    loadAllSources(),
    readLog(5000),
    listAll<any>("groups"),
    listAll<any>("group_posts"),
    listAll<any>("group_queue"),
    listAll<any>("campaigns"),
    listAll<any>("campaign_tasks"),
  ]);
  const now = Date.now();
  const since = (days: number) => (iso: string) => now - Date.parse(iso) < days * DAY;
  const totals = await searchTotals();

  const zeroRuns = runs.filter((r) => n(r.results) === 0);
  const week = runs.filter((r) => since(7)(r.createdAt)).length;
  const prevWeek = runs.filter((r) => !since(7)(r.createdAt) && since(14)(r.createdAt)).length;

  const health = { healthy: 0, degraded: 0, failing: 0, unknown: 0 } as Record<string, number>;
  for (const s of sources) health[s.healthStatus || "unknown"] = (health[s.healthStatus || "unknown"] || 0) + 1;
  const topSources = sources.filter((s) => s.resultCount > 0).sort((a, b) => b.quality - a.quality || b.resultCount - a.resultCount).slice(0, 10)
    .map((s) => ({ domain: s.domain, quality: s.quality, results: s.resultCount, verified: s.verifiedCount, checks: s.checks, health: s.healthStatus || "unknown" }));
  const weakSources = sources.filter((s) => s.healthStatus === "failing" || s.healthStatus === "degraded").sort((a, b) => n(b.consecutiveFailures) - n(a.consecutiveFailures)).slice(0, 10)
    .map((s) => ({ domain: s.domain, failures: n(s.failedChecks), lastError: s.lastError || "", health: s.healthStatus || "unknown" }));

  const sent = posts.filter((p) => p.status === "sent" || p.status === "published").length;
  const failedPosts = posts.filter((p) => p.status === "failed").length;
  const pending = queue.filter((q) => q.status === "pending");
  const stalePending = pending.filter((q) => !since(2)(q.createdAt)).length;

  const errors = journal.filter(isError);
  const errors7 = errors.filter((e) => since(7)(e.at));
  const actionKinds = countBy(journal, (e) => e.action.split(".")[0]);

  // Daily activity for the last 14 days: searches and journal actions.
  const daily = Array.from({ length: 14 }, (_, i) => {
    const day = dayOf(new Date(now - (13 - i) * DAY).toISOString());
    return {
      day,
      searches: runs.filter((r) => dayOf(r.createdAt) === day).length,
      actions: journal.filter((e) => dayOf(e.at) === day).length,
      errors: errors.filter((e) => dayOf(e.at) === day).length,
    };
  });

  // Queries asked repeatedly with weak results: the system should refine them.
  const byQuery = new Map<string, { query: string; runs: number; results: number }>();
  for (const r of runs) {
    const k = norm(r.query);
    if (!k) continue;
    const row = byQuery.get(k) || { query: r.query, runs: 0, results: 0 };
    row.runs += 1; row.results += n(r.results);
    byQuery.set(k, row);
  }
  const queries = Array.from(byQuery.values());
  const bestQueries = queries.filter((q) => q.results > 0).sort((a, b) => b.results / b.runs - a.results / a.runs).slice(0, 5);
  const weakQueries = queries.filter((q) => q.runs >= 2 && q.results / q.runs < 3).slice(0, 5);

  const data = {
    generatedAt: new Date().toISOString(),
    persistent: persistentMemoryConfigured(),
    totals: {
      ...totals,
      searchesWeek: week,
      searchesPrevWeek: prevWeek,
      zeroResultSearches: zeroRuns.length,
      telegramSearches: runs.filter((r) => r.origin === "telegram").length,
      avgResults: runs.length ? Math.round((totals.results / runs.length) * 10) / 10 : 0,
      verifiedShare: pct(totals.verified, totals.results),
      knownSources: sources.length,
      sourceHealth: health,
      groups: groups.length,
      groupsByPlatform: countBy(groups, (g) => g.platform),
      groupsByStatus: countBy(groups, (g) => g.status),
      botReadyGroups: groups.filter((g) => g.botConnected && g.postingEnabled).length,
      postsSent: sent,
      postsFailed: failedPosts,
      postSuccess: pct(sent, sent + failedPosts),
      queuePending: pending.length,
      campaigns: campaigns.length,
      campaignsByStatus: countBy(campaigns, (c) => c.status),
      campaignTasksByStatus: countBy(tasks, (t) => t.status),
      journalEntries: journal.length,
      errorsWeek: errors7.length,
      advisorQuestions: journal.filter((e) => e.action === "advisor.ask").length,
      exports: journal.filter((e) => e.action.startsWith("export.")).length,
    },
    actionKinds,
    daily,
    topSources,
    weakSources,
    bestQueries,
    weakQueries,
    recentErrors: errors.slice(0, 10),
    insights: [] as Insight[],
  };
  data.insights = insightsFor(data, { zeroRuns: zeroRuns.length, stalePending, errors7 });
  return data;
}

function insightsFor(a: Omit<Awaited<ReturnType<typeof compute>>, "insights"> & { insights?: Insight[] }, x: { zeroRuns: number; stalePending: number; errors7: LogEntry[] }): Insight[] {
  const t = a.totals;
  const out: Insight[] = [];
  if (!a.persistent) out.push({ level: "risk", title: "История не сохраняется навсегда", detail: "Хранилище Redis (KV_REST_API_URL/TOKEN) не подключено: после перезапуска сервера журнал и поиски пропадут." });
  if (!t.searches) out.push({ level: "idea", title: "Ещё нет сохранённых поисков", detail: "Запустите первый поиск на главной или командой в Telegram: с этого момента каждый поиск, его результаты и источники сохраняются здесь." });
  if (t.searches && pct(x.zeroRuns, t.searches) >= 30) out.push({ level: "risk", title: pct(x.zeroRuns, t.searches) + "% поисков без результатов", detail: x.zeroRuns + " из " + t.searches + " поисков ничего не нашли. Частые причины: закончился лимит ключа поиска (Jina/Gemini) или слишком узкий запрос. Проверьте ключи в Vercel и уточните формулировки." });
  if (t.results >= 20 && t.verifiedShare < 25) out.push({ level: "warn", title: "Мало подтверждённых результатов: " + t.verifiedShare + "%", detail: "Большинство находок не прошли проверку доказательств. Добавьте в запрос конкретные критерии (город, цена, тип) — это поднимет точность." });
  if (t.searchesWeek > t.searchesPrevWeek && t.searchesPrevWeek > 0) out.push({ level: "good", title: "Активность растёт", detail: "За 7 дней " + t.searchesWeek + " поисков против " + t.searchesPrevWeek + " неделей раньше." });
  if (a.weakSources.length) out.push({ level: "warn", title: a.weakSources.length + " источников работают со сбоями", detail: "Система уже понижает их в приоритете: " + a.weakSources.slice(0, 4).map((s) => s.domain).join(", ") + "." });
  if (a.topSources.length) out.push({ level: "good", title: "Лучшие источники определены", detail: "Чаще всего дают результат: " + a.topSources.slice(0, 4).map((s) => s.domain + " (" + s.quality + ")").join(", ") + ". Они подставляются в похожие поиски автоматически." });
  if (a.weakQueries.length) out.push({ level: "idea", title: "Запросы, которые стоит переформулировать", detail: a.weakQueries.map((q) => "«" + q.query.slice(0, 60) + "» (" + q.runs + " раз, в среднем " + Math.round(q.results / q.runs) + ")").join("; ") + "." });
  if (t.groups && !t.botReadyGroups) out.push({ level: "idea", title: "Бот не добавлен ни в одну группу", detail: "В базе " + t.groups + " сообществ, но автопубликация возможна только там, где админ добавил @AURELIUS8_bot. Начните с 3–5 групп со статусом «бесплатно» или «обмен»." });
  if (t.postsFailed && t.postSuccess < 80) out.push({ level: "risk", title: "Публикации с ошибками: " + (100 - t.postSuccess) + "%", detail: t.postsFailed + " постов не ушли. Откройте журнал (фильтр «groups») и проверьте права бота в этих группах." });
  if (x.stalePending) out.push({ level: "warn", title: x.stalePending + " постов ждут ручной публикации больше 2 дней", detail: "Очередь на странице «Группы»: опубликуйте или отметьте «пропущено», чтобы план кампаний был честным." });
  const drafts = n(t.campaignsByStatus["draft"]);
  if (drafts) out.push({ level: "idea", title: drafts + " кампаний ждут одобрения", detail: "Пока кампания не одобрена, бот не строит план публикаций." });
  if (x.errors7.length) {
    const top = Object.entries(countBy(x.errors7, (e) => e.action)).sort((p, q) => q[1] - p[1])[0];
    out.push({ level: "risk", title: x.errors7.length + " ошибок за неделю", detail: "Чаще всего: " + top[0] + " (" + top[1] + "). Последняя: " + String(x.errors7[0].detail || "").slice(0, 140) });
  }
  return out;
}

// Compact text of the real numbers for the advisor prompt.
export function analyticsBrief(a: Awaited<ReturnType<typeof compute>>) {
  const t = a.totals;
  const lines = [
    "РЕАЛЬНЫЕ ДАННЫЕ ПЛАТФОРМЫ AURELIUS на " + a.generatedAt.slice(0, 16).replace("T", " ") + " UTC (из журнала и базы, не выдумывай другие цифры):",
    "Поиски: всего " + t.searches + " (за 7 дней " + t.searchesWeek + ", неделей раньше " + t.searchesPrevWeek + "; из Telegram " + t.telegramSearches + "); без результатов " + t.zeroResultSearches + "; результатов " + t.results + " (в среднем " + t.avgResults + " на поиск), подтверждено " + t.verified + " (" + t.verifiedShare + "%), дублей удалено " + t.duplicatesRemoved + ".",
    "Источники в памяти: " + t.knownSources + " (рабочих " + n(t.sourceHealth.healthy) + ", со сбоями " + n(t.sourceHealth.degraded) + ", не работают " + n(t.sourceHealth.failing) + ").",
    "Лучшие источники: " + (a.topSources.map((s) => s.domain + " q" + s.quality + "/" + s.results + "рез.").join(", ") || "нет данных") + ".",
    "Проблемные источники: " + (a.weakSources.map((s) => s.domain + " (" + s.lastError.slice(0, 50) + ")").join(", ") || "нет") + ".",
    "Лучшие запросы: " + (a.bestQueries.map((q) => "«" + q.query.slice(0, 50) + "» " + q.results + " рез./" + q.runs).join("; ") || "нет данных") + ".",
    "Слабые запросы: " + (a.weakQueries.map((q) => "«" + q.query.slice(0, 50) + "» " + q.runs + " раз").join("; ") || "нет") + ".",
    "Сообщества: " + t.groups + " " + JSON.stringify(t.groupsByPlatform) + ", статусы " + JSON.stringify(t.groupsByStatus) + ", бот может публиковать в " + t.botReadyGroups + ".",
    "Публикации: успешно " + t.postsSent + ", ошибок " + t.postsFailed + " (успех " + t.postSuccess + "%), в ручной очереди " + t.queuePending + ".",
    "Кампании: " + t.campaigns + " " + JSON.stringify(t.campaignsByStatus) + ", задачи " + JSON.stringify(t.campaignTasksByStatus) + ".",
    "Журнал: " + t.journalEntries + " действий, ошибок за неделю " + t.errorsWeek + ", вопросов советнику " + t.advisorQuestions + ", выгрузок " + t.exports + ".",
    "Активность по дням (дата: поиски/действия/ошибки): " + a.daily.filter((d) => d.actions || d.searches).map((d) => d.day.slice(5) + ": " + d.searches + "/" + d.actions + "/" + d.errors).join(", ") + ".",
    "Выводы системы: " + (a.insights.map((i) => "[" + i.level + "] " + i.title).join("; ") || "нет") + ".",
  ];
  return lines.join("\n");
}
