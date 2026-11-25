"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Ban, BarChart3, CalendarDays, Handshake, Loader2, Mic, Octagon, Radio, Search, Send, Settings2 } from "lucide-react";
import { Atmosphere } from "@/components/site-chrome";
import { startVoiceRecording } from "@/components/voice-recorder";
import type { Campaign, CampaignTask } from "@/lib/scout/campaigns";

// Control panel: one screen over the data /groups already uses (same key, same API).
// Numbers are live: communities in the base, places with admin consent, today's placements, errors.

type Cap = { day: string; target: number; places: number; verified: number; failed: number; awaiting: number };
type Data = { campaigns: Campaign[]; tasks: CampaignTask[]; capacity: Cap; communities: number };

const KEY_STORAGE = "aurelius-scout-key";
const DONE = new Set(["sent", "verified"]);
const fmt = (n: number) => n.toLocaleString("ru-RU");

const SECTIONS = [
  { href: "/groups#search", label: "Поиск", icon: Search, color: "#30d158" },
  { href: "/groups#partners", label: "Партнёры", icon: Handshake, color: "#ff9f0a" },
  { href: "/groups#today", label: "Календарь", icon: CalendarDays, color: "#bf5af2" },
  { href: "/groups#monitoring", label: "Мониторинг", icon: Radio, color: "#64d2ff" },
  { href: "/analytics", label: "Отчёты", icon: BarChart3, color: "#ffd60a" },
  { href: "/scout", label: "Настройки", icon: Settings2, color: "#8e8e93" },
];

function Tile({ label, value, hint }: Readonly<{ label: string; value: string; hint?: string }>) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[12px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-[24px] font-light tabular-nums text-[var(--gold-bright)]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export default function ControlPanel() {
  const [key, setKey] = useState("");
  const [ready, setReady] = useState(false);
  const [needKey, setNeedKey] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [at, setAt] = useState("");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [mic, setMic] = useState<MediaRecorder | null>(null);
  const [hearing, setHearing] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => { try { setKey(window.localStorage.getItem(KEY_STORAGE) || ""); } catch { /* storage blocked */ } setReady(true); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 7000); return () => clearTimeout(t); } }, [toast]);

  const headers = useCallback((): Record<string, string> => ({ "content-type": "application/json", ...(key ? { "x-scout-key": key } : {}) }), [key]);

  const load = useCallback(async () => {
    const [c, g] = await Promise.all([
      fetch("/api/campaigns", { headers: headers(), cache: "no-store" }).catch(() => null),
      fetch("/api/groups", { headers: headers(), cache: "no-store" }).catch(() => null),
    ]);
    if (c?.status === 401 || g?.status === 401) { setNeedKey(true); return; }
    if (!c?.ok) { setToast("Сервер недоступен"); return; }
    setNeedKey(false);
    const camp = await c.json();
    const groups = g?.ok ? await g.json().catch(() => null) : null;
    setData({ campaigns: camp.campaigns || [], tasks: camp.tasks || [], capacity: camp.capacity, communities: groups?.summary?.groups?.total ?? groups?.groups?.length ?? 0 });
    setAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
  }, [headers]);

  useEffect(() => {
    if (!ready) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => clearInterval(t);
  }, [ready, load]);

  const post = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: headers(), body: JSON.stringify({ action, ...payload }) });
      const d = await r.json().catch(() => ({}));
      setToast(d.message || d.error || (r.ok ? "Готово" : "Ошибка"));
      await load();
      return d;
    } finally { setBusy(""); }
  };

  const saveKey = () => { try { window.localStorage.setItem(KEY_STORAGE, key); } catch { /* storage blocked */ } void load(); };

  const cap = data?.capacity;
  const shown = (data?.campaigns || []).filter((c) => c.status === "approved" || c.status === "ready" || c.status === "searching");
  const open = (data?.campaigns || []).filter((c) => c.status !== "stopped").length;
  const doneOf = (c: Campaign) => (data?.tasks || []).filter((t) => t.campaignId === c.id && DONE.has(t.status)).length;

  return (
    <main className="scout-ui relative isolate min-h-screen overflow-x-clip bg-[var(--bg)] pb-24 text-[var(--text)] spectrum-shell">
      <Atmosphere />
      <div className="app-grid pointer-events-none fixed inset-0 z-0 opacity-45" />
      <div className="relative z-10 mx-auto max-w-[860px] space-y-4 px-4 py-6 sm:px-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <Link href="/" className="brand-mark font-display text-[24px] tracking-[.19em]">AURELIUS</Link>
            <h1 className="mt-1 text-[18px] font-light">Пульт управления</h1>
          </div>
          {at && <span className="text-[11px] text-[var(--text-muted)]">обновлено {at}</span>}
        </header>

        {needKey && (
          <section className="glass rounded-2xl p-4">
            <div className="mb-2 text-[14px]">Нужен ключ доступа</div>
            <div className="flex gap-2">
              <input className="scout-input min-h-10 flex-1 rounded-xl border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3 text-[13px] outline-none" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ключ доступа (как в Разведчике)" />
              <button type="button" onClick={saveKey} className="spectrum-button rounded-xl px-4 text-[13px] text-white">Войти</button>
            </div>
          </section>
        )}

        {/* Task: same AI parsing as the bot; the new campaign opens on /groups for keyword approval. */}
        <form className="glass flex items-center gap-2 rounded-2xl p-2 pl-3" onSubmit={async (e) => {
          e.preventDefault();
          if (task.trim().length < 10) { setToast("Опишите задачу: что рекламируем, где, на каких площадках."); return; }
          const d = await post("create", { text: task });
          if (d?.ok) { setTask(""); setToast((d.message || "Кампания создана.") + " Проверьте слова в разделе «Группы»."); }
        }}>
          <button type="button" disabled={hearing} aria-label={mic ? "Остановить запись" : "Сказать голосом"} title={mic ? "Остановить запись" : "Сказать голосом"}
            onClick={async () => { if (mic) { mic.stop(); setMic(null); return; } setMic(await startVoiceRecording((t) => setTask((p) => (p ? p + " " : "") + t), setToast, setHearing)); }}
            className={"grid h-9 w-9 shrink-0 place-items-center rounded-full transition " + (mic ? "bg-red-500/15 text-red-500" : "text-[var(--gold-bright)] hover:bg-[var(--surface-strong)]")}>
            {hearing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
          </button>
          <input value={task} onChange={(e) => setTask(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--text-muted)]"
            placeholder={mic ? "Говорите… нажмите микрофон, чтобы закончить" : "Введите задачу или нажмите микрофон…"} aria-label="Задача" />
          <button type="submit" disabled={Boolean(busy) || !task.trim()} aria-label="Создать кампанию" className="spectrum-button grid h-9 w-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-40">
            {busy === "create" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>

        <div className="grid grid-cols-2 gap-3">
          <Tile label="Найдено сообществ" value={data ? fmt(data.communities) : "—"} />
          <Tile label="Согласовано площадок" value={cap ? fmt(cap.places) : "—"} hint="с разрешением админа" />
          <Tile label="Опубликовано сегодня" value={cap ? fmt(cap.verified) + " / " + fmt(cap.target) : "—"} hint={cap && cap.awaiting ? "ещё ждут: " + cap.awaiting : undefined} />
          <Tile label="Блокировки и ошибки" value={cap ? fmt(cap.failed) : "—"} hint="за сегодня" />
        </div>

        <section className="space-y-2">
          <h2 className="px-1 text-[14px] font-normal">Кампании</h2>
          {data && !shown.length && (
            <div className="glass rounded-2xl p-4 text-[12.5px] text-[var(--text-muted)]">Нет кампаний в работе. Опишите задачу выше или голосом боту в Telegram.</div>
          )}
          {shown.map((c) => {
            const done = doneOf(c);
            const pct = Math.min(100, Math.round((done / Math.max(1, c.dailyTarget)) * 100));
            return (
              <Link key={c.id} href="/groups#campaigns" className="glass block rounded-2xl px-4 py-3 transition hover:brightness-110">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate">{c.title}{c.region ? " — " + c.region : ""}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{c.status === "approved" ? done + " / " + c.dailyTarget : c.status === "searching" ? "ищу сообщества…" : "ждёт запуска"}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-strong)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={c.title}>
                  <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: pct + "%" }} />
                </div>
              </Link>
            );
          })}
        </section>

        <nav aria-label="Разделы пульта" className="grid grid-cols-3 gap-3">
          {SECTIONS.map(({ href, label, icon: Icon, color }) => (
            <Link key={label} href={href} className="glass flex flex-col items-center gap-1.5 rounded-2xl px-2 py-4 text-[12.5px] transition hover:brightness-110">
              <Icon size={17} style={{ color }} />{label}
            </Link>
          ))}
        </nav>

        {/* Global stop: every campaign stops, unpublished tasks are cancelled, Postiz jobs and partner tasks are withdrawn. */}
        {confirmStop ? (
          <div className="glass flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-500/40 p-3">
            <span className="text-[13px]">Остановить все кампании ({open}) и отменить неопубликованное?</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmStop(false)} className="rounded-xl border border-[var(--line-soft)] px-4 py-2 text-[13px]">Отмена</button>
              <button type="button" disabled={Boolean(busy)} onClick={async () => { await post("stopAll"); setConfirmStop(false); }} className="rounded-xl bg-red-600 px-4 py-2 text-[13px] text-white disabled:opacity-50">
                {busy === "stopAll" ? "Останавливаю…" : "Да, остановить"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={!open} onClick={() => setConfirmStop(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/50 bg-red-500/5 py-3.5 text-[14px] text-red-500 transition hover:bg-red-500/10 disabled:opacity-40">
            {open ? <Octagon size={16} /> : <Ban size={16} />}STOP — остановить кампании
          </button>
        )}
        <p className="px-1 text-[11px] text-[var(--text-muted)]">Все цифры живые: база сообществ, согласия админов и журнал публикаций за сегодня ({cap?.day || "—"}). Обновляются каждую минуту.</p>
      </div>

      {toast && <output className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-[12.5px] shadow-xl">{toast}</output>}
    </main>
  );
}
