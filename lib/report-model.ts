import type { ReportResult, ResearchExportPayload } from "@/lib/research-report";
import { compactText } from "@/lib/research-report";
import { inferResearchKind, type ResearchKind } from "@/lib/relevance-gate";
import { fieldSchemaFor, type FieldDef } from "@/lib/task-profile";
import { pageTypeLabel } from "@/lib/page-kind";

// One description of a finished research run, shared by every output format
// (CSV, XLSX, PDF, Telegram) so they all show the same columns, counters and labels.

export type ReportLanguage = "ru" | "en";

export type ReportCounters = {
  sourcesDiscovered: number;
  sourcesInBase: number;
  sourcesChecked: number;
  sourcesUnavailable: number;
  resultsFound: number;
  afterDedupe: number;
  matchingCriteria: number;
  needsReview: number;
};

const KIND_LABEL: Record<ResearchKind, [string, string]> = {
  real_estate: ["Недвижимость", "Real estate"],
  investor: ["Инвесторы", "Investors"],
  company: ["Компании", "Companies"],
  person: ["Специалисты", "People"],
  general: ["Общий поиск", "General research"],
};

const COUNTER_LABEL: Array<[keyof ReportCounters, string, string]> = [
  ["sourcesDiscovered", "Источников обнаружено", "Sources discovered"],
  ["sourcesChecked", "Источников проверено", "Sources checked"],
  ["sourcesUnavailable", "Недоступно для автоанализа", "Not automatable"],
  ["resultsFound", "Результатов найдено", "Results found"],
  ["afterDedupe", "После удаления дублей", "After de-duplication"],
  ["matchingCriteria", "Соответствуют критериям", "Match the criteria"],
  ["needsReview", "Нужна ручная проверка", "Need manual review"],
  ["sourcesInBase", "В накопленной базе источников", "In the source base"],
];

export function reportLanguage(payload: ResearchExportPayload): ReportLanguage {
  const declared = String(payload.language || "").toLowerCase();
  if (declared === "ru" || declared === "en") return declared;
  return /[а-яё]/i.test(String(payload.query || "")) ? "ru" : "en";
}

export function reportKind(payload: ResearchExportPayload): ResearchKind {
  const declared = String(payload.taskKind || "") as ResearchKind;
  return declared && declared in KIND_LABEL ? declared : inferResearchKind(String(payload.query || ""));
}

export function kindLabel(kind: ResearchKind, lang: ReportLanguage) {
  return KIND_LABEL[kind][lang === "ru" ? 0 : 1];
}

// Columns for the results table: the task's own fields, without the generic tail
// (source / link / status), which every format renders in its own way.
export function reportColumns(payload: ResearchExportPayload): FieldDef[] {
  // fieldSchema comes from the browser, so it is checked and trimmed before use.
  const declared: FieldDef[] = Array.isArray(payload.fieldSchema) ? payload.fieldSchema : [];
  const valid = declared
    .filter((f) => f && typeof f.key === "string" && typeof f.ru === "string" && typeof f.en === "string" && /^[a-zA-Z_]{1,40}$/.test(f.key))
    .map((f) => ({ key: f.key, ru: compactText(f.ru, 40), en: compactText(f.en, 40) }));
  const schema = valid.length ? valid : fieldSchemaFor(reportKind(payload));
  return schema.filter((f) => !["source", "url", "status"].includes(f.key)).slice(0, 8);
}

export function fieldValue(item: ReportResult, key: string) {
  const raw = item?.[key];
  let text = raw === undefined || raw === null ? "" : String(raw).replace(/\s+/g, " ").trim();
  if (/^(not specified|unknown|n\/a|—|-)$/i.test(text)) text = "";
  if (!text && key === "organization") text = String(item.title || "");
  if (!text && key === "title") text = String(item.organization || item.sourceDomain || "");
  if (!text && key === "location") text = String(item.geography || "");
  if (!text && key === "geography") text = String(item.location || "");
  if (!text && key === "ticket") text = String(item.stage || item.price || "");
  return text;
}

export function resultName(item: ReportResult) {
  return String(item.organization || item.title || item.sourceDomain || item.source || "—").trim();
}

export type StatusTone = "ok" | "partial" | "review" | "fail";

export function statusInfo(item: ReportResult, lang: ReportLanguage): { label: string; tone: StatusTone } {
  const base = baseStatus(item, lang);
  const kind = pageTypeLabel(String(item.pageType || ""), lang);
  return kind ? { label: base.label + " · " + kind, tone: base.tone } : base;
}

function baseStatus(item: ReportResult, lang: ReportLanguage): { label: string; tone: StatusTone } {
  const gate = String(item.qualityGate?.gate || "").toUpperCase();
  const status = String(item.status || "");
  if (gate === "FAIL") return { label: lang === "ru" ? "Не подтверждено" : "Not confirmed", tone: "fail" };
  if (status === "Verified") return { label: lang === "ru" ? "Проверено" : "Verified", tone: "ok" };
  if (status === "Reviewed") return { label: lang === "ru" ? "Частично проверено" : "Partly verified", tone: "partial" };
  return { label: lang === "ru" ? "Нужна проверка" : "Needs review", tone: "review" };
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export function reportCounters(payload: ResearchExportPayload): ReportCounters {
  const c: any = payload.progressCounters || {};
  const s: any = payload.stats || {};
  const results = payload.results || [];
  return {
    sourcesDiscovered: num(c.sourcesDiscovered ?? s.sourcesFound),
    sourcesInBase: num(c.sourcesInBase),
    sourcesChecked: num(c.sourcesChecked ?? s.sourcesChecked),
    sourcesUnavailable: num(c.sourcesUnavailable ?? (num(s.sourcesBlocked) + num(s.sourcesUnavailable))),
    resultsFound: num(c.resultsFound ?? s.recordsExtracted ?? results.length),
    afterDedupe: num(c.afterDedupe ?? results.length),
    matchingCriteria: num(c.matchingCriteria ?? results.filter((r) => r.status === "Verified" || r.status === "Reviewed").length),
    needsReview: num(c.needsReview ?? results.filter((r) => r.status === "Manual review").length),
  };
}

export function counterRows(counters: ReportCounters, lang: ReportLanguage) {
  return COUNTER_LABEL
    .filter(([key]) => key !== "sourcesInBase" || counters.sourcesInBase > 0)
    .map(([key, ru, en]) => ({ key, label: lang === "ru" ? ru : en, value: counters[key] }));
}

export function formatNumber(value: number, lang: ReportLanguage) {
  return value.toLocaleString(lang === "ru" ? "ru-RU" : "en-US").replace(/ /g, " ");
}

export function formatDate(iso: string | undefined, lang: ReportLanguage) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return String(iso || "");
  return date.toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", { timeZone: "UTC", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC";
}

export function evidenceText(item: ReportResult, limit = 400) {
  return compactText(item.evidenceQuote || item.evidence || "", limit);
}

export const L = {
  title: ["Отчёт об исследовании", "Research report"],
  query: ["Запрос", "Query"],
  taskType: ["Тип задачи", "Task type"],
  generated: ["Сформирован", "Generated"],
  progress: ["Ход исследования", "Research progress"],
  summary: ["Краткий вывод", "Summary"],
  results: ["Результаты", "Results"],
  details: ["Подробности и доказательства", "Details and evidence"],
  sources: ["Реестр источников", "Source registry"],
  number: ["№", "#"],
  match: ["Совпадение", "Match"],
  status: ["Статус", "Status"],
  source: ["Источник", "Source"],
  link: ["Ссылка", "Link"],
  evidence: ["Подтверждение со страницы", "Evidence from the page"],
  why: ["Почему подходит", "Why it fits"],
  open: ["Открыть", "Open"],
  noResults: ["Подходящих результатов не найдено. Попробуйте расширить критерии или продолжить поиск.", "No matching results. Widen the criteria or continue the search."],
  fullList: ["Полный список и доказательства — во вложенных XLSX и PDF.", "The full list and evidence are in the attached XLSX and PDF."],
  legend: ["Проверено — данные подтверждены цитатой со страницы. Частично проверено — источник прочитан, часть полей не подтверждена. Нужна проверка — найдено поиском, страницу стоит открыть вручную.", "Verified: data confirmed by a quote from the page. Partly verified: page read, some fields unconfirmed. Needs review: found by search, open the page to confirm."],
  access: ["Доступ", "Access"],
  category: ["Категория", "Category"],
  quality: ["Качество", "Quality"],
  domain: ["Домен", "Domain"],
  reason: ["Комментарий", "Note"],
} as const;

export function t(key: keyof typeof L, lang: ReportLanguage) {
  return L[key][lang === "ru" ? 0 : 1];
}

const ACCESS_LABEL: Record<string, [string, string]> = {
  checked: ["Проверен", "Checked"],
  partial: ["Ещё не проверялся", "Not checked yet"],
  unavailable: ["Недоступен", "Unavailable"],
  blocked: ["Заблокирован", "Blocked"],
  auth_required: ["Нужен вход", "Login required"],
  policy_restricted: ["Запрещено правилами сайта", "Restricted by site policy"],
  captcha_required: ["CAPTCHA", "CAPTCHA"],
  rate_limited: ["Ограничение частоты", "Rate limited"],
  not_automatable: ["Не автоматизируется", "Not automatable"],
};

export function accessLabel(status: unknown, lang: ReportLanguage) {
  const key = String(status || "partial");
  return (ACCESS_LABEL[key] || [key, key])[lang === "ru" ? 0 : 1];
}

export function percent(value: unknown) {
  const n = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(n) ? "" : Math.max(0, Math.min(100, Math.round(n))) + "%";
}

export function safeUrl(value: unknown) {
  const url = String(value || "").trim();
  return /^https?:\/\//i.test(url) ? url : "";
}

export function domainOf(item: ReportResult) {
  if (item.sourceDomain) return String(item.sourceDomain);
  try { return new URL(String(item.url || "")).hostname.replace(/^www\./, ""); } catch { return String(item.source || ""); }
}

// Fields worth showing for one result: the task's columns, minus the name already in
// the heading and minus empty values.
export function resultFacts(item: ReportResult, columns: FieldDef[], lang: ReportLanguage, limit = 4) {
  const name = resultName(item);
  return columns
    .map((col) => ({ label: lang === "ru" ? col.ru : col.en, key: col.key, value: fieldValue(item, col.key) }))
    .filter((f) => f.value && f.value !== name)
    .slice(0, limit);
}

export function statusTally(results: ReportResult[], lang: ReportLanguage) {
  const tally: Record<StatusTone, number> = { ok: 0, partial: 0, review: 0, fail: 0 };
  for (const item of results) tally[statusInfo(item, lang).tone] += 1;
  return tally;
}
