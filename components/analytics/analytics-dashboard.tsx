"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Compass, Download, Lightbulb, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { Atmosphere } from "@/components/site-chrome";

// Analytics: every saved search and journal entry, platform metrics, the system's own
// conclusions, and downloads. Same access key as /groups, /scout and /advisor.

const KEY_STORAGE = "aurelius-scout-key";
const inputClass = "scout-input w-full rounded-lg border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--line)]";
const chip = (active: boolean) => "rounded-full px-3 py-1 text-[12px] transition " + (active ? "bg-[var(--gold)]/15 text-[var(--gold-bright)]" : "text-[var(--text-muted)] hover:text-[var(--text)]");

type Insight = { level: "risk" | "warn" | "good" | "idea"; title: string; detail: string };
type Entry = { at: string; actor: string; action: string; detail?: string };

const LEVEL = {
  risk: { icon: ShieldAlert, color: "#ff453a", label: "Риск" },
  warn: { icon: AlertTriangle, color: "#ff9f0a", label: "Внимание" },
  good: { icon: CheckCircle2, color: "#30d158", label: "Работает" },
  idea: { icon: Lightbulb, color: "#bf5af2", label: "Рекомендация" },
} as const;

type Platform = "telegram" | "instagram" | "tiktok" | "facebook";
const PLATFORMS: Array<[Platform, string, string]> = [["telegram", "Telegram", "✈️"], ["instagram", "Instagram", "📸"], ["tiktok", "TikTok", "🎵"], ["facebook", "Facebook", "📘"]];
const ORIGIN = (o?: string) => (o === "telegram" ? "Бот" : "Сайт");
const ACTOR: Record<string, string> = { human: "человек", bot: "бот", agent: "агент", cron: "расписание" };
const fmt = (v: unknown) => Number(v || 0).toLocaleString("ru-RU");
const when = (iso: string) => { try { return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

export default function AnalyticsDashboard() {
  const [key, setKey] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"searches" | "journal">("searches");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState<"all" | "web" | "telegram">("all");
  const [platform, setPlatform] = useState<"all" | Platform>("all");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<any>(null);
  const [status, setStatus] = useState("");

  useEffect(() => { try { setKey(window.localStorage.getItem(KEY_STORAGE) || ""); } catch {} }, []);
  const auth = useCallback((): Record<string, string> => (key ? { "x-scout-key": key } : {}), [key]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    const res = await fetch("/api/analytics" + (fresh ? "?fresh=1" : ""), { headers: auth(), cache: "no-store" }).catch(() => null);
    setLoading(false);
    if (!res) { setStatus("Сервер не ответил."); return; }
    if (res.status === 401) { setNeedKey(true); return; }
    setNeedKey(false);
    setData(await res.json());
  }, [auth]);
  useEffect(() => { void load(); }, [load]);

  const download = async (params: string, fallbackName: string) => {
    setStatus("Готовлю файл…");
    const res = await fetch("/api/analytics?" + params, { headers: auth() }).catch(() => null);
    if (!res?.ok) { setStatus("Не удалось скачать."); return; }
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") || "")?.[1] || fallbackName);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
    setStatus("");
  };

  const openRun = async (id: string) => {
    setOpen({ id, loading: true });
    const res = await fetch("/api/analytics?run=" + encodeURIComponent(id), { headers: auth(), cache: "no-store" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setOpen(body?.ok ? body.run : { id, error: body?.error || "Не удалось открыть." });
  };

  const a = data?.analytics;
  const t = a?.totals || {};
  const runs: any[] = useMemo(() => (data?.runs || []).filter((r: any) =>
    (origin === "all" || (r.origin || "web") === origin) && (platform === "all" || Number(r.byPlatform?.[platform]) > 0) && (!q || String(r.query || "").toLowerCase().includes(q.toLowerCase()))), [data, origin, q]);
  const kinds = useMemo(() => Array.from(new Set((data?.journal || []).map((e: Entry) => e.action.split(".")[0]))).sort((x: any, y: any) => String(x).localeCompare(String(y))) as string[], [data]);
  const journal: Entry[] = useMemo(() => (data?.journal || []).filter((e: Entry) =>
    (kind === "all" || e.action.split(".")[0] === kind) && (!q || (e.action + " " + (e.detail || "")).toLowerCase().includes(q.toLowerCase()))), [data, kind, q]);
  const maxDaily = Math.max(1, ...((a?.daily || []).map((d: any) => d.actions + d.searches)));

  const kpis: Array<[string, string, string]> = a ? [
    ["Поисков", fmt(t.searches), "за 7 дней " + fmt(t.searchesWeek) + (t.searchesPrevWeek ? " · раньше " + fmt(t.searchesPrevWeek) : "")],
    ["Результатов", fmt(t.results), "в среднем " + t.avgResults + " на поиск"],
    ["Подтверждено", t.verifiedShare + "%", fmt(t.verified) + " с доказательствами"],
    ["Без результатов", fmt(t.zeroResultSearches), t.searches ? Math.round((t.zeroResultSearches / t.searches) * 100) + "% поисков" : "—"],
    ["Источников в памяти", fmt(t.knownSources), fmt(t.sourceHealth?.healthy) + " рабочих · " + fmt(t.sourceHealth?.failing) + " не работают"],
    ["Сообществ", fmt(t.groups), "бот публикует в " + fmt(t.botReadyGroups)],
    ["Публикаций", fmt(t.postsSent), t.postsSent + t.postsFailed ? "успех " + t.postSuccess + "% · очередь " + fmt(t.queuePending) : "очередь " + fmt(t.queuePending)],
    ["Действий в журнале", fmt(t.journalEntries), "ошибок за неделю " + fmt(t.errorsWeek)],
  ] : [];

  return (
    <main className="scout-ui relative isolate min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)] spectrum-shell">
      <Atmosphere />
      <div className="app-grid pointer-events-none fixed inset-0 z-0 opacity-45" />
      <div className="relative z-10 mx-auto flex max-w-[1180px] flex-col gap-4 px-4 pb-28 pt-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/" className="brand-mark font-display text-[24px] tracking-[.19em]">AURELIUS</Link>
            <h1 className="mt-1 flex items-center gap-2 text-[18px] font-light"><BarChart3 size={16} style={{ color: "#0a84ff" }} />Аналитика</h1>
            <p className="text-[12px] text-[var(--text-muted)]">Только реальные данные: каждый поиск, результат и действие на сайте и в Telegram. На этой истории система учится и советник строит выводы.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load(true)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-soft)] px-3 text-[12px] text-[var(--text-soft)]"><RefreshCw size={13} className={loading ? "animate-spin" : ""} />Обновить</button>
            <button type="button" disabled={!a} onClick={() => void download("export=all&format=xlsx", "aurelius-all.xlsx")} className="spectrum-button inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-white disabled:opacity-40"><Download size={13} />Всё в Excel</button>
            <button type="button" disabled={!a} onClick={() => void download("export=all&format=json", "aurelius-all.json")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-soft)] px-3 text-[12px] text-[var(--text-soft)] disabled:opacity-40"><Download size={13} />JSON</button>
          </div>
        </header>

        {needKey && (
          <section className="glass rounded-[18px] p-4">
            <p className="mb-2 text-[13px]">Нужен ключ доступа</p>
            <div className="flex gap-2">
              <input className={inputClass} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ключ доступа (как в Разведчике)" />
              <button type="button" className="spectrum-button rounded-md px-3 text-[12px] text-white" onClick={() => { try { window.localStorage.setItem(KEY_STORAGE, key); } catch {} void load(); }}>Войти</button>
            </div>
          </section>
        )}
        {status && <p className="text-[12px] text-[var(--text-muted)]">{status}</p>}
        {!a && !needKey && <p className="text-[13px] text-[var(--text-muted)]">Загружаю данные…</p>}

        {a && (
          <>
            {!a.persistent && <p className="rounded-xl border border-[#ff453a]/30 px-3 py-2 text-[12px] text-[#ff453a]">Постоянное хранилище не подключено: данные живут только до перезапуска сервера.</p>}

            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {kpis.map(([label, value, note]) => (
                <div key={label} className="glass rounded-2xl p-4">
                  <div className="text-[12px] text-[var(--text-muted)]">{label}</div>
                  <div className="font-display mt-2 text-[28px] font-normal leading-none tabular-nums">{value}</div>
                  <div className="mt-1 text-[11px] text-[var(--text-faint)]">{note}</div>
                </div>
              ))}
            </section>

            <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div className="glass rounded-[18px] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[14px] font-light">Выводы системы</h2>
                  <Link href="/advisor" className="inline-flex items-center gap-1 text-[12px] text-[var(--gold-bright)]"><Compass size={13} />Разобрать с советником</Link>
                </div>
                {!a.insights.length && <p className="text-[12.5px] text-[var(--text-muted)]">Проблем не найдено.</p>}
                <ul className="space-y-2">
                  {a.insights.map((i: Insight) => {
                    const L = LEVEL[i.level];
                    return (
                      <li key={i.title} className="flex gap-2 rounded-xl border border-[var(--line-soft)] px-3 py-2">
                        <L.icon size={15} className="mt-0.5 shrink-0" style={{ color: L.color }} />
                        <div>
                          <div className="text-[13px]">{i.title} <span className="text-[11px]" style={{ color: L.color }}>· {L.label}</span></div>
                          <div className="text-[12px] leading-relaxed text-[var(--text-muted)]">{i.detail}</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="glass rounded-[18px] p-4">
                <h2 className="mb-3 text-[14px] font-light">Активность за 14 дней</h2>
                <div className="flex h-[120px] items-end gap-1" role="img" aria-label="Поиски и действия по дням">
                  {a.daily.map((d: any) => (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={d.day + ": поисков " + d.searches + ", действий " + d.actions + ", ошибок " + d.errors}>
                      <div className="flex w-full flex-col justify-end" style={{ height: 100 }}>
                        <div className="w-full rounded-t-sm bg-[var(--gold)]/70" style={{ height: (d.searches / maxDaily) * 100 }} />
                        <div className="w-full bg-[#0a84ff]/45" style={{ height: ((d.actions - d.errors) / maxDaily) * 100 }} />
                        <div className="w-full bg-[#ff453a]/70" style={{ height: (d.errors / maxDaily) * 100 }} />
                      </div>
                      <span className="text-[9px] text-[var(--text-faint)]">{d.day.slice(8)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-3 text-[11px] text-[var(--text-muted)]">
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[var(--gold)]/70" />поиски</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#0a84ff]/45" />действия</span>
                  <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#ff453a]/70" />ошибки</span>
                </div>
                <h3 className="mb-1 mt-4 text-[13px] font-light">Лучшие источники</h3>
                {!a.topSources.length && <p className="text-[12px] text-[var(--text-muted)]">Появятся после первых поисков.</p>}
                {a.topSources.slice(0, 6).map((s: any) => (
                  <div key={s.domain} className="flex justify-between text-[12px]"><span className="truncate text-[var(--text-soft)]">{s.domain}</span><span className="tabular-nums text-[var(--text-muted)]">{s.quality} · {s.results} рез.</span></div>
                ))}
                {!!a.weakSources.length && <h3 className="mb-1 mt-3 text-[13px] font-light">Не работают</h3>}
                {a.weakSources.slice(0, 5).map((s: any) => (
                  <div key={s.domain} className="flex justify-between gap-2 text-[12px]" title={s.lastError}><span className="truncate text-[var(--text-soft)]">{s.domain}</span><span className="shrink-0 text-[#ff9f0a]">{s.failures} сбоев</span></div>
                ))}
              </div>
            </section>

            <section className="glass rounded-[18px] p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button type="button" className={chip(tab === "searches")} onClick={() => setTab("searches")}>Поиски ({fmt(data.runs.length)})</button>
                <button type="button" className={chip(tab === "journal")} onClick={() => setTab("journal")}>Журнал действий ({fmt(data.journal.length)})</button>
                <div className="relative ml-auto w-full sm:w-[260px]">
                  <Search size={13} className="absolute left-2.5 top-2.5 text-[var(--text-faint)]" />
                  <input className={inputClass + " pl-8"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти…" />
                </div>
              </div>

              {tab === "searches" ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[11px] text-[var(--text-faint)]">Откуда</span>
                    {(["all", "web", "telegram"] as const).map((o) => <button key={o} type="button" className={chip(origin === o)} onClick={() => setOrigin(o)}>{o === "all" ? "Все" : o === "web" ? "Сайт" : "Бот"}</button>)}
                    <span className="ml-3 mr-1 text-[11px] text-[var(--text-faint)]">Площадка</span>
                    <button type="button" className={chip(platform === "all")} onClick={() => setPlatform("all")}>Все</button>
                    {PLATFORMS.map(([p, label, icon]) => <button key={p} type="button" className={chip(platform === p)} onClick={() => setPlatform(p)}>{icon} {label}</button>)}
                    <button type="button" onClick={() => void download("export=runs&format=csv", "searches.csv")} className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"><Download size={12} />CSV</button>
                  </div>
                  {!runs.length && <p className="py-6 text-center text-[12.5px] text-[var(--text-muted)]">{data.runs.length ? "Ничего не найдено по фильтру." : "Поисков ещё не было. Запустите поиск на главной или в Telegram."}</p>}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-[12.5px]">
                      {!!runs.length && <thead className="text-[11px] text-[var(--text-faint)]"><tr><th className="py-1.5 font-normal">Когда</th><th className="font-normal">Запрос</th><th className="font-normal">Откуда</th><th className="font-normal">Площадки</th><th className="text-right font-normal">Источников</th><th className="text-right font-normal">Результатов</th><th className="text-right font-normal">Подтв.</th></tr></thead>}
                      <tbody>
                        {runs.slice(0, 300).map((r) => (
                          <tr key={r.id || r.createdAt} onClick={() => r.id && void openRun(r.id)} className={"border-t border-[var(--line-soft)] " + (r.id ? "cursor-pointer hover:bg-[var(--surface)]" : "")}>
                            <td className="whitespace-nowrap py-2 pr-3 text-[var(--text-muted)]">{when(r.createdAt)}</td>
                            <td className="max-w-[420px] truncate pr-3">{r.query}</td>
                            <td className="pr-3 text-[var(--text-muted)]">{ORIGIN(r.origin)}</td>
                            <td className="whitespace-nowrap pr-3 text-[var(--text-muted)]">{r.byPlatform ? PLATFORMS.filter(([p]) => r.byPlatform[p]).map(([p, label, icon]) => <span key={p} title={label} className="mr-2">{icon} {r.byPlatform[p]}</span>) : "Сайты"}</td>
                            <td className="text-right tabular-nums">{fmt(r.sourcesFound ?? r.sourceCount)}</td>
                            <td className={"text-right tabular-nums " + (Number(r.results) ? "" : "text-[#ff453a]")}>{fmt(r.results)}</td>
                            <td className="text-right tabular-nums">{fmt(r.verified)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <button type="button" className={chip(kind === "all")} onClick={() => setKind("all")}>Все</button>
                    {kinds.map((k) => <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>{k} <span className="text-[var(--text-faint)]">{a.actionKinds[k] || ""}</span></button>)}
                    <button type="button" onClick={() => void download("export=journal&format=csv", "journal.csv")} className="ml-auto inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"><Download size={12} />CSV</button>
                  </div>
                  {!journal.length && <p className="py-6 text-center text-[12.5px] text-[var(--text-muted)]">Записей нет.</p>}
                  <ul className="divide-y divide-[var(--line-soft)]">
                    {journal.slice(0, 400).map((e, i) => (
                      <li key={e.at + i} className="flex flex-wrap gap-x-3 py-1.5 text-[12.5px]">
                        <span className="w-[92px] shrink-0 tabular-nums text-[var(--text-muted)]">{when(e.at)}</span>
                        <span className="w-[70px] shrink-0 text-[var(--text-faint)]">{ACTOR[e.actor] || e.actor}</span>
                        <span className={"shrink-0 " + (/error|fail|block/i.test(e.action) ? "text-[#ff453a]" : "text-[var(--text-soft)]")}>{e.action}</span>
                        <span className="min-w-0 flex-1 break-words text-[var(--text-muted)]">{e.detail}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-2 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }} onKeyDown={(e) => { if (e.key === "Escape") setOpen(null); }}>
          <div className="glass max-h-[85vh] w-full max-w-[920px] overflow-y-auto rounded-[18px] bg-[var(--surface-strong)] p-4" role="dialog" aria-label="Результаты поиска">
            <div className="mb-3 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14px]">{open.query || open.id}</div>
                {open.createdAt && <div className="text-[11.5px] text-[var(--text-muted)]">{when(open.createdAt)} · {ORIGIN(open.origin)} · источников {fmt(open.sourcesFound ?? open.sourceCount)} · результатов {fmt(open.results?.length ?? 0)}</div>}
              </div>
              <button type="button" onClick={() => setOpen(null)} aria-label="Закрыть" className="text-[var(--text-muted)]"><X size={16} /></button>
            </div>
            {open.loading && <p className="text-[12.5px] text-[var(--text-muted)]">Загружаю…</p>}
            {open.error && <p className="text-[12.5px] text-[var(--text-muted)]">{open.error}</p>}
            {Array.isArray(open.results) && (
              <>
                <div className="mb-3 flex gap-2">
                  {(["xlsx", "csv", "json"] as const).map((f) => (
                    <button key={f} type="button" onClick={() => void download("run=" + encodeURIComponent(open.id) + "&format=" + f, "search." + f)} className="inline-flex h-7 items-center gap-1 rounded-full border border-[var(--line-soft)] px-3 text-[12px] text-[var(--text-soft)]"><Download size={12} />{f.toUpperCase()}</button>
                  ))}
                </div>
                {!open.results.length && <p className="text-[12.5px] text-[var(--text-muted)]">В этом поиске результатов не было.</p>}
                <ol className="space-y-2">
                  {open.results.map((r: any, i: number) => (
                    <li key={i} className="rounded-xl border border-[var(--line-soft)] px-3 py-2 text-[12.5px]">
                      <div className="flex gap-2"><span className="text-[var(--text-faint)]">{i + 1}.</span>
                        {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="text-[var(--text)] underline decoration-[var(--line)] underline-offset-2">{r.title || r.organization || r.url}</a> : <span>{r.title || r.organization}</span>}
                        {r.status && <span className="ml-auto shrink-0 text-[11px] text-[var(--text-muted)]">{r.status}</span>}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">{[r.location || r.geography, r.price || r.ticket, r.contact || r.email || r.phone].filter(Boolean).join(" · ")}</div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
