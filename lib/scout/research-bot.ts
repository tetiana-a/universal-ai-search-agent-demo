import { cancelBackgroundResponse, normalizeCompletedResearch, retrieveBackgroundResponse, startBackgroundResearch, type BackgroundResearchRequest } from "@/lib/background-research";
import { editionFor, pipelineFor } from "@/lib/editions";
import { runFreeResearch } from "@/lib/free-research";
import { getResearchMemoryContext, recordResearchLearning } from "@/lib/memory";
import { getPlans } from "@/lib/plans";
import { getSearchProviderCatalog } from "@/lib/provider-search";
import { counterRows, formatNumber, reportCounters, type ReportCounters } from "@/lib/report-model";
import type { ResearchExportPayload } from "@/lib/research-report";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU, taskSpecificRules } from "@/lib/research-prompts";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { createCsvBuffer, createXlsxBuffer } from "@/lib/server-exporters";
import { buildTelegramMessages } from "@/lib/telegram-report";
import { applyClarifications, clarifyingQuestions, fieldSchemaFor, type ClarifyingQuestion } from "@/lib/task-profile";
import { deleteValue, getValue, listAll, logAction, putOne, setValue } from "@/lib/scout/store";
import { editMessage, sendDocument, sendMessage, tgCall, type Keyboard } from "@/lib/scout/telegram";
import { escapeHtml, randomId } from "@/lib/scout/text";

// The universal research agent in Telegram (the main TZ): a task in plain language →
// clarifying questions → rounds of the same research pipeline the web app uses →
// live counters in one status message (stop / change criteria / continue) →
// summary cards + CSV and Excel files. One active task per chat, kept in Redis.

export type ResearchLang = "ru" | "en";
export type TaskState = "clarifying" | "running" | "stopped" | "done" | "failed";
export type ResearchStage = "clarifying" | "queued" | "searching" | "merging" | "delivering" | "completed" | "stopped" | "failed";
export type ResearchTaskEvent = { at: string; stage: ResearchStage; note?: string };
export type ResearchQuality = {
  score: number;
  evidenceCoverage: number;
  gatePassRate: number;
  verifiedRate: number;
  reviewRate: number;
  sourceDiversity: number;
};

export type ResearchTask = {
  id: string;
  chatId: string;
  ownerId: string;
  lang: ResearchLang;
  baseQuery: string;
  query: string;
  kind: string;
  questions: ClarifyingQuestion[];
  answers: Record<string, string>;
  step: number;
  state: TaskState;
  stage: ResearchStage;
  attempt: number;
  events: ResearchTaskEvent[];
  round: number;
  seenUrls: string[];
  canContinue: boolean;
  results: any[];
  sources: any[];
  counters: ReportCounters;
  quality: ResearchQuality;
  summary?: string;
  statusMessageId?: number;
  runId?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
};

export type RoundOutcome = {
  results?: any[];
  sourceRegistry?: any[];
  progressCounters?: Partial<ReportCounters>;
  stats?: Record<string, any>;
  summary?: string;
  continuation?: { round?: number; seenUrls?: string[]; canContinue?: boolean };
};

export type RoundRunner = (input: { query: string; lang: ResearchLang; round: number; seenUrls: string[]; deadlineAt: number }) => Promise<RoundOutcome>;

const TASK_KEY = "research:";
const STOP_KEY = "research-stop:";
const EMPTY_COUNTERS: ReportCounters = { sourcesDiscovered: 0, sourcesInBase: 0, sourcesChecked: 0, sourcesUnavailable: 0, resultsFound: 0, afterDedupe: 0, filteredOut: 0, matchingCriteria: 0, needsReview: 0 };
const UNAVAILABLE = new Set(["unavailable", "blocked", "auth_required", "policy_restricted", "captcha_required", "rate_limited", "not_automatable"]);

const TEXT = {
  ru: {
    start: "🧭 <b>Новая задача</b>",
    question: (i: number, n: number) => "Уточнение " + i + " из " + n,
    skip: "Пропустить",
    goNow: "Искать сейчас",
    running: "⏳ <b>Идёт поиск</b>",
    round: (n: number) => "Раунд " + n,
    stopped: "⏹ <b>Поиск остановлен</b>",
    done: "✅ <b>Поиск завершён</b>",
    failed: "⚠️ <b>Поиск не выполнен</b>",
    stop: "⏹ Остановить",
    edit: "✏️ Изменить критерии",
    more: "▶️ Продолжить поиск",
    fresh: "🆕 Новая задача",
    askEdit: "Напишите, что изменить или добавить в критерии (ответом на это сообщение).",
    stopAck: "Остановлю после текущего шага и пришлю то, что уже найдено.",
    busy: "Сейчас идёт другой поиск в этом чате. Остановите его или дождитесь результата.",
    none: "В этом чате нет активной задачи. Просто напишите, что найти.",
    files: "Файлы с полной таблицей результатов",
    nothing: "Подходящих результатов пока нет. Попробуйте «Продолжить поиск» или измените критерии.",
    unknown: "Причина неизвестна",
  },
  en: {
    start: "🧭 <b>New task</b>",
    question: (i: number, n: number) => "Question " + i + " of " + n,
    skip: "Skip",
    goNow: "Search now",
    running: "⏳ <b>Searching</b>",
    round: (n: number) => "Round " + n,
    stopped: "⏹ <b>Search stopped</b>",
    done: "✅ <b>Search finished</b>",
    failed: "⚠️ <b>Search failed</b>",
    stop: "⏹ Stop",
    edit: "✏️ Change criteria",
    more: "▶️ Continue search",
    fresh: "🆕 New task",
    askEdit: "Reply to this message with what to change or add to the criteria.",
    stopAck: "Stopping after the current step; you'll get what has been found so far.",
    busy: "Another search is running in this chat. Stop it or wait for the result.",
    none: "There is no active task in this chat. Just write what to find.",
    files: "Files with the full results table",
    nothing: "No matching results yet. Try “Continue search” or change the criteria.",
    unknown: "Unknown reason",
  },
};

export function detectResearchLang(text: string): ResearchLang {
  return /[а-яёіїєґ]/i.test(text) ? "ru" : "en";
}

export function newTask(chatId: string, ownerId: string, text: string): ResearchTask {
  const lang = detectResearchLang(text);
  const baseQuery = text.trim().slice(0, 1800);
  const analysis = clarifyingQuestions(baseQuery);
  const now = new Date().toISOString();
  return {
    id: "TG-" + Date.now().toString(36).toUpperCase(),
    chatId, ownerId, lang, baseQuery, query: baseQuery, kind: analysis.kind,
    questions: analysis.questions, answers: {}, step: 0,
    state: analysis.questions.length ? "clarifying" : "running",
    stage: analysis.questions.length ? "clarifying" : "queued",
    attempt: 0,
    events: [{ at: now, stage: analysis.questions.length ? "clarifying" : "queued", note: "task created" }],
    round: 0, seenUrls: [], canContinue: true, results: [], sources: [],
    counters: { ...EMPTY_COUNTERS }, quality: { score: 0, evidenceCoverage: 0, gatePassRate: 0, verifiedRate: 0, reviewRate: 0, sourceDiversity: 0 }, startedAt: now, updatedAt: now,
  };
}

function urlKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/$/, "") : "";
}

function researchQuality(results: any[]): ResearchQuality {
  if (!results.length) return { score: 0, evidenceCoverage: 0, gatePassRate: 0, verifiedRate: 0, reviewRate: 0, sourceDiversity: 0 };
  const pct = (n: number) => Math.round((100 * n) / results.length);
  const evidence = results.filter((r) => Boolean(r?.qualityGate?.checks?.evidenceGrounded || r?.evidenceQuote || r?.evidence)).length;
  const pass = results.filter((r) => String(r?.qualityGate?.gate || "").toUpperCase() === "PASS").length;
  const verified = results.filter((r) => r?.status === "Verified").length;
  const review = results.filter((r) => r?.status === "Manual review" || String(r?.qualityGate?.gate || "").toUpperCase() === "REVIEW").length;
  const domains = new Set(results.map((r) => {
    try { return new URL(String(r?.url || "")).hostname.replace(/^www\./, ""); } catch { return String(r?.sourceDomain || ""); }
  }).filter(Boolean));
  const sourceDiversity = Math.min(100, Math.round((100 * domains.size) / results.length));
  const evidenceCoverage = pct(evidence);
  const gatePassRate = pct(pass);
  const verifiedRate = pct(verified);
  const reviewRate = pct(review);
  // Aggregate score is a reporting signal only; individual critical failures still keep
  // their own result in REVIEW/FAIL and are never hidden by this average.
  const score = Math.round(evidenceCoverage * 0.4 + gatePassRate * 0.3 + verifiedRate * 0.2 + sourceDiversity * 0.1);
  return { score, evidenceCoverage, gatePassRate, verifiedRate, reviewRate, sourceDiversity };
}

function checkpoint(task: ResearchTask, stage: ResearchStage, note?: string) {
  const at = new Date().toISOString();
  task.stage = stage;
  task.updatedAt = at;
  task.events = [...(task.events || []), { at, stage, note }].slice(-40);
  return task;
}

export type ResearchTaskSummary = Pick<ResearchTask, "id" | "chatId" | "ownerId" | "query" | "kind" | "state" | "stage" | "attempt" | "round" | "counters" | "quality" | "error" | "startedAt" | "updatedAt">;

export async function listRecentResearchTasks(limit = 30): Promise<ResearchTaskSummary[]> {
  const tasks = await listAll<ResearchTask>("research_tasks");
  return tasks
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(({ id, chatId, ownerId, query, kind, state, stage, attempt, round, counters, quality, error, startedAt, updatedAt }) => ({
      id, chatId, ownerId, query, kind, state, stage: stage || (state === "done" ? "completed" : state === "failed" ? "failed" : state === "stopped" ? "stopped" : state === "clarifying" ? "clarifying" : "searching"), attempt: attempt || 0, round, counters, quality: quality || researchQuality([]), error, startedAt, updatedAt,
    }));
}

// Folds one pipeline round into the task: results and sources are de-duplicated by URL,
// counters are recomputed over everything found so far.
export function mergeRound(task: ResearchTask, outcome: RoundOutcome): ResearchTask {
  const results = [...task.results];
  const seen = new Set(results.map((r) => urlKey(r?.url)).filter(Boolean));
  let duplicates = 0;
  for (const item of outcome.results || []) {
    const key = urlKey(item?.url);
    if (key && seen.has(key)) { duplicates += 1; continue; }
    if (key) seen.add(key);
    results.push(item);
  }
  results.sort((a, b) => Number(b?.match || 0) - Number(a?.match || 0));

  // The source map is re-sent every round: a known source is updated when a later round
  // actually checked it (or found it unavailable), and is not counted as discovered again.
  const sources = [...task.sources];
  const sourceIndex = new Map(sources.map((s, i) => [urlKey(s?.url) || String(s?.domain || ""), i] as const));
  let alreadyKnown = 0;
  for (const item of outcome.sourceRegistry || []) {
    const key = urlKey(item?.url) || String(item?.domain || "");
    if (!key) continue;
    const at = sourceIndex.get(key);
    if (at === undefined) { sourceIndex.set(key, sources.length); sources.push(item); continue; }
    alreadyKnown += 1;
    if (sources[at]?.accessStatus === "partial" && item?.accessStatus && item.accessStatus !== "partial") sources[at] = item;
  }

  const round = outcome.progressCounters || {};
  const counters: ReportCounters = {
    sourcesDiscovered: task.counters.sourcesDiscovered + Math.max(0, Number(round.sourcesDiscovered || 0) - alreadyKnown),
    sourcesInBase: Math.max(task.counters.sourcesInBase, Number(round.sourcesInBase || 0)),
    sourcesChecked: sources.filter((s) => s?.accessStatus === "checked").length,
    sourcesUnavailable: sources.filter((s) => UNAVAILABLE.has(String(s?.accessStatus))).length,
    resultsFound: task.counters.resultsFound + Number(round.resultsFound || outcome.results?.length || 0),
    afterDedupe: results.length,
    filteredOut: Number(task.counters.filteredOut || 0) + Number(round.filteredOut || 0),
    matchingCriteria: results.filter((r) => (r?.status === "Verified" || r?.status === "Reviewed") && (r?.pageType || "entity") === "entity").length,
    needsReview: results.filter((r) => r?.status === "Manual review").length,
  };
  counters.sourcesDiscovered = Math.max(counters.sourcesDiscovered, sources.length);
  counters.resultsFound = Math.max(counters.resultsFound, results.length + duplicates);

  const next = outcome.continuation || {};
  return {
    ...task,
    results: results.slice(0, 200),
    sources: sources.slice(0, 600),
    counters,
    quality: researchQuality(results),
    round: Math.max(task.round + 1, Number(next.round || 0)),
    seenUrls: [...new Set([...task.seenUrls, ...(next.seenUrls || [])])].slice(-400),
    canContinue: next.canContinue !== false,
    summary: outcome.summary || task.summary,
    updatedAt: new Date().toISOString(),
  };
}

export function toPayload(task: ResearchTask): ResearchExportPayload {
  return {
    query: task.query,
    generatedAt: task.updatedAt,
    language: task.lang,
    taskKind: task.kind,
    fieldSchema: fieldSchemaFor(task.kind as any),
    searchSummary: task.summary,
    results: task.results,
    sourceRegistry: task.sources,
    progressCounters: task.counters,
    stats: { rounds: task.round, qualityScore: task.quality?.score || 0, evidenceCoverage: task.quality?.evidenceCoverage || 0, verifiedRate: task.quality?.verifiedRate || 0 },
  };
}

export function statusText(task: ResearchTask) {
  const t = TEXT[task.lang];
  const head = task.state === "running" ? t.running : task.state === "stopped" ? t.stopped : task.state === "failed" ? t.failed : t.done;
  const rows = counterRows(reportCounters(toPayload(task)), task.lang)
    .map((row) => "• " + escapeHtml(row.label) + ": <b>" + formatNumber(row.value, task.lang) + "</b>");
  const lines = [
    head + (task.round ? " · " + t.round(task.round + (task.state === "running" ? 1 : 0)) : ""),
    "Этап: <b>" + escapeHtml(task.stage || task.state) + "</b> · попытка: <b>" + String(task.attempt || 0) + "</b>",
    ...(task.results.length ? ["Качество: <b>" + String(task.quality?.score || 0) + "%</b> · evidence <b>" + String(task.quality?.evidenceCoverage || 0) + "%</b> · verified <b>" + String(task.quality?.verifiedRate || 0) + "%</b>"] : []),
    "<blockquote>" + escapeHtml(task.query.slice(0, 500)) + "</blockquote>",
    ...rows,
  ];
  if (task.state === "failed") lines.push("", escapeHtml(task.error || t.unknown));
  return lines.join("\n");
}

export function statusKeyboard(task: ResearchTask): Keyboard {
  const t = TEXT[task.lang];
  if (task.state === "running") return [[{ text: t.stop, callback_data: "rs:stop" }, { text: t.edit, callback_data: "rs:edit" }]];
  const row = [{ text: t.edit, callback_data: "rs:edit" }, { text: t.fresh, callback_data: "rs:new" }];
  return task.canContinue || task.state === "stopped" ? [[{ text: t.more, callback_data: "rs:more" }], row] : [row];
}

// ---- Pipeline round: the same code paths as /api/research/task ----------------------

export const defaultRunner: RoundRunner = async ({ query, lang, round, seenUrls, deadlineAt }) => {
  const plan = getPlans().pro; // control chats belong to the owner: Pro budgets
  const memory = await getResearchMemoryContext(query, 40);
  const input: BackgroundResearchRequest = {
    query, language: lang, depth: "Balanced",
    maxResults: Math.min(plan.maxResults, 20), maxSources: Math.min(plan.maxSources, 60), maxPages: Math.min(plan.maxPages, 200),
    multilingual: true, followRelatedLinks: true, testMode: false,
    deadlineAt, sourceMemory: memory.sources, edition: editionFor(plan),
    continuation: round > 0 || seenUrls.length ? { round, excludeUrls: seenUrls } : undefined,
    knownSourceCount: memory.sources.length,
  };
  let result: any;
  if (pipelineFor(plan) === "paid" && process.env.OPENAI_API_KEY) result = await runPaidRound(String(process.env.OPENAI_API_KEY), input, deadlineAt);
  else result = await runFreeResearch(input);
  await Promise.race([
    recordResearchLearning({ taskId: String(result?.task?.responseId || ""), query, sourceRegistry: result?.sourceRegistry || [], results: result?.results || [], stats: result?.stats || {} }),
    new Promise((resolve) => setTimeout(resolve, 1800)),
  ]);
  return {
    results: result?.results,
    sourceRegistry: result?.sourceRegistry,
    progressCounters: result?.progressCounters,
    stats: result?.stats,
    summary: result?.summary || result?.searchSummary,
    continuation: result?.continuation ?? { canContinue: false },
  };
};

async function runPaidRound(apiKey: string, input: BackgroundResearchRequest, deadlineAt: number) {
  const prompt = (input.language === "ru" ? UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU : UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN) + taskSpecificRules(input.query, input.language);
  const started = await startBackgroundResearch(apiKey, input, prompt, getSearchProviderCatalog(), buildSearchMatrix(input.query, input.language));
  const id = String(started?.id || "");
  if (!id) throw new Error("OpenAI did not return a background response id.");
  while (Date.now() < deadlineAt) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await retrieveBackgroundResponse(apiKey, id);
    const status = String(response?.status || "");
    if (status === "completed") return { ...normalizeCompletedResearch(response, input), continuation: { canContinue: false } };
    if (["failed", "cancelled", "incomplete"].includes(status)) throw new Error(String(response?.error?.message || response?.incomplete_details?.reason || status));
  }
  await cancelBackgroundResponse(apiKey, id).catch(() => null);
  throw new Error(input.language === "ru" ? "Глубокий поиск не уложился во время одного шага." : "Deep research did not finish within one step.");
}

// ---- Storage ---------------------------------------------------------------------------

export async function loadTask(chatId: string) {
  return getValue<ResearchTask>(TASK_KEY + chatId);
}

export async function saveTask(task: ResearchTask) {
  await Promise.all([
    setValue(TASK_KEY + task.chatId, task),
    putOne("research_tasks", task),
  ]);
}

async function stopRequested(chatId: string) {
  return Boolean(await getValue<boolean>(STOP_KEY + chatId));
}

export async function requestResearchStop(chatId: string, actor = "human") {
  const task = await loadTask(chatId);
  if (!task || (task.state !== "running" && task.state !== "clarifying")) return { ok: false, task, message: "active task not found" };
  if (task.state === "clarifying") {
    task.state = "stopped";
    checkpoint(task, "stopped", "cancelled before search started");
    await saveTask(task);
    await deleteValue(STOP_KEY + chatId);
    await logAction({ actor: actor === "bot" ? "bot" : "human", action: "research.stopped", detail: task.id + " · before search" });
    return { ok: true, task, message: "stopped" };
  }
  await setValue(STOP_KEY + chatId, true, 15 * 60);
  await logAction({ actor: actor === "bot" ? "bot" : "human", action: "research.stop_requested", detail: task.id + " · " + task.query.slice(0, 100) });
  return { ok: true, task, message: "stop requested" };
}

// ---- Conversation ----------------------------------------------------------------------

async function askQuestion(task: ResearchTask) {
  const t = TEXT[task.lang];
  const q = task.questions[task.step];
  const text = (task.step === 0 ? t.start + "\n<blockquote>" + escapeHtml(task.baseQuery.slice(0, 500)) + "</blockquote>\n\n" : "") +
    "❓ <i>" + t.question(task.step + 1, task.questions.length) + "</i>\n<b>" + escapeHtml(task.lang === "ru" ? q.ru : q.en) + "</b>\n<i>" + escapeHtml(task.lang === "ru" ? q.placeholderRu : q.placeholderEn) + "</i>";
  await sendMessage(task.chatId, text, [[{ text: t.skip, callback_data: "rs:skip" }, { text: t.goNow, callback_data: "rs:go" }]]);
}

export type Background = () => Promise<void>;

// A plain-language task from a control chat. Returns background work when the search starts.
export async function startResearch(chatId: string, ownerId: string, text: string, runner: RoundRunner = defaultRunner): Promise<Background | undefined> {
  const current = await loadTask(chatId);
  if (current?.state === "running" && Date.now() - Date.parse(current.updatedAt) < 6 * 60_000) {
    await sendMessage(chatId, TEXT[current.lang].busy, statusKeyboard(current));
    return undefined;
  }
  const task = newTask(chatId, ownerId, text);
  await deleteValue(STOP_KEY + chatId);
  await logAction({ actor: "human", action: "research.start", detail: task.baseQuery.slice(0, 120) });
  if (task.state === "clarifying") {
    checkpoint(task, "clarifying", "awaiting clarification");
    await saveTask(task);
    await askQuestion(task);
    return undefined;
  }
  return beginRun(task, runner);
}

// The next message in a chat with a pending question is its answer.
export async function answerQuestion(task: ResearchTask, text: string, runner: RoundRunner = defaultRunner): Promise<Background | undefined> {
  const q = task.questions[task.step];
  if (q) task.answers[q.id] = text.trim().slice(0, 200);
  return nextQuestionOrRun(task, runner);
}

async function nextQuestionOrRun(task: ResearchTask, runner: RoundRunner) {
  task.step += 1;
  if (task.step < task.questions.length) {
    await saveTask(task);
    await askQuestion(task);
    return undefined;
  }
  return beginRun(task, runner);
}

async function beginRun(task: ResearchTask, runner: RoundRunner): Promise<Background> {
  task.query = applyClarifications(task.baseQuery, task.answers, task.lang);
  task.state = "running";
  task.runId = randomId("run");
  task.attempt = Number(task.attempt || 0) + 1;
  checkpoint(task, "queued", "run " + task.runId + " queued");
  const sent = await sendMessage(task.chatId, statusText(task), statusKeyboard(task));
  task.statusMessageId = sent.messageId;
  await saveTask(task);
  return () => runRounds(task.chatId, runner);
}

// Runs pipeline rounds until the result set is good enough, the source pool is exhausted,
// the user presses Stop, or the time budget of this invocation runs out.
export async function runRounds(chatId: string, runner: RoundRunner = defaultRunner, budgetMs = Number(process.env.TG_RESEARCH_BUDGET_MS || 230_000)) {
  const until = Date.now() + budgetMs;
  const maxRounds = Math.max(1, Number(process.env.TG_RESEARCH_ROUNDS || 3));
  let task = await loadTask(chatId);
  if (!task?.runId) return;
  checkpoint(task, "searching", "background worker started");
  await saveTask(task);
  const runId = task.runId;
  // A newer run (changed criteria, continue) owns the chat: this one exits without writing.
  const superseded = async () => (await loadTask(chatId))?.runId !== runId;
  for (let i = 0; i < maxRounds; i++) {
    if (await stopRequested(chatId)) { task.state = "stopped"; checkpoint(task, "stopped", "stop requested"); break; }
    if (Date.now() + 60_000 > until) break;
    try {
      checkpoint(task, "searching", "round " + (task.round + 1) + " started");
      await saveTask(task);
      const outcome = await runner({ query: task.query, lang: task.lang, round: task.round, seenUrls: task.seenUrls, deadlineAt: Math.min(until, Date.now() + 70_000) - 4000 });
      checkpoint(task, "merging", "round results received");
      task = mergeRound(task, outcome);
    } catch (error) {
      task.error = error instanceof Error ? error.message.slice(0, 400) : TEXT[task.lang].unknown;
      if (!task.results.length) task.state = "failed";
      checkpoint(task, task.results.length ? "merging" : "failed", task.error);
      break;
    }
    if (await superseded()) return;
    await saveTask(task);
    if (task.statusMessageId) await editMessage(task.chatId, task.statusMessageId, statusText(task), statusKeyboard(task));
    if (!task.canContinue || task.counters.matchingCriteria >= 15) break;
  }
  if (await superseded()) return;
  if (task.state === "running") task.state = "done";
  checkpoint(task, task.state === "done" ? "delivering" : task.state === "stopped" ? "stopped" : "failed", "research rounds finished");
  await deleteValue(STOP_KEY + chatId);
  await saveTask(task);
  await logAction({ actor: "bot", action: "research." + task.state, detail: task.results.length + " results · " + task.query.slice(0, 80) });
  await deliver(task);
  if (task.state === "done") {
    checkpoint(task, "completed", "delivery completed");
    await saveTask(task);
  }
}

async function deliver(task: ResearchTask) {
  const t = TEXT[task.lang];
  if (task.statusMessageId) await editMessage(task.chatId, task.statusMessageId, statusText(task));
  if (task.state === "failed") {
    await sendMessage(task.chatId, statusText(task), statusKeyboard(task));
    return;
  }
  const payload = toPayload(task);
  const messages = buildTelegramMessages(payload, 10);
  for (const [i, html] of messages.entries()) await sendMessage(task.chatId, html, i === messages.length - 1 && !task.results.length ? statusKeyboard(task) : undefined);
  if (!task.results.length) {
    if (!messages.length) await sendMessage(task.chatId, t.nothing, statusKeyboard(task));
    return;
  }
  const name = "aurelius-" + task.id.toLowerCase();
  await sendDocument(task.chatId, name + ".xlsx", await createXlsxBuffer(payload), "📊 " + t.files);
  await sendDocument(task.chatId, name + ".csv", createCsvBuffer(payload), undefined, statusKeyboard(task));
}

// ---- Buttons and replies -----------------------------------------------------------------

export async function handleResearchCallback(chatId: string, action: string, callbackId: string, runner: RoundRunner = defaultRunner): Promise<Background | undefined> {
  const task = await loadTask(chatId);
  const answer = (text: string) => tgCall("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) });
  if (!task) { await answer(TEXT.ru.none); return undefined; }
  const t = TEXT[task.lang];
  if (action === "stop") {
    await requestResearchStop(chatId, "human");
    await answer(t.stopAck);
    return undefined;
  }
  if (action === "skip" && task.state === "clarifying") { await answer("✓"); return nextQuestionOrRun(task, runner); }
  if (action === "go" && task.state === "clarifying") { await answer("✓"); task.step = task.questions.length - 1; return nextQuestionOrRun(task, runner); }
  if (action === "more" && task.state !== "running") {
    await answer("✓");
    await deleteValue(STOP_KEY + chatId);
    return beginRun(task, runner);
  }
  if (action === "edit") {
    await answer("✓");
    await setValue("research-edit:" + chatId, true, 30 * 60);
    await tgCall("sendMessage", { chat_id: chatId, text: t.askEdit, reply_markup: { force_reply: true, selective: true } });
    return undefined;
  }
  if (action === "new") {
    await answer("✓");
    await deleteValue(TASK_KEY + chatId);
    await sendMessage(chatId, t.none);
    return undefined;
  }
  await answer("—");
  return undefined;
}

// Text that changes the criteria of the current task: the base query keeps the original
// ask, new criteria are appended, and the search restarts from the accumulated source base.
export async function applyCriteriaChange(chatId: string, text: string, runner: RoundRunner = defaultRunner): Promise<Background | undefined> {
  const task = await loadTask(chatId);
  await deleteValue("research-edit:" + chatId);
  if (!task) return startResearch(chatId, "", text, runner);
  const label = task.lang === "ru" ? "Изменение критериев" : "Changed criteria";
  const changed: ResearchTask = {
    ...task,
    baseQuery: applyClarifications(task.baseQuery, task.answers, task.lang) + "\n" + label + ": " + text.trim().slice(0, 400),
    answers: {}, questions: [], step: 0, round: 0, seenUrls: [], canContinue: true,
    results: [], sources: [], counters: { ...EMPTY_COUNTERS }, quality: researchQuality([]), error: undefined,
    stage: "queued",
    events: [...(task.events || []), { at: new Date().toISOString(), stage: "queued", note: "criteria changed" }].slice(-40),
  };
  await deleteValue(STOP_KEY + chatId);
  await logAction({ actor: "human", action: "research.criteria", detail: text.slice(0, 120) });
  return beginRun(changed, runner);
}

export async function isEditingCriteria(chatId: string) {
  return Boolean(await getValue<boolean>("research-edit:" + chatId));
}
