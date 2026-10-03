"use client";

import { useEffect, useState } from "react";
import { CirclePause, CirclePlay, HelpCircle, Sparkles } from "lucide-react";

// Task control for the research view: edition and its limits, clarifying questions,
// progress counters in the shape of the product spec, stop / continue, and a results
// table whose columns follow the task type.

export type FieldDef = { key: string; ru: string; en: string };
export type ProgressCounters = {
  sourcesDiscovered: number;
  sourcesInBase: number;
  sourcesChecked: number;
  sourcesUnavailable: number;
  resultsFound: number;
  afterDedupe: number;
  matchingCriteria: number;
  needsReview: number;
};
export type ResearchSession = {
  query: string;
  round: number;
  seenUrls: string[];
  canContinue: boolean;
  counters: ProgressCounters;
  results: any[];
  fieldSchema: FieldDef[];
};

export const EMPTY_COUNTERS: ProgressCounters = { sourcesDiscovered: 0, sourcesInBase: 0, sourcesChecked: 0, sourcesUnavailable: 0, resultsFound: 0, afterDedupe: 0, matchingCriteria: 0, needsReview: 0 };

function resultKey(item: any) {
  return String(item?.url || item?.title || "").toLowerCase().replace(/\/$/, "");
}

// Folds one finished round into the session: results are merged by URL and the
// counters accumulate across rounds.
export function mergeRound(previous: ResearchSession | null, data: any, query: string): ResearchSession {
  const round = Number(data?.continuation?.round || 1);
  const prior = previous && round > 1 ? previous : null;
  const merged = new Map<string, any>();
  for (const item of [...(prior?.results || []), ...(Array.isArray(data?.results) ? data.results : [])]) {
    const key = resultKey(item);
    if (key && !merged.has(key)) merged.set(key, item);
  }
  const results = [...merged.values()].map((item, index) => ({ ...item, id: index + 1 }));
  const c: Partial<ProgressCounters> = data?.progressCounters || {};
  const base = prior?.counters || EMPTY_COUNTERS;
  const add = (key: keyof ProgressCounters) => base[key] + Number(c[key] || 0);
  return {
    query,
    round,
    seenUrls: Array.isArray(data?.continuation?.seenUrls) ? data.continuation.seenUrls : prior?.seenUrls || [],
    canContinue: Boolean(data?.continuation?.canContinue),
    fieldSchema: Array.isArray(data?.fieldSchema) && data.fieldSchema.length ? data.fieldSchema : prior?.fieldSchema || [],
    results,
    counters: {
      sourcesDiscovered: add("sourcesDiscovered"),
      sourcesInBase: Math.max(base.sourcesInBase, Number(c.sourcesInBase || 0)),
      sourcesChecked: add("sourcesChecked"),
      sourcesUnavailable: add("sourcesUnavailable"),
      resultsFound: add("resultsFound"),
      afterDedupe: results.length,
      matchingCriteria: results.filter((r) => r?.status === "Verified" || r?.status === "Reviewed").length,
      needsReview: results.filter((r) => r?.status === "Manual review").length,
    },
  };
}

type Question = { id: string; ru: string; en: string; placeholderRu: string; placeholderEn: string };

const LIMITATION_TEXT: Record<string, [string, string]> = {
  no_ai_key_rule_based_extraction: ["AI-ключ не задан: поля извлекаются правилами, все результаты требуют проверки.", "No AI key: fields are extracted by rules and every result needs review."],
  jina_reader_keyless_rate_limited: ["Чтение страниц без ключа Jina ограничено по скорости; часть страниц читается напрямую с учётом robots.txt.", "Page reading without a Jina key is rate limited; some pages are read directly, honouring robots.txt."],
  duckduckgo_only_may_rate_limit: ["Поиск идёт только через DuckDuckGo без ключа и может временно ограничиваться.", "Search runs only through keyless DuckDuckGo and may be throttled."],
  source_base_not_persistent: ["База источников не подключена к хранилищу и обнуляется при перезапуске сервера.", "The source base has no storage attached and resets when the server restarts."],
  no_login_or_captcha_sources: ["Сайты с логином или CAPTCHA не исследуются автоматически, они помечаются для ручной проверки.", "Sites behind a login or CAPTCHA are not automated; they are flagged for manual review."],
};

function cellValue(item: any, key: string) {
  const value = item?.[key];
  const text = value === undefined || value === null ? "" : String(value).trim();
  return !text || /^not specified$/i.test(text) ? "—" : text;
}

export default function ResearchControlPanel(props: {
  lang: "ru" | "en";
  query: string;
  running: boolean;
  session: ResearchSession | null;
  planHeaders: () => Record<string, string>;
  clarifications: Record<string, string>;
  onClarificationsChange: (next: Record<string, string>) => void;
  onStop: () => void;
  onContinue: () => void;
}) {
  const { lang, query, running, session } = props;
  const ru = lang === "ru";
  const [mode, setMode] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [askedFor, setAskedFor] = useState("");
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/research/mode", { cache: "no-store", headers: props.planHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setMode(data); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function askQuestions() {
    setLoadingQuestions(true);
    try {
      const response = await fetch("/api/research/clarify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
      const data = await response.json();
      setQuestions(Array.isArray(data?.questions) ? data.questions : []);
      setAskedFor(query);
    } catch {
      setQuestions([]);
    } finally {
      setLoadingQuestions(false);
    }
  }

  const edition = mode?.editions?.[mode?.edition === "pro" ? "pro" : "free"];
  const counters = session?.counters || EMPTY_COUNTERS;
  const criteriaChanged = Boolean(session && session.query.trim() !== query.trim());
  const counterRows: Array<[string, number]> = [
    [ru ? "Источников обнаружено" : "Sources discovered", counters.sourcesDiscovered],
    [ru ? "В накопленной базе" : "In the source base", counters.sourcesInBase],
    [ru ? "Источников проверено" : "Sources checked", counters.sourcesChecked],
    [ru ? "Недоступно для автоанализа" : "Not automatable", counters.sourcesUnavailable],
    [ru ? "Результатов найдено" : "Results found", counters.resultsFound],
    [ru ? "После удаления дублей" : "After de-duplication", counters.afterDedupe],
    [ru ? "Соответствуют критериям" : "Match the criteria", counters.matchingCriteria],
    [ru ? "Нужна ручная проверка" : "Need manual review", counters.needsReview],
  ];
  const columns = session?.fieldSchema?.length ? session.fieldSchema : [];

  return (
    <div className="mt-4 grid gap-3">
      <div className="glass-soft rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[.16em] text-[var(--gold)]">
            <Sparkles size={13} />
            {mode?.edition === "pro" ? "Pro" : "Free"} · {edition ? (edition.ai?.[0] ? edition.ai.map((a: any) => a.model).join(" → ") : (ru ? "без AI-ключа" : "no AI key")) : "…"}
          </div>
          <div className="flex flex-wrap gap-2">
            {running ? (
              <button onClick={props.onStop} className="inline-flex items-center gap-2 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]">
                <CirclePause size={14} /> {ru ? "Остановить" : "Stop"}
              </button>
            ) : null}
            {!running && session?.canContinue ? (
              <button onClick={props.onContinue} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-soft)]">
                <CirclePlay size={14} /> {criteriaChanged ? (ru ? "Продолжить с новыми критериями" : "Continue with new criteria") : (ru ? "Продолжить поиск" : "Continue search")}
              </button>
            ) : null}
            {!running ? (
              <button onClick={() => void askQuestions()} disabled={loadingQuestions || !query.trim()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50">
                <HelpCircle size={14} /> {ru ? "Уточнить критерии" : "Clarify criteria"}
              </button>
            ) : null}
          </div>
        </div>
        {edition ? (
          <div className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">
            {(ru ? "Поиск: " : "Search: ") + (edition.search || []).join(", ")}
            {(edition.limitations || []).length ? (
              <ul className="mt-1 list-disc pl-4 text-[var(--text-faint)]">
                {edition.limitations.map((code: string) => <li key={code}>{(LIMITATION_TEXT[code] || [code, code])[ru ? 0 : 1]}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        {session && !running ? (
          <div className="mt-2 text-[11px] text-[var(--text-faint)]">
            {ru
              ? "Раунд " + session.round + ". Чтобы изменить критерии, отредактируйте запрос и нажмите «Продолжить»: уже проверенные страницы не будут прочитаны повторно."
              : "Round " + session.round + ". To change the criteria, edit the query and press Continue: pages already checked are not read again."}
          </div>
        ) : null}
      </div>

      {questions.length && askedFor === query ? (
        <div className="glass-soft rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-[.16em] text-[var(--text-faint)]">{ru ? "Уточняющие вопросы (необязательно)" : "Clarifying questions (optional)"}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {questions.map((q) => (
              <label key={q.id} className="grid gap-1 text-[11px] text-[var(--text-muted)]">
                {ru ? q.ru : q.en}
                <input
                  value={props.clarifications[q.id] || ""}
                  placeholder={ru ? q.placeholderRu : q.placeholderEn}
                  onChange={(e) => props.onClarificationsChange({ ...props.clarifications, [q.id]: e.target.value })}
                  className="rounded-lg border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)] outline-none"
                />
              </label>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-faint)]">{ru ? "Ответы добавятся к запросу при следующем запуске." : "Answers are added to the query on the next run."}</div>
        </div>
      ) : null}

      {session ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {counterRows.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--line-soft)] bg-white/[.012] p-3">
              <div className="text-[9px] uppercase tracking-[.13em] text-[var(--text-faint)]">{label}</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text)]">{value.toLocaleString(ru ? "ru-RU" : "en-US")}</div>
            </div>
          ))}
        </div>
      ) : null}

      {session && columns.length && session.results.length ? (
        <div className="glass-soft overflow-x-auto rounded-xl p-2">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-[.12em] text-[var(--text-faint)]">
                {columns.map((col) => <th key={col.key} className="px-2 py-2 font-medium">{ru ? col.ru : col.en}</th>)}
              </tr>
            </thead>
            <tbody>
              {session.results.map((item) => (
                <tr key={item.id} className="border-t border-[var(--line-soft)] align-top text-[var(--text-muted)]">
                  {columns.map((col) => (
                    <td key={col.key} className="max-w-[260px] px-2 py-2">
                      {col.key === "url" && /^https?:\/\//.test(String(item.url || ""))
                        ? <a href={item.url} target="_blank" rel="noreferrer noopener" className="text-[var(--gold)] underline">{String(item.sourceDomain || item.url).slice(0, 40)}</a>
                        : <span className="line-clamp-3">{cellValue(item, col.key)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
