"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, Building2, CalendarPlus, Check, Database, Flame, Handshake, KeyRound, Landmark, Link2, ListChecks, MapPin, MessageSquare, Pencil, Plug,
  Moon, PanelLeft, Radar, RefreshCw, ScrollText, Send, Settings2, ShieldCheck, Sparkles, Sun, Telescope, Trash2, Upload, Users, X,
} from "lucide-react";
import type { AgencyCard, Draft, InvestorCard, Lead, LogEntry, Match, Meeting, ObjectCard, ScanStats, ScoutSettings, ScoutSource, WatchItem } from "@/lib/scout/types";

type Theme = "dark" | "light";
type AdapterInfo = { id: string; label: string; enabled: boolean; needs: string; note: string };
type ResearchTaskRow = {
  id: string;
  chatId: string;
  ownerId: string;
  query: string;
  kind: string;
  state: string;
  stage?: string;
  attempt?: number;
  round: number;
  counters: {
    sourcesDiscovered: number;
    sourcesChecked: number;
    afterDedupe: number;
    matchingCriteria: number;
    needsReview: number;
  };
  quality?: {
    score: number;
    evidenceCoverage: number;
    gatePassRate: number;
    verifiedRate: number;
    reviewRate: number;
    sourceDiversity: number;
  };
  error?: string;
  startedAt: string;
  updatedAt: string;
};

type HealthCheckRow = { id: string; label: string; level: "ok" | "warning" | "error"; detail: string };
type HealthState = {
  ok: boolean;
  checkedAt: string;
  checks: HealthCheckRow[];
  telegram: { configured: boolean; apiOk: boolean; username?: string; webhookConfigured: boolean; webhookUrl?: string; webhookError?: string; pendingUpdates?: number; reportChatId?: string; openGroupAccess: boolean };
  persistence: { configured: boolean; roundTrip: boolean };
  ai: { zeroCost: boolean; providers: Array<{ provider: string; model: string }>; deterministicFallback: boolean };
  search: { providers: string[]; directRead: boolean };
  security: { adminProtected: boolean; webhookSecretConfigured: boolean };
};

type State = {
  ok: boolean; persistent: boolean; protected: boolean; telegram: { token: boolean; chatId: string; openGroupAccess: boolean }; adapters: AdapterInfo[]; settings: ScoutSettings; lastScan: ScanStats | null;
  report: { data: any; html: string }; objects: ObjectCard[]; investors: InvestorCard[]; agencies: AgencyCard[]; sources: ScoutSource[]; watch: WatchItem[];
  drafts: Draft[]; leads: Lead[]; matches: Match[]; meetings: Meeting[]; researchTasks: ResearchTaskRow[]; log: LogEntry[];
};

type Tab = "report" | "tasks" | "health" | "objects" | "investors" | "agencies" | "matches" | "leads" | "drafts" | "intel" | "settings" | "log";

const TABS: Array<{ id: Tab; label: string; icon: typeof Radar; color: string }> = [
  { id: "report", label: "Главная", icon: Sparkles, color: "#ffd60a" },
  { id: "tasks", label: "Поиски", icon: ListChecks, color: "#64d2ff" },
  { id: "objects", label: "Объекты", icon: Building2, color: "#ff9500" },
  { id: "investors", label: "Инвесторы", icon: Landmark, color: "#34c759" },
  { id: "drafts", label: "Сообщения", icon: Send, color: "#af52de" },
  { id: "settings", label: "Настройки", icon: Settings2, color: "#a3b6c4" },
  { id: "agencies", label: "Агентства", icon: Handshake, color: "#00c7be" },
  { id: "matches", label: "Подбор", icon: Link2, color: "#0a84ff" },
  { id: "leads", label: "Диалоги", icon: MessageSquare, color: "#5856d6" },
  { id: "intel", label: "Источники", icon: Telescope, color: "#ff2d55" },
  { id: "health", label: "Проверка", icon: Activity, color: "#30d158" },
  { id: "log", label: "Журнал", icon: ScrollText, color: "#c9a96a" },
];

const SIMPLE_TABS = new Set<Tab>(["report", "tasks", "objects", "investors", "drafts", "settings"]);

const TYPE_RU: Record<string, string> = { land: "земля", house: "дом", villa: "вилла", apartment: "квартира", penthouse: "пентхаус", commercial: "коммерция", hotel: "отель", other: "другое" };
const STATUS_RU: Record<string, string> = { auction: "торги", urgent: "срочно", off_market: "off-market", bank: "банк", regular: "" };
const KIND_RU: Record<string, string> = { family_office: "Family office", fund: "Фонд", private: "Частный", company: "Компания" };
const LEAD_RU: Record<string, string> = { in_progress: "в работе", qualified: "квалифицирован", escalated: "эскалация", refused: "отказ", handed_over: "передан" };
const KEY_STORAGE = "aurelius-scout-key";

const CHECKLIST_RU: Record<string, string> = {
  budget: "Бюджет", geography: "География", type: "Тип объекта", goal: "Цель", horizon: "Горизонт", deal_form: "Форма сделки", decision_maker: "Кто решает", meeting: "Встреча",
  price: "Цена и торг", legal: "Юр. чистота", owner: "Собственник", commission: "Комиссия", documents: "Документы", viewing: "Просмотр",
};
const INVESTOR_KEYS = ["budget", "geography", "type", "goal", "horizon", "deal_form", "decision_maker", "meeting"];
const OBJECT_KEYS = ["price", "legal", "owner", "commission", "documents", "viewing"];

function money(value?: number, currency = "EUR") {
  if (!value) return "—";
  return value.toLocaleString("ru-RU") + (currency === "EUR" ? " €" : currency === "USD" ? " $" : " " + currency);
}

function when(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Minimal CSV reader (quoted fields, commas or semicolons) for official exports.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  const delimiter = (text.split("\n")[0].match(/;/g) || []).length > (text.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  let row: string[] = []; let field = ""; let quoted = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    let step = 1;
    if (quoted) {
      if (c === '"' && next === '"') { field += '"'; step = 2; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && next === "\n") step = 2;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
    i += step;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return header ? body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || "").trim()]))) : [];
}

// Only web and mail links from stored data are rendered as links.
function safeHref(url?: string) {
  return url && /^(https?:\/\/|mailto:)/i.test(url) ? url : undefined;
}

function unescapeHtml(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// Renders the Telegram report HTML (only <b> and <a> tags) as React elements, without innerHTML.
// Stable keys: each line keyed by its text plus how many identical lines came before it.
function keyedLines(lines: string[]) {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const n = (seen.get(line) || 0) + 1;
    seen.set(line, n);
    return { line, key: line + "#" + n };
  });
}

function ReportView({ html }: { html: string }) {
  return (
    <>
      {keyedLines(html.split("\n")).map(({ line, key }) => {
        const parts: ReactNode[] = [];
        const re = /<b>([\s\S]*?)<\/b>|<a href="([^"]*)">([\s\S]*?)<\/a>/g;
        let last = 0;
        for (const m of line.matchAll(re)) {
          const at = m.index ?? 0;
          if (at > last) parts.push(unescapeHtml(line.slice(last, at)));
          if (m[1] !== undefined) parts.push(<b key={at}>{unescapeHtml(m[1])}</b>);
          else parts.push(<a key={at} href={safeHref(unescapeHtml(m[2]))} target="_blank" rel="noreferrer">{unescapeHtml(m[3])}</a>);
          last = at + m[0].length;
        }
        if (last < line.length) parts.push(unescapeHtml(line.slice(last)));
        return <div key={key} className="min-h-[1.4em]">{parts}</div>;
      })}
    </>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#34c759" : score >= 50 ? "var(--gold-bright)" : "var(--text-muted)";
  return <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border px-2 text-sm font-semibold tabular-nums" style={{ color, borderColor: color }}>{score}</span>;
}

type ChipTone = "muted" | "gold" | "green" | "red" | "blue" | "violet";

function Chip({ children, tone = "muted" }: Readonly<{ children: ReactNode; tone?: ChipTone }>) {
  const tones = { muted: "border-[var(--line-soft)] text-[var(--text-muted)]", gold: "border-[var(--gold)]/40 text-[var(--gold-bright)]", green: "border-[#34c759]/40 text-[#34c759]", red: "border-[#ff375f]/40 text-[#ff375f]", blue: "border-[#0a84ff]/40 text-[#0a84ff]", violet: "border-[#af52de]/40 text-[#af52de]" };
  return <span className={"scout-chip inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium " + tones[tone]}>{children}</span>;
}

function Button({ children, onClick, variant = "ghost", disabled, title }: { children: ReactNode; onClick?: () => void; variant?: "ghost" | "spectrum" | "danger"; disabled?: boolean; title?: string }) {
  const base = "scout-button inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition disabled:opacity-40";
  const style = variant === "spectrum" ? "spectrum-button text-white shadow-lg" : variant === "danger" ? "border border-[#ff375f]/40 text-[#ff375f] hover:bg-[#ff375f]/10" : "border border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-soft)] hover:border-[var(--line)] hover:text-[var(--text)]";
  return <button type="button" title={title} disabled={disabled} onClick={onClick} className={base + " " + style}>{children}</button>;
}

function Panel({ title, icon: Icon, color, children, actions }: { title: string; icon?: typeof Radar; color?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass scout-panel rounded-[28px] p-4 sm:p-5 lg:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="scout-panel-title flex items-center gap-3 text-[17px] font-semibold sm:text-lg">
          {Icon && <span className="scout-panel-icon grid h-9 w-9 place-items-center rounded-xl border border-[var(--line-soft)] bg-[var(--surface-strong)]"><Icon size={17} style={{ color }} /></span>}
          <span>{title}</span>
        </h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="scout-empty rounded-2xl border border-dashed border-[var(--line-soft)] p-7 text-center text-sm leading-6 text-[var(--text-muted)]">{children}</div>;
}

const inputClass = "scout-input w-full min-h-11 rounded-xl border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3.5 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--line)]";

function dashboardCounts(state: State | null): Partial<Record<Tab, number>> {
  if (!state) return {};
  return {
    drafts: state.drafts.filter((draft) => draft.state === "pending").length,
    leads: state.leads.filter((lead) => lead.state === "qualified" || lead.state === "escalated").length,
    intel: state.sources.filter((source) => source.state === "candidate").length,
    matches: state.matches.filter((match) => match.state === "proposed").length,
    tasks: state.researchTasks.filter((task) => task.state === "running" || task.state === "clarifying").length,
    health: state.persistent && state.telegram.token ? 0 : 1,
  };
}

function telegramStatus(state: State | null): { tone: ChipTone; label: string } {
  if (!state?.telegram.token) return { tone: "red", label: "не настроен" };
  if (state.telegram.openGroupAccess) return { tone: "green", label: "группа открыта" };
  return { tone: "green", label: "готов" };
}

export default function ScoutDashboard() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("report");
  const [focusId, setFocusId] = useState("");
  const [place, setPlace] = useState("");
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem("aurelius-theme") === "light" ? "light" : "dark";
      setTheme(savedTheme);
      document.documentElement.classList.toggle("light", savedTheme === "light");
      setKey(window.localStorage.getItem(KEY_STORAGE) || "");
    } catch {}
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) {
      setTab(t);
      if (!SIMPLE_TABS.has(t)) setAdvanced(true);
    }
    setFocusId(params.get("id") || "");
    setPlace(params.get("place") || "");
  }, []);

  const headers = useCallback((): Record<string, string> => (key ? { "x-scout-key": key, "content-type": "application/json" } : { "content-type": "application/json" }), [key]);

  const load = useCallback(async () => {
    const response = await fetch("/api/scout/state", { headers: headers(), cache: "no-store" }).catch(() => null);
    if (!response) { setToast("Сервер недоступен"); return; }
    if (response.status === 401) { setNeedKey(true); return; }
    setNeedKey(false);
    setState(await response.json());
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}, label = action) => {
    setBusy(label);
    try {
      const response = await fetch("/api/scout/action", { method: "POST", headers: headers(), body: JSON.stringify({ action, ...payload }) });
      const data = await response.json().catch(() => ({}));
      if (data.message) setToast(data.message);
      else if (data.error) setToast(data.error);
      else if (!response.ok) setToast("Ошибка " + response.status);
      await load();
      return data;
    } finally {
      setBusy("");
    }
  }, [headers, load]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 5000); return () => clearTimeout(t); } }, [toast]);

  const changeTab = (next: Tab) => {
    setTab(next);
    setFocusId("");
    setPlace("");
    setMobileOpen(false);
    window.history.replaceState(null, "", "/scout?tab=" + next);
  };

  const visibleTabs = advanced ? TABS : TABS.filter((item) => SIMPLE_TABS.has(item.id));

  const toggleAdvanced = () => {
    const next = !advanced;
    setAdvanced(next);
    if (!next && !SIMPLE_TABS.has(tab)) changeTab("report");
  };

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    try { window.localStorage.setItem("aurelius-theme", next); } catch {}
  };

  const counts = dashboardCounts(state);

  const activeTab = TABS.find((item) => item.id === tab);
  const telegramState = telegramStatus(state);

  return (
    <main className="scout-ui relative isolate min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)] transition-colors duration-300 spectrum-shell">
      <div className="app-grid pointer-events-none fixed inset-0 z-0 opacity-45" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1900px]">
        <aside
          className={"fixed inset-y-0 left-0 z-50 w-[280px] border-r border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] p-5 backdrop-blur-2xl transition-transform duration-300 lg:static lg:translate-x-0 " +
            (mobileOpen ? "translate-x-0" : "-translate-x-full")}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between">
              <a href="/" className="block min-w-0">
                <div className="brand-mark font-display text-[32px] font-semibold leading-none tracking-[.2em]">AURELIUS</div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-px w-6 bg-gradient-to-r from-[var(--gold)] to-transparent" />
                  <span className="font-display text-[15px] italic leading-none text-[var(--gold-bright)]">AI Scout · Разведчик</span>
                </div>
              </a>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-xl p-2 text-[var(--text-muted)] lg:hidden"
                aria-label="Закрыть меню"
              >
                <X size={18} />
              </button>
            </div>

            <nav className="mt-10 space-y-1" aria-label="Разделы Разведчика">
              {visibleTabs.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => changeTab(id)}
                    aria-current={active ? "page" : undefined}
                    className={"scout-nav-item group flex w-full items-center gap-3 rounded-xl border px-2.5 py-2.5 text-left text-sm transition " +
                      (active
                        ? "is-active border-[var(--line)] bg-[var(--gold)]/7 text-[var(--text)]"
                        : "border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-soft)]")}
                  >
                    <span className="scout-nav-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-transparent">
                      <Icon className={"icon-lift icon-foil " + (active ? "" : "opacity-60 group-hover:opacity-100")} size={16} />
                    </span>
                    <span className="font-medium tracking-[-.01em]">{label}</span>
                    {counts[id] ? (
                      <span className="ml-auto rounded-full bg-[#ff375f] px-2 py-0.5 text-[10px] font-semibold text-white">{counts[id]}</span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={toggleAdvanced}
              className="panel-hover mt-4 flex w-full items-center justify-between rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] px-3.5 py-3 text-left text-sm text-[var(--text-muted)]"
            >
              <span>{advanced ? "Скрыть служебные разделы" : "Ещё разделы"}</span>
              <span className="text-[var(--gold-bright)]">{advanced ? "−" : "+"}</span>
            </button>

            <div className="glass panel-hover mt-6 rounded-2xl p-4">
              <div className="text-[10px] uppercase tracking-[.2em] text-[var(--gold)]">Состояние системы</div>
              <div className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Хранилище</span>
                  <Chip tone={state?.persistent ? "green" : "gold"}>{state?.persistent ? "подключено" : "временно"}</Chip>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Telegram</span>
                  <Chip tone={telegramState.tone}>{telegramState.label}</Chip>
                </div>
              </div>
            </div>

            <div className="mt-auto border-t border-[var(--line-soft)] pt-4">
              <a
                href="/"
                className="group flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                <Sparkles size={17} className="icon-foil opacity-70 group-hover:opacity-100" />
                <span className="min-w-0 flex-1">
                  <span className="block">AI Research Engine</span>
                  <span className="block text-[10px] text-[var(--text-faint)]">Вернуться на основной сайт</span>
                </span>
              </a>
            </div>
          </div>
        </aside>

        {mobileOpen && (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Закрыть меню"
          />
        )}

        <section className="min-w-0 flex-1">
          <div className="sticky top-0 z-30">
            <header className="flex h-[74px] items-center justify-between border-b border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--bg)_78%,transparent)] px-4 backdrop-blur-2xl sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] p-2 text-[var(--text-muted)] lg:hidden"
                  aria-label="Открыть меню"
                >
                  <PanelLeft size={18} />
                </button>
                <div className="min-w-0">
                  <div className="hidden items-center gap-2 text-xs text-[var(--text-faint)] sm:flex">
                    <span>Разведчик</span>
                    <span>/</span>
                    <span className="truncate text-[var(--text-soft)]">{activeTab?.label || "Главная"}</span>
                  </div>
                  <div className="scout-mobile-title truncate text-lg font-semibold text-[var(--text)] sm:hidden">{activeTab?.label || "Разведчик"}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2">
                {state?.persistent ? (
                  <div className="hidden items-center gap-2 rounded-full border border-[var(--success)]/30 bg-[var(--success)]/7 px-3 py-1.5 text-[11px] text-[var(--success)] xl:flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    <span>Память подключена</span>
                  </div>
                ) : null}
                {state?.telegram.token ? (
                  <div className="hidden items-center gap-2 rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/8 px-3 py-1.5 text-[11px] text-[var(--gold-bright)] xl:flex">
                    <Send size={13} />
                    Telegram
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={toggleTheme}
                  className="panel-hover grid h-9 w-9 place-items-center rounded-xl border border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-muted)]"
                  aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                  title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                >
                  {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                </button>

                <Button onClick={() => void load()} title="Обновить"><RefreshCw size={14} /></Button>
                <Button variant="spectrum" disabled={Boolean(busy)} onClick={() => void act("scan", {}, "scan")}>
                  <Radar size={14} />
                  <span className="hidden whitespace-nowrap sm:inline">{busy === "scan" ? "Обновляю…" : "Обновить данные"}</span>
                </Button>
              </div>
            </header>
            <div className="spectrum-line h-[2px] w-full opacity-70" />
          </div>

          <div className="mx-auto max-w-[1540px] px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-14 lg:pt-8">
            <div className="scout-content space-y-5 soft-focus">
              {needKey && (
                <Panel title="Доступ к кабинету" icon={KeyRound} color="#ffd60a">
                  <p className="mb-3 text-sm text-[var(--text-muted)]">Введите ключ доступа к рабочему кабинету.</p>
                  <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); try { window.localStorage.setItem(KEY_STORAGE, key); } catch {} void load(); }}>
                    <input className={inputClass} type="password" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Ключ доступа" placeholder="Ключ доступа" />
                    <Button variant="spectrum" onClick={() => { try { window.localStorage.setItem(KEY_STORAGE, key); } catch {} void load(); }}>Войти</Button>
                  </form>
                </Panel>
              )}

              {!state && !needKey && <Empty>Загружаю кабинет…</Empty>}

              {state && !state.persistent && (
                <div className="rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm text-[var(--warning)]">
                  <Database size={14} className="mr-1 inline" /> Хранилище пока не подключено. Для постоянной памяти подключите бесплатный Upstash Redis.
                </div>
              )}
              {state && !state.protected && (
                <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--surface)]/50 p-3 text-xs text-[var(--text-muted)]">
                  <ShieldCheck size={13} className="mr-1 inline text-[var(--gold-bright)]" /> Общий режим: кабинет открыт всем, у кого есть ссылка. Все пользователи работают по одинаковым правилам.
                </div>
              )}

              {state && tab === "report" && <ReportTab state={state} act={act} busy={busy} headers={headers} setToast={setToast} />}
              {state && tab === "tasks" && <TasksTab state={state} act={act} />}
              {state && tab === "health" && <HealthTab headers={headers} />}
              {state && tab === "objects" && <ObjectsTab state={state} act={act} focusId={focusId} place={place} query={query} setQuery={setQuery} />}
              {state && tab === "investors" && <InvestorsTab state={state} act={act} focusId={focusId} />}
              {state && tab === "agencies" && <AgenciesTab state={state} act={act} />}
              {state && tab === "matches" && <MatchesTab state={state} act={act} focusId={focusId} />}
              {state && tab === "leads" && <LeadsTab state={state} act={act} />}
              {state && tab === "drafts" && <DraftsTab state={state} act={act} />}
              {state && tab === "intel" && <IntelTab state={state} act={act} />}
              {state && tab === "settings" && <SettingsTab state={state} act={act} />}
              {state && tab === "log" && <LogTab state={state} />}
            </div>
          </div>
        </section>
      </div>

      {toast && <output className="glass fixed bottom-4 left-1/2 z-[80] block max-w-[92vw] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm shadow-2xl">{toast}</output>}
    </main>
  );
}

type Act = (action: string, payload?: Record<string, unknown>, label?: string) => Promise<any>;

function Kpi({ label, value, color, hint }: { label: string; value: ReactNode; color: string; hint?: string }) {
  return (
    <div className="glass-soft scout-kpi rounded-2xl p-4 sm:p-[18px]">
      <div className="scout-eyebrow text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">{label}</div>
      <div className="scout-kpi-value mt-2 text-[32px] font-semibold leading-none tabular-nums tracking-[-.045em]" style={{ color }}>{value}</div>
      {hint && <div className="mt-2 text-[11px] leading-4 text-[var(--text-faint)]">{hint}</div>}
    </div>
  );
}

function ReportTab({ state, act, busy, headers, setToast }: { state: State; act: Act; busy: string; headers: () => Record<string, string>; setToast: (s: string) => void }) {
  const d = state.report.data;
  const [hook, setHook] = useState<any>(null);
  const checkHook = async (connect: boolean) => {
    const response = await fetch("/api/scout/telegram/setup", { method: connect ? "POST" : "GET", headers: headers() });
    const data = await response.json().catch(() => ({}));
    setHook(data);
    if (connect) setToast(data.ok ? "Бот подключён: команды и кнопки работают" : "Не удалось: " + (data.error || data.webhook || "ошибка"));
  };
  useEffect(() => { if (state.telegram.token) void checkHook(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Объекты за сутки" value={d.objects.total} color="#ff9500" />
        <Kpi label="Инвесторы за сутки" value={d.investors.total} color="#34c759" />
        <Kpi label="Ждут тебя" value={d.dialogs.qualified + d.dialogs.escalated} color="#ff375f" hint="квалиф. + эскалации" />
        <Kpi label="На одобрение" value={d.pendingDrafts} color="#af52de" />
        <Kpi label="Пары" value={state.matches.filter((m) => m.state === "proposed").length} color="#0a84ff" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Panel title={"Отчёт за " + d.date} icon={Sparkles} color="#ffd60a" actions={<Button variant="spectrum" disabled={Boolean(busy)} onClick={() => void act("report.send", {}, "report")}><Send size={14} />{busy === "report" ? "Отправляю…" : "Отправить в Telegram"}</Button>}>
          <div className="rounded-2xl border border-[var(--line-soft)] bg-[var(--surface-strong)] p-4 text-sm leading-relaxed [&_a]:text-[#0a84ff] [&_a]:underline-offset-2 hover:[&_a]:underline">
            <ReportView html={state.report.html} />
          </div>
          <p className="mt-2 text-xs text-[var(--text-faint)]">Автоматически каждый день в 06:00 UTC (08:00 по Мадриду летом) — Vercel Cron.</p>
        </Panel>
        <div className="space-y-5">
          <Panel title="Telegram" icon={Send} color="#0a84ff">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-2"><span>Токен бота</span>{state.telegram.token ? <Chip tone="green">задан</Chip> : <Chip tone="red">нет TELEGRAM_BOT_TOKEN</Chip>}</li>
              <li className="flex items-center justify-between gap-2"><span>Группа отчёта</span><Chip tone={state.telegram.chatId ? "green" : "red"}>{state.telegram.chatId || "нет TELEGRAM_CHAT_ID"}</Chip></li>
              <li className="flex items-center justify-between gap-2"><span>Управление (вебхук)</span>{hook?.connected ? <Chip tone="green">подключено</Chip> : <Chip tone="gold">не подключено</Chip>}</li>
              {hook?.lastError && <li className="text-xs text-[var(--danger)]">Последняя ошибка Telegram: {hook.lastError}</li>}
            </ul>
            <div className="mt-3"><Button variant="spectrum" disabled={!state.telegram.token} onClick={() => void checkHook(true)}><Plug size={14} />Подключить управление ботом</Button></div>
            <p className="mt-2 text-xs text-[var(--text-faint)]">Один раз после деплоя. Затем в группе работают /report, /scan, /drafts и кнопки.</p>
          </Panel>
          <Panel title="Последний обход" icon={Radar} color="#34c759">
            {state.lastScan ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-[var(--text-muted)]">Когда</span><span>{when(state.lastScan.finishedAt || state.lastScan.startedAt)}</span>
                <span className="text-[var(--text-muted)]">Запросов / ссылок</span><span>{state.lastScan.queries} / {state.lastScan.hits}</span>
                <span className="text-[var(--text-muted)]">Объекты</span><span>+{state.lastScan.objectsNew} (дублей слито {state.lastScan.objectsMerged})</span>
                <span className="text-[var(--text-muted)]">Инвесторы / агентства</span><span>+{state.lastScan.investorsNew} / +{state.lastScan.agenciesNew}</span>
                <span className="text-[var(--text-muted)]">Источники / пары</span><span>+{state.lastScan.sourcesDiscovered} / +{state.lastScan.matchesNew}</span>
                {state.lastScan.errors.length > 0 && <p className="col-span-2 mt-1 text-xs text-[var(--warning)]">{state.lastScan.errors.join(" · ")}</p>}
              </div>
            ) : <Empty>Обходов ещё не было. Нажмите «Обход сейчас».</Empty>}
          </Panel>
          <Panel title="Источники уровня A" icon={Database} color="#00c7be">
            <ul className="space-y-2 text-sm">
              {state.adapters.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <div><div>{a.label}</div><div className="text-xs text-[var(--text-faint)]">{a.note}</div></div>
                  {a.enabled ? <Chip tone="green">вкл</Chip> : <Chip tone="muted">{a.needs}</Chip>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function ObjectsTab({ state, act, focusId, place, query, setQuery }: { state: State; act: Act; focusId: string; place: string; query: string; setQuery: (s: string) => void }) {
  const list = useMemo(() => state.objects.filter((o) => {
    if (focusId) return o.id === focusId;
    if (place && !(o.country + (o.city ? " (" + o.city + ")" : "")).startsWith(place)) return false;
    const q = query.toLowerCase();
    return !q || (o.title + " " + o.city + " " + o.district + " " + o.country).toLowerCase().includes(q);
  }), [state.objects, focusId, place, query]);
  return (
    <Panel title={"Объекты · " + list.length} icon={Building2} color="#ff9500" actions={<input className={inputClass + " w-56"} aria-label="Поиск: город, район…" placeholder="Поиск: город, район…" value={query} onChange={(e) => setQuery(e.target.value)} />}>
      {!list.length ? <Empty>Объектов пока нет. Запустите обход или добавьте фиды порталов (SCOUT_FEEDS).</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((o) => (
            <article key={o.id} className={"glass-soft rounded-2xl p-4 " + (o.state === "rejected" ? "opacity-50" : "")}>
              <div className="flex items-start gap-3">
                <ScoreBadge score={o.score} />
                <div className="min-w-0 flex-1">
                  <a href={safeHref(o.url)} target="_blank" rel="noreferrer" className="line-clamp-2 font-medium hover:underline">{o.title}</a>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip><MapPin size={11} />{[o.city, o.district].filter(Boolean).join(", ") || o.country}</Chip>
                    <Chip tone="blue">{TYPE_RU[o.type]}</Chip>
                    {STATUS_RU[o.status] && <Chip tone="red"><Flame size={11} />{STATUS_RU[o.status]}</Chip>}
                    {o.urls.length > 1 && <Chip tone="violet">на {o.urls.length} площадках</Chip>}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-[10px] uppercase text-[var(--text-faint)]">Цена</div>{money(o.price, o.currency)}</div>
                <div><div className="text-[10px] uppercase text-[var(--text-faint)]">Площадь</div>{o.areaM2 ? o.areaM2 + " м²" : "—"}</div>
                <div><div className="text-[10px] uppercase text-[var(--text-faint)]">К рынку</div>{o.discountPct !== undefined ? <span style={{ color: o.discountPct > 0 ? "#34c759" : "var(--text-muted)" }}>{o.discountPct > 0 ? "−" : "+"}{Math.abs(o.discountPct)}%</span> : "—"}</div>
              </div>
              {o.scoreReasons.length > 0 && <p className="mt-2 text-xs text-[var(--text-muted)]">{o.scoreReasons.join(" · ")}</p>}
              <div className="mt-2 text-xs text-[var(--text-faint)]">{o.sourceDomain} · найдено {when(o.firstSeenAt)}{o.sellerContact ? " · контакт: " + o.sellerContact : ""}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void act("lead.create", { type: "object", name: o.title, contact: o.sellerContact, refId: o.id, lang: o.country === "Испания" ? "es" : "en" })}><MessageSquare size={13} />Чек-лист по объекту</Button>
                {o.state !== "reviewing" && <Button onClick={() => void act("card.state", { type: "object", id: o.id, state: "reviewing" })}><Check size={13} />В работу</Button>}
                {o.state !== "rejected" && <Button variant="danger" onClick={() => void act("card.state", { type: "object", id: o.id, state: "rejected" })}><X size={13} />Отклонить</Button>}
              </div>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function InvestorsTab({ state, act, focusId }: { state: State; act: Act; focusId: string }) {
  const [csv, setCsv] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [comments, setComments] = useState("");
  const list = focusId ? state.investors.filter((i) => i.id === focusId) : state.investors;
  return (
    <>
      <Panel title={"Инвесторы и покупатели · " + list.length} icon={Landmark} color="#34c759">
        {!list.length ? <Empty>Инвесторов пока нет. Обход ищет family offices и фонды; ниже можно импортировать экспорт LinkedIn или список участников мероприятия.</Empty> : (
          <div className="divide-y divide-[var(--line-soft)]">
            {list.map((i) => (
              <div key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <ScoreBadge score={i.score} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.channel && /^https?:/.test(i.channel) ? <a href={safeHref(i.channel)} target="_blank" rel="noreferrer" className="hover:underline">{i.name}</a> : i.name}{i.role ? <span className="text-[var(--text-muted)]"> · {i.role}</span> : null}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Chip tone="gold">{KIND_RU[i.kind]}</Chip>
                    {i.interest.geography.map((g) => <Chip key={g}><MapPin size={11} />{g}</Chip>)}
                    {(i.interest.budgetMin || i.interest.budgetMax) ? <Chip tone="green">{money(i.interest.budgetMin, i.interest.currency)} – {money(i.interest.budgetMax, i.interest.currency)}</Chip> : null}
                    {i.interest.segments.slice(0, 3).map((s) => <Chip key={s} tone="blue">{TYPE_RU[s]}</Chip>)}
                    {i.comment && <Chip tone={i.comment.level === "explicit" ? "red" : "violet"}>💬 {i.comment.level === "explicit" ? "явный интерес" : "интерес"}</Chip>}
                  </div>
                  {i.comment && <p className="mt-1 text-xs text-[var(--text-muted)]">«{i.comment.text}» — <a className="underline" href={safeHref(i.comment.postUrl)} target="_blank" rel="noreferrer">пост</a></p>}
                  <div className="mt-1 text-xs text-[var(--text-faint)]">{i.source} · {when(i.firstSeenAt)} · {i.state}</div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void act("lead.create", { type: "investor", name: i.name, contact: i.channel, refId: i.id })}><MessageSquare size={13} />Квалификация</Button>
                  <Button variant="danger" onClick={() => void act("card.state", { type: "investor", id: i.id, state: "refused" })}><X size={13} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Комментаторы под постом (5.1)" icon={MessageSquare} color="#ff2d55">
          <p className="mb-2 text-xs text-[var(--text-muted)]">Скопируйте комментарии из поста, который видите сами (Facebook, Instagram, LinkedIn). Агент отберёт явный и общий интерес и подготовит публичный ответ в ветке — личные сообщения незнакомым не пишет.</p>
          <input className={inputClass + " mb-2"} aria-label="Ссылка на пост" placeholder="Ссылка на пост" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
          <textarea aria-label="Комментарии" className={inputClass + " h-32"} placeholder={"Иван Петров: Сколько стоит?\nAna López: Me interesa, ¿precio?"} value={comments} onChange={(e) => setComments(e.target.value)} />
          <div className="mt-2"><Button variant="spectrum" disabled={!postUrl || !comments} onClick={() => void act("comments.import", { postUrl, comments }).then(() => setComments(""))}>Разобрать</Button></div>
        </Panel>
        <Panel title="Импорт CSV" icon={Upload} color="#00c7be">
          <p className="mb-2 text-xs text-[var(--text-muted)]">Официальный экспорт LinkedIn / Sales Navigator или список участников мероприятия. Колонки: name, company, role, country, contact, interest.</p>
          <textarea aria-label="CSV инвесторов" className={inputClass + " h-32 font-mono text-xs"} placeholder={"name,company,role,country,contact,interest\nAna López,Iberia FO,Partner,Spain,ana@iberia.es,residential Valencia 1-3M EUR"} value={csv} onChange={(e) => setCsv(e.target.value)} />
          <div className="mt-2"><Button variant="spectrum" disabled={!csv.trim()} onClick={() => void act("investors.import", { rows: parseCsv(csv) }).then((r) => { if (r?.ok) setCsv(""); })}>Импортировать</Button></div>
        </Panel>
      </div>
    </>
  );
}

const AGENCY_STATES: Array<[AgencyCard["state"], string]> = [["new", "новое"], ["written", "написано"], ["replied", "ответили"], ["meeting", "встреча"], ["partner", "партнёр"], ["declined", "отказ"]];

function AgenciesTab({ state, act }: { state: State; act: Act }) {
  return (
    <Panel title={"Агентства и брокеры · " + state.agencies.length} icon={Handshake} color="#00c7be">
      {!state.agencies.length ? <Empty>Агентств пока нет. Обход ищет их по целевым городам; GOOGLE_PLACES_API_KEY добавит Google Maps.</Empty> : (
        <div className="divide-y divide-[var(--line-soft)]">
          {state.agencies.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.website ? <a href={safeHref(a.website)} target="_blank" rel="noreferrer" className="hover:underline">{a.name}</a> : a.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {a.city && <Chip><MapPin size={11} />{a.city}</Chip>}
                  {a.network && <Chip tone="gold">{a.network}</Chip>}
                  {a.isNew && <Chip tone="green">новое</Chip>}
                  {a.phone && <Chip>{a.phone}</Chip>}
                  {a.email && <Chip>{a.email}</Chip>}
                </div>
              </div>
              <select aria-label="Статус агентства" className={inputClass + " sm:w-40"} value={a.state} onChange={(e) => void act("card.state", { type: "agency", id: a.id, state: e.target.value })}>
                {AGENCY_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MatchesTab({ state, act, focusId }: { state: State; act: Act; focusId: string }) {
  const objects = new Map(state.objects.map((o) => [o.id, o]));
  const investors = new Map(state.investors.map((i) => [i.id, i]));
  const list = state.matches.filter((m) => (focusId ? m.id === focusId : m.state !== "dismissed"));
  return (
    <Panel title={"Пары объект ↔ инвестор · " + list.length} icon={Link2} color="#0a84ff">
      {!list.length ? <Empty>Пар пока нет. Они появляются, когда у инвестора известны география, тип или бюджет.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((m) => {
            const o = objects.get(m.objectId); const i = investors.get(m.investorId);
            return (
              <div key={m.id} className="glass-soft rounded-2xl p-4">
                <div className="flex items-center gap-3"><ScoreBadge score={m.score} /><div className="min-w-0 text-sm"><div className="truncate font-medium">{i?.name || "инвестор"}</div><div className="truncate text-[var(--text-muted)]">↔ {o?.title || "объект"} · {money(o?.price, o?.currency)}</div></div></div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">{m.reasons.join(" · ")}</p>
                <div className="mt-3 flex gap-2">
                  {m.state === "proposed" ? <>
                    <Button variant="spectrum" onClick={() => void act("card.state", { type: "match", id: m.id, state: "accepted" })}><Handshake size={13} />Стыковка</Button>
                    <Button onClick={() => void act("card.state", { type: "match", id: m.id, state: "dismissed" })}><X size={13} />Не подходит</Button>
                  </> : <Chip tone="green">в работе</Chip>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function LeadsTab({ state, act }: { state: State; act: Act }) {
  const [open, setOpen] = useState("");
  const [reply, setReply] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  return (
    <>
      <Panel title={"Диалоги и квалификация · " + state.leads.length} icon={MessageSquare} color="#5856d6">
        <p className="mb-3 text-xs text-[var(--text-muted)]">Люди, написавшие боту, проходят чек-лист автоматически в Telegram. Ответы из почты или WhatsApp вставьте в карточку — агент заполнит чек-лист и предложит следующий вопрос. Деньги и спорные вопросы — эскалация к вам.</p>
        {!state.leads.length ? <Empty>Диалогов пока нет.</Empty> : (
          <div className="space-y-3">
            {state.leads.map((l) => {
              const keys = l.type === "investor" ? INVESTOR_KEYS : OBJECT_KEYS;
              const done = keys.filter((k) => l.answers[k]?.value).length;
              return (
                <div key={l.id} className="glass-soft rounded-2xl p-4">
                  <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === l.id ? "" : l.id)}>
                    <span className="font-medium">{l.name} <span className="text-xs text-[var(--text-muted)]">{l.type === "investor" ? "инвестор" : "объект"} · {l.lang.toUpperCase()}{l.contact ? " · " + l.contact : ""}</span></span>
                    <span className="flex items-center gap-2"><Chip tone={l.state === "qualified" ? "green" : l.state === "escalated" ? "red" : "muted"}>{LEAD_RU[l.state]}</Chip><span className="text-xs tabular-nums text-[var(--text-muted)]">{done}/{keys.length}</span></span>
                  </button>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--line-soft)]"><div className="spectrum-progress h-full" style={{ width: (done / keys.length) * 100 + "%" }} /></div>
                  {open === l.id && (
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      <ul className="space-y-1 text-sm">{keys.map((k) => <li key={k} className="flex gap-2"><span className={l.answers[k]?.value ? "text-[#34c759]" : "text-[var(--text-faint)]"}>{l.answers[k]?.value ? "✓" : "○"}</span><span className="text-[var(--text-muted)]">{CHECKLIST_RU[k]}:</span><span>{l.answers[k]?.value || "—"}</span></li>)}</ul>
                      <div>
                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1 text-sm">
                          {l.transcript.map((m) => <div key={m.at + m.from + m.text.slice(0, 40)} className={"rounded-xl px-3 py-2 " + (m.from === "contact" ? "bg-[var(--surface-strong)]" : "border border-[var(--line-soft)]")}><span className="text-[10px] uppercase text-[var(--text-faint)]">{m.from === "contact" ? l.name : "агент"}</span><div className="whitespace-pre-wrap">{m.text}</div></div>)}
                        </div>
                        {l.escalation && <p className="mt-2 text-xs text-[#ff375f]">Эскалация: «{l.escalation}»</p>}
                        <textarea className={inputClass + " mt-2 h-20"} aria-label="Вставьте ответ контакта…" placeholder="Вставьте ответ контакта…" value={reply} onChange={(e) => setReply(e.target.value)} />
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button variant="spectrum" disabled={!reply.trim()} onClick={() => void act("lead.reply", { id: l.id, text: reply }).then((r) => { if (r?.ok) setReply(""); })}>Обработать ответ</Button>
                          <Button onClick={() => void act("card.state", { type: "lead", id: l.id, state: "handed_over" })}><Check size={13} />Беру в работу</Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <Panel title="Новый диалог вручную" icon={Users} color="#34c759">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} aria-label="Имя" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={inputClass} aria-label="Контакт (email, телефон, @username)" placeholder="Контакт (email, телефон, @username)" value={contact} onChange={(e) => setContact(e.target.value)} />
          <Button variant="spectrum" disabled={!name} onClick={() => void act("lead.create", { type: "investor", name, contact }).then(() => { setName(""); setContact(""); })}>Создать</Button>
        </div>
      </Panel>
    </>
  );
}

function DraftsTab({ state, act }: { state: State; act: Act }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const pending = state.drafts.filter((d) => d.state === "pending");
  const approved = state.drafts.filter((d) => d.state === "approved");
  const decide = async (d: Draft, decision: "approve" | "reject" | "edit") => {
    const r = await act("draft.decide", { id: d.id, decision, text: edits[d.id] });
    if (r?.link) setLinks((x) => ({ ...x, [d.id]: r.link }));
  };
  const card = (d: Draft) => (
    <div key={d.id} className="glass-soft rounded-2xl p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{d.target.name}</span>
        <Chip tone="violet">{d.kind === "partnership" ? "партнёрство" : d.kind === "reminder" ? "напоминание" : "первое касание"}</Chip>
        <Chip>{d.channel}</Chip><Chip>{d.lang.toUpperCase()}</Chip>
        {d.target.contact && <span className="truncate text-xs text-[var(--text-muted)]">{d.target.contact}</span>}
      </div>
      <textarea aria-label="Текст сообщения" className={inputClass + " h-36"} value={edits[d.id] ?? d.text} disabled={d.state !== "pending"} onChange={(e) => setEdits((x) => ({ ...x, [d.id]: e.target.value }))} />
      <div className="mt-2 flex flex-wrap gap-2">
        {d.state === "pending" ? <>
          <Button variant="spectrum" onClick={() => void decide(d, "approve")}><Send size={13} />Отправить</Button>
          <Button disabled={edits[d.id] === undefined || edits[d.id] === d.text} onClick={() => void decide(d, "edit")}><Pencil size={13} />Изменить</Button>
          <Button variant="danger" onClick={() => void decide(d, "reject")}><X size={13} />Отклонить</Button>
        </> : <>
          {(links[d.id] || "").length > 0 && <a className="spectrum-button inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-white" href={safeHref(links[d.id])} target="_blank" rel="noreferrer"><Send size={13} />Открыть и отправить</a>}
          <Button onClick={() => { void navigator.clipboard?.writeText(d.text); }}>Скопировать текст</Button>
          <Button onClick={() => void act("draft.sent", { id: d.id })}><Check size={13} />Отправлено</Button>
        </>}
      </div>
    </div>
  );
  return (
    <>
      <Panel title={"На одобрение · " + pending.length} icon={Send} color="#af52de">
        <p className="mb-3 text-xs text-[var(--text-muted)]">Первое касание только по согласованным шаблонам: кто мы, откуда контакт, зачем пишем, как отписаться. Стоп-лист и дневные лимиты проверяются при нажатии «Отправить».</p>
        {pending.length ? <div className="grid gap-3 lg:grid-cols-2">{pending.map((d) => card(d))}</div> : <Empty>Нет сообщений на одобрение.</Empty>}
      </Panel>
      {approved.length > 0 && <Panel title={"Одобрено, ждёт отправки · " + approved.length} icon={Check} color="#34c759"><div className="grid gap-3 lg:grid-cols-2">{approved.map((d) => card(d))}</div></Panel>}
    </>
  );
}

function IntelTab({ state, act }: { state: State; act: Act }) {
  const [kind, setKind] = useState<WatchItem["kind"]>("person");
  const [value, setValue] = useState("");
  const groups: Array<[ScoutSource["state"], string]> = [["candidate", "Новые — одобрить или отклонить"], ["approved", "Подключены"], ["dead", "«Мёртвые» — 30 дней без пользы"]];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Panel title="Новые источники" icon={Telescope} color="#ff2d55">
        {groups.map(([st, label]) => {
          const list = state.sources.filter((s) => s.state === st);
          if (!list.length && st !== "candidate") return null;
          return (
            <div key={st} className="mb-5">
              <h3 className="mb-2 text-xs uppercase tracking-[.14em] text-[var(--text-muted)]">{label} · {list.length}</h3>
              {!list.length ? <Empty>Пока пусто. Разведка ищет новые группы, каналы и платформы каждый день.</Empty> : (
                <div className="space-y-2">
                  {list.map((s) => (
                    <div key={s.id} className="glass-soft rounded-2xl p-3">
                      <div className="flex flex-wrap items-center gap-2"><a href={safeHref(s.url)} target="_blank" rel="noreferrer" className="font-medium hover:underline">{s.name}</a><Chip tone="blue">{s.kind}</Chip>{s.country && <Chip>{s.country}</Chip>}{s.members ? <Chip tone="gold">{s.members.toLocaleString("ru-RU")} чел.</Chip> : null}{s.hasApi && <Chip tone="green">API</Chip>}{s.recommendation && <Chip tone="violet">{s.recommendation === "join" ? "вступить" : s.recommendation === "connect" ? "подключить" : "игнорировать"}</Chip>}</div>
                      {s.summary && <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{s.summary}</p>}
                      {st === "approved" && <p className="mt-1 text-xs text-[var(--text-faint)]">Полезных результатов: {s.usefulCount} · последний: {when(s.lastUsefulAt)}</p>}
                      <div className="mt-2 flex gap-2">
                        {st !== "approved" && <Button variant="spectrum" onClick={() => void act("source.state", { id: s.id, state: "approved" })}><Check size={13} />Одобрить</Button>}
                        {st === "candidate" && <Button onClick={() => void act("source.state", { id: s.id, state: "rejected" })}><X size={13} />Отклонить</Button>}
                        {st !== "candidate" && <Button variant="danger" onClick={() => void act("source.state", { id: s.id, state: "disabled" })}>Отключить</Button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Panel>
      <Panel title="Watchlist" icon={Radar} color="#ffd60a">
        <p className="mb-2 text-xs text-[var(--text-muted)]">Персоны и группы с публичным Telegram-каналом (@канал или t.me/…) читаются каждый день. Ключевые слова расширяют поиск новых групп, домены — поиск объектов.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select aria-label="Тип наблюдения" className={inputClass + " sm:w-36"} value={kind} onChange={(e) => setKind(e.target.value as WatchItem["kind"])}>
            <option value="person">персона</option><option value="group">группа</option><option value="keyword">ключ</option><option value="domain">домен</option>
          </select>
          <input className={inputClass} aria-label="@valencia_realty, t.me/…, недвижимость Валенсия, kyero.com" placeholder="@valencia_realty, t.me/…, недвижимость Валенсия, kyero.com" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button variant="spectrum" disabled={!value.trim()} onClick={() => void act("watch.add", { kind, value }).then(() => setValue(""))}>Добавить</Button>
        </div>
        <ul className="mt-4 divide-y divide-[var(--line-soft)] text-sm">
          {state.watch.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate"><Chip tone="gold">{{ person: "персона", group: "группа", keyword: "ключ", domain: "домен" }[w.kind]}</Chip> {w.value}{w.hits ? <span className="text-xs text-[var(--text-muted)]"> · постов: {w.hits}</span> : null}</span>
              <button type="button" aria-label="Удалить" className="text-[var(--text-faint)] hover:text-[#ff375f]" onClick={() => void act("watch.remove", { id: w.id })}><Trash2 size={14} /></button>
            </li>
          ))}
          {!state.watch.length && <li className="py-2 text-xs text-[var(--text-faint)]">Пока пусто.</li>}
        </ul>
        <h3 className="mb-1 mt-4 text-xs uppercase tracking-[.14em] text-[var(--text-muted)]">Ключи мониторинга по умолчанию</h3>
        <p className="text-xs text-[var(--text-faint)]">{state.settings.monitorKeywords.join(" · ")}</p>
      </Panel>
    </div>
  );
}

function SettingsTab({ state, act }: { state: State; act: Act }) {
  const s = state.settings;
  const [targets, setTargets] = useState(s.targets.map((t) => [t.country, t.city || "", t.types.join(", "), t.lang].join(" | ")).join("\n"));
  const [priceMin, setPriceMin] = useState(String(s.priceMin || ""));
  const [priceMax, setPriceMax] = useState(String(s.priceMax || ""));
  const [discount, setDiscount] = useState(String(s.minDiscountPct));
  const [market, setMarket] = useState(Object.entries(s.marketPricePerM2).map(([k, v]) => k + ": " + v).join("\n"));
  const [limits, setLimits] = useState(s.dailyLimits);
  const [company, setCompany] = useState(s.companyName);
  const [sender, setSender] = useState(s.senderName);
  const [keywords, setKeywords] = useState(s.monitorKeywords.join("\n"));
  const [tplId, setTplId] = useState("investor_first");
  const [tplLang, setTplLang] = useState<"ru" | "en" | "es" | "uk">("ru");
  const [templates, setTemplates] = useState(s.templates);
  const [stop, setStop] = useState("");
  const [forget, setForget] = useState("");
  const [meet, setMeet] = useState("");
  const [meetLink, setMeetLink] = useState("");

  const save = () => void act("settings.save", { settings: {
    targets: targets.split("\n").map((line) => line.split("|").map((x) => x.trim())).filter((p) => p[0]).map(([country, city, types, lang]) => ({ country, city, types: (types || "").split(",").map((t) => t.trim()).filter(Boolean), lang: lang || "en" })),
    priceMin: Number(priceMin) || 0, priceMax: Number(priceMax) || 0, minDiscountPct: Number(discount) || 0,
    marketPricePerM2: Object.fromEntries(market.split("\n").map((l) => l.split(":").map((x) => x.trim())).filter((p) => p[0] && Number(p[1]) > 0).map(([k, v]) => [k, Number(v)])),
    dailyLimits: limits, companyName: company, senderName: sender, monitorKeywords: keywords.split("\n").map((k) => k.trim()).filter(Boolean), templates,
  } }, "settings");

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Критерии поиска" icon={Settings2} color="#a3b6c4" actions={<Button variant="spectrum" onClick={save}>Сохранить всё</Button>}>
        <label htmlFor="scout-targets" className="text-xs text-[var(--text-muted)]">Страна | город | типы | язык поиска (по строке)</label>
        <textarea id="scout-targets" className={inputClass + " h-28 font-mono text-xs"} value={targets} onChange={(e) => setTargets(e.target.value)} />
        <p className="mb-3 text-[11px] text-[var(--text-faint)]">Типы: apartment, penthouse, house, villa, land, commercial, hotel. Языки: es, en, ru, uk.</p>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-[var(--text-muted)]">Цена от, €<input className={inputClass} value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></label>
          <label className="text-xs text-[var(--text-muted)]">Цена до, €<input className={inputClass} value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></label>
          <label className="text-xs text-[var(--text-muted)]">Ниже рынка от, %<input className={inputClass} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
        </div>
        <label htmlFor="scout-market" className="mt-3 block text-xs text-[var(--text-muted)]">Рыночная цена €/м² по городам (для скоринга «ниже рынка»)</label>
        <textarea className={inputClass + " h-28 font-mono text-xs"} id="scout-market" value={market} onChange={(e) => setMarket(e.target.value)} />
        <label htmlFor="scout-keywords" className="mt-3 block text-xs text-[var(--text-muted)]">Ключевые слова мониторинга групп (по строке)</label>
        <textarea className={inputClass + " h-24 text-xs"} id="scout-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
      </Panel>
      <Panel title="Первое касание" icon={Send} color="#af52de">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-[var(--text-muted)]">Компания<input className={inputClass} value={company} onChange={(e) => setCompany(e.target.value)} /></label>
          <label className="text-xs text-[var(--text-muted)]">Отправитель<input className={inputClass} value={sender} onChange={(e) => setSender(e.target.value)} /></label>
        </div>
        <div className="mt-3 block text-xs text-[var(--text-muted)]">Лимиты сообщений в день по каналам</div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(limits).map(([k, v]) => <label key={k} className="text-[11px] text-[var(--text-faint)]">{k}<input className={inputClass} value={v} onChange={(e) => setLimits({ ...limits, [k]: Number(e.target.value) || 0 })} /></label>)}
        </div>
        <label htmlFor="scout-template" className="mt-3 block text-xs text-[var(--text-muted)]">Шаблоны (плейсхолдеры: {"{name} {company} {sender} {source} {object} {city} {unsubscribe} {bot}"})</label>
        <div className="mb-2 flex gap-2">
          <select className={inputClass} aria-label="Шаблон" value={tplId} onChange={(e) => setTplId(e.target.value)}>{Object.keys(templates).map((id) => <option key={id} value={id}>{id}</option>)}</select>
          <select className={inputClass + " w-24"} aria-label="Язык шаблона" value={tplLang} onChange={(e) => setTplLang(e.target.value as any)}>{["ru", "en", "es", "uk"].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select>
        </div>
        <textarea id="scout-template" className={inputClass + " h-40 text-xs"} value={templates[tplId]?.[tplLang] || ""} onChange={(e) => setTemplates({ ...templates, [tplId]: { ...templates[tplId], [tplLang]: e.target.value } })} />
      </Panel>
      <Panel title="Стоп-лист и GDPR" icon={ShieldCheck} color="#ff375f">
        <label htmlFor="scout-stop" className="text-xs text-[var(--text-muted)]">Больше никогда не писать этому контакту</label>
        <div className="mb-3 flex gap-2"><input className={inputClass} placeholder="email, телефон, @username" id="scout-stop" value={stop} onChange={(e) => setStop(e.target.value)} /><Button disabled={!stop} onClick={() => void act("stop.add", { contact: stop }).then(() => setStop(""))}>В стоп-лист</Button></div>
        <label htmlFor="scout-forget" className="text-xs text-[var(--text-muted)]">Право на удаление: стереть все записи с контактом</label>
        <div className="flex gap-2"><input className={inputClass} placeholder="email, телефон, @username" id="scout-forget" value={forget} onChange={(e) => setForget(e.target.value)} /><Button variant="danger" disabled={!forget} onClick={() => void act("forget", { contact: forget }).then(() => setForget(""))}><Trash2 size={13} />Удалить</Button></div>
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">В стоп-листе хранится только хэш контакта. Данные лежат в Upstash Redis — выберите европейский регион при подключении.</p>
      </Panel>
      <Panel title="Встречи" icon={CalendarPlus} color="#0a84ff">
        <div className="flex gap-2"><input className={inputClass} aria-label="18.10 11:00 Zoom — Engel & Völkers Valencia" placeholder="18.10 11:00 Zoom — Engel & Völkers Valencia" value={meet} onChange={(e) => setMeet(e.target.value)} /><Button variant="spectrum" disabled={!meet} onClick={() => void act("meeting.create", { text: meet }).then((r) => { if (r?.ok) { setMeet(""); setMeetLink(r.google); } })}>Создать</Button></div>
        {meetLink && <a href={safeHref(meetLink)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-[#0a84ff] underline">Добавить в Google Календарь</a>}
        <ul className="mt-3 divide-y divide-[var(--line-soft)] text-sm">
          {state.meetings.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-2"><span>{when(m.startsAt)} — {m.where}, {m.with}</span><a className="text-xs text-[#0a84ff] underline" href={"/api/scout/ics?id=" + m.id}>.ics</a></li>)}
          {!state.meetings.length && <li className="py-2 text-xs text-[var(--text-faint)]">Встреч нет.</li>}
        </ul>
      </Panel>
    </div>
  );
}

function taskTone(state: string): ChipTone {
  if (state === "done") return "green";
  if (state === "failed") return "red";
  if (state === "stopped") return "muted";
  return "blue";
}

function taskLabel(state: string) {
  if (state === "clarifying") return "Жду уточнение";
  if (state === "running") return "Ищу";
  if (state === "done") return "Готово";
  if (state === "stopped") return "Остановлено";
  if (state === "failed") return "Ошибка";
  return state;
}

function TasksTab({ state, act }: Readonly<{ state: State; act: Act }>) {
  const tasks = state.researchTasks || [];
  const active = tasks.filter((task) => task.state === "running" || task.state === "clarifying");
  const failed = tasks.filter((task) => task.state === "failed");
  const complete = tasks.filter((task) => task.state === "done");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Активные" value={active.length} color="#64d2ff" />
        <Kpi label="Завершены" value={complete.length} color="#34c759" />
        <Kpi label="Ошибки" value={failed.length} color="#ff375f" />
        <Kpi label="Всего сохранено" value={tasks.length} color="#ffd60a" />
      </div>
      <Panel title="Мои поиски" icon={ListChecks} color="#64d2ff">
        {!tasks.length ? <Empty>Поисков пока нет. Напишите боту в Telegram, что нужно найти.</Empty> : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <article key={task.id} className="glass-soft scout-row-card rounded-2xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={taskTone(task.state)}>{taskLabel(task.state)}</Chip>
                  </div>
                  <span className="text-xs text-[var(--text-faint)]">{when(task.updatedAt)}</span>
                </div>
                <p className="mt-2 text-sm text-[var(--text)]">{task.query}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div><span className="text-[var(--text-faint)]">Проверено источников</span><div className="text-lg tabular-nums">{task.counters.sourcesChecked}</div></div>
                  <div><span className="text-[var(--text-faint)]">Найдено</span><div className="text-lg tabular-nums">{task.counters.afterDedupe}</div></div>
                  <div><span className="text-[var(--text-faint)]">Подтверждено</span><div className="text-lg tabular-nums text-[#34c759]">{task.counters.matchingCriteria}</div></div>
                  <div><span className="text-[var(--text-faint)]">Нужно проверить</span><div className="text-lg tabular-nums text-[#ffd60a]">{task.counters.needsReview}</div></div>
                </div>
                {task.error && <p className="mt-2 rounded-xl border border-[#ff375f]/30 bg-[#ff375f]/10 p-2 text-xs text-[#ff7a93]">{task.error}</p>}
                {(task.state === "running" || task.state === "clarifying") && (
                  <div className="mt-3">
                    <Button variant="danger" onClick={() => void act("research.cancel", { chatId: task.chatId }, "research.cancel")}><X size={13} />Остановить задачу</Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function healthTone(level: HealthCheckRow["level"]): ChipTone {
  if (level === "ok") return "green";
  if (level === "warning") return "gold";
  return "red";
}

function healthStatus(value: boolean, okLabel: string, failLabel: string, okColor: string, failColor: string) {
  return value ? { value: okLabel, color: okColor } : { value: failLabel, color: failColor };
}

function HealthSummary({ health }: Readonly<{ health: HealthState }>) {
  const overall = healthStatus(health.ok, "OK", "ATTN", "#34c759", "#ff9500");
  const redis = healthStatus(health.persistence.roundTrip, "OK", "FAIL", "#34c759", "#ff375f");
  const telegram = healthStatus(health.telegram.apiOk, "OK", "FAIL", "#34c759", "#ff375f");
  const zeroCost = healthStatus(health.ai.zeroCost, "ON", "OFF", "#34c759", "#ffd60a");

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label="Общий статус" value={overall.value} color={overall.color} />
      <Kpi label="Redis" value={redis.value} color={redis.color} />
      <Kpi label="Telegram" value={telegram.value} color={telegram.color} />
      <Kpi label="Zero-cost" value={zeroCost.value} color={zeroCost.color} />
    </div>
  );
}

function HealthChecks({ checks }: Readonly<{ checks: HealthCheckRow[] }>) {
  return (
    <div className="space-y-2">
      {checks.map((item) => (
        <div key={item.id} className="glass-soft flex flex-col gap-1 rounded-2xl p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Chip tone={healthTone(item.level)}>{item.level.toUpperCase()}</Chip>
            <span className="font-medium">{item.label}</span>
          </div>
          <span className="text-xs text-[var(--text-muted)] sm:max-w-[65%] sm:text-right">{item.detail}</span>
        </div>
      ))}
    </div>
  );
}

function HealthDetails({ health }: Readonly<{ health: HealthState }>) {
  const searchLabel = health.search.providers.join(", ") || "none";
  const directReadLabel = health.search.directRead ? " + direct read" : "";
  const aiLabel = health.ai.providers.length
    ? health.ai.providers.map((provider) => provider.provider + ":" + provider.model).join(", ")
    : "deterministic fallback only";

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="glass-soft rounded-2xl p-3 text-xs text-[var(--text-muted)]">
        <div className="mb-1 font-medium text-[var(--text)]">Search</div>
        {searchLabel}{directReadLabel}
      </div>
      <div className="glass-soft rounded-2xl p-3 text-xs text-[var(--text-muted)]">
        <div className="mb-1 font-medium text-[var(--text)]">AI</div>
        {aiLabel}
      </div>
    </div>
  );
}

function HealthContent({ health }: Readonly<{ health: HealthState | null }>) {
  if (!health) return <Empty>Проверяю Telegram, Redis, AI route, search и security…</Empty>;
  return (
    <div>
      <HealthSummary health={health} />
      <HealthChecks checks={health.checks} />
      <HealthDetails health={health} />
    </div>
  );
}

function HealthTab({ headers }: Readonly<{ headers: () => Record<string, string> }>) {
  const [health, setHealth] = useState<HealthState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/scout/health", { headers: headers(), cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!data) {
        setError("Не удалось прочитать health endpoint.");
        return;
      }
      setHealth(data);
      if (!response.ok && !data.checks) setError(data.error || "Health check failed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Health check failed.");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Panel
      title="Production health"
      icon={Activity}
      color="#30d158"
      actions={<Button onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} />{loading ? "Проверяю…" : "Проверить снова"}</Button>}
    >
      {error && <div className="mb-3 rounded-xl border border-[#ff375f]/30 bg-[#ff375f]/10 p-3 text-sm text-[#ff7a93]">{error}</div>}
      <HealthContent health={health} />
    </Panel>
  );
}

function LogTab({ state }: { state: State }) {
  return (
    <Panel title="Журнал действий агента" icon={ScrollText} color="#c9a96a">
      {!state.log.length ? <Empty>Журнал пуст.</Empty> : (
        <ul className="divide-y divide-[var(--line-soft)] text-sm">
          {state.log.map((e) => <li key={e.at + e.action + (e.detail || "")} className="flex flex-wrap gap-x-3 py-2"><span className="w-28 shrink-0 tabular-nums text-[var(--text-faint)]">{when(e.at)}</span><Chip tone={e.actor === "human" ? "gold" : e.actor === "bot" ? "blue" : "muted"}>{e.actor}</Chip><span className="font-mono text-xs">{e.action}</span><span className="text-[var(--text-muted)]">{e.detail}</span></li>)}
        </ul>
      )}
    </Panel>
  );
}
