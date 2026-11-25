"use client";

import { useState } from "react";
import { CirclePause, CirclePlay, HelpCircle } from "lucide-react";

// Task control for the research view: stop / continue and optional clarifying questions.
// mergeRound keeps the per-task counters and results used by exports and history.

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
  const [questions, setQuestions] = useState<Question[]>([]);
  const [askedFor, setAskedFor] = useState("");
  const [loadingQuestions, setLoadingQuestions] = useState(false);

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

  const criteriaChanged = Boolean(session && session.query.trim() !== query.trim());

  // Only the actions: the counters and the results live once each on the page.
  return (
    <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap gap-2">
        {running ? (
          <button onClick={props.onStop} className="inline-flex items-center gap-2 rounded-xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]">
            <CirclePause size={14} /> {ru ? "Остановить" : "Stop"}
          </button>
        ) : null}
        {!running && session?.canContinue ? (
          <button onClick={props.onContinue} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-soft)]">
            <CirclePlay size={14} /> {criteriaChanged ? (ru ? "Продолжить с новыми критериями" : "Continue with new criteria") : (ru ? "Найти ещё" : "Find more")}
          </button>
        ) : null}
        {!running ? (
          <button onClick={() => void askQuestions()} disabled={loadingQuestions || !query.trim()} className="inline-flex items-center gap-2 rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)] disabled:opacity-50">
            <HelpCircle size={14} /> {ru ? "Уточнить критерии" : "Clarify criteria"}
          </button>
        ) : null}
      </div>

      {questions.length && askedFor === query ? (
        <div className="glass-soft rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-[.16em] text-[var(--text-faint)]">{ru ? "Уточнения (необязательно)" : "Clarifications (optional)"}</div>
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
        </div>
      ) : null}
    </div>
  );
}
