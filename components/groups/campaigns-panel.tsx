"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Gauge, Megaphone, Mic, Play, Plus, Radio, Search, Square, X } from "lucide-react";
import type { Campaign, CampaignTask, Mention } from "@/lib/scout/campaigns";
import { isPolishWineCampaign } from "@/lib/scout/wine-compliance";
import { startVoiceRecording } from "@/components/voice-recorder";

// Campaigns (TZ 1.2): task → keywords approval → community search → daily placement → monitoring.
// The same flow runs from Telegram by voice; this screen shows and controls it.

type Cap = { day: string; target: number; places: number; peak: number; sustained: number; planned: number; verified: number; awaiting: number; failed: number; withoutPermission: number; byMode: Record<string, { places: number; sustained: number }> };
type Data = { campaigns: Campaign[]; tasks: CampaignTask[]; mentions: Mention[]; capacity: Cap; partnerLink?: string };

const inputClass = "scout-input w-full min-h-9 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line)]";
const STATUS: Record<Campaign["status"], string> = { draft: "черновик · проверьте слова", searching: "ищу сообщества…", ready: "сообщества найдены", approved: "размещение идёт", stopped: "остановлена" };
const TASK: Record<CampaignTask["status"], string> = { scheduled: "в плане", sent: "опубликовано ботом", failed: "ошибка", notified: "у партнёра", proof: "ждёт проверки", verified: "подтверждено", skipped: "пропущено", cancelled: "отменено" };
const MODE: Record<CampaignTask["mode"], string> = { bot: "бот", partner: "партнёр", manual: "вручную" };
const ICON: Record<string, string> = { telegram: "✈️", facebook: "📘", instagram: "📸", tiktok: "🎵" };

function Btn({ children, onClick, variant = "ghost", disabled }: Readonly<{ children: ReactNode; onClick?: () => void; variant?: "ghost" | "spectrum"; disabled?: boolean }>) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={"scout-button inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40 " + (variant === "spectrum" ? "spectrum-button text-white shadow-lg" : "border border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-soft)] hover:border-[var(--line)] hover:text-[var(--text)]")}>
      {children}
    </button>
  );
}

function Section({ id, title, icon: Icon, color, children, actions }: Readonly<{ id?: string; title: string; icon: typeof Gauge; color: string; children: ReactNode; actions?: ReactNode }>) {
  return (
    <section id={id} className="glass scout-panel scroll-mt-4 rounded-[18px] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-normal">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-lg border border-[var(--line-soft)] bg-[var(--surface-strong)]"><Icon size={14} style={{ color }} /></span>
          {title}
        </h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function CampaignEditor({ c, act, busy }: Readonly<{ c: Campaign; act: (a: string, p?: Record<string, unknown>, l?: string) => Promise<any>; busy: string }>) {
  const [kw, setKw] = useState(c.keywords.join(", "));
  const [adj, setAdj] = useState(c.adjacent.join(", "));
  const [queries, setQueries] = useState(c.queries.join(", "));
  const [excl, setExcl] = useState(c.exclusions.join(", "));
  const [target, setTarget] = useState(String(c.dailyTarget));
  const dirty = kw !== c.keywords.join(", ") || adj !== c.adjacent.join(", ") || queries !== c.queries.join(", ") || excl !== c.exclusions.join(", ") || target !== String(c.dailyTarget);
  const verifiedTargets = Boolean(c.found?.total && (c.searchGroupIds?.length || c.controlGroupIds?.length));
  const blockedWine = isPolishWineCampaign(c);
  const displayedStatus = blockedWine ? "B2B-поиск · публичная реклама вина запрещена"
    : c.status === "approved" && !verifiedTargets ? "размещение заблокировано — нет подтверждённых целей"
    : c.status === "ready" && !verifiedTargets ? "поиск завершён · нет пригодных площадок"
    : STATUS[c.status];
  const save = () => act("update", { id: c.id, keywords: kw, adjacent: adj, queries, exclusions: excl, dailyTarget: Number(target) }, "save");
  return (
    <div className="rounded-xl border border-[var(--line-soft)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px]">{c.title} <span className="text-[11px] text-[var(--text-muted)]">· {displayedStatus}{c.source === "voice" ? " · 🎙" : ""}</span></div>
          <div className="text-[11.5px] text-[var(--text-muted)]">{[c.topic, c.region, c.languages.join(", "), c.platforms.map((p) => ICON[p]).join(" ")].filter(Boolean).join(" · ")}{c.found ? " · найдено " + c.found.total + " (профильных " + c.found.core + ", смежных " + c.found.adjacent + ", неактивных " + c.found.inactive + ")" : ""}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.status !== "approved" && c.status !== "searching" && <Btn variant={c.status === "draft" ? "spectrum" : "ghost"} disabled={Boolean(busy)} onClick={async () => { if (dirty) await save(); await act("search", { id: c.id }, "search"); }}><Search size={12} />{c.status === "draft" ? "Слова верны — искать" : "Искать ещё"}</Btn>}
          {(c.status === "ready" || c.status === "stopped") && !blockedWine && <Btn variant="spectrum" disabled={Boolean(busy) || !verifiedTargets} onClick={() => void act("start", { id: c.id }, "start")}><Play size={12} />Запустить размещение</Btn>}
          {c.status === "approved" && <Btn onClick={() => void act("stop", { id: c.id }, "stop")}><Square size={12} />Стоп</Btn>}
          <Btn disabled={Boolean(busy)} onClick={() => void act("monitor", { id: c.id }, "monitor")}><Radio size={12} />{busy === "monitor" ? "Мониторинг…" : "Мониторинг"}</Btn>
          {c.status === "draft" && <Btn onClick={() => void act("remove", { id: c.id })}><X size={12} /></Btn>}
        </div>
      </div>
      {(blockedWine || (c.status === "approved" && !verifiedTargets) || (c.status === "ready" && !verifiedTargets)) && <p className="mt-2 text-[12px] text-amber-600">{blockedWine ? "Публичная реклама вина в Польше отключена. Доступен B2B-поиск; нужна проверка конкретных обращений." : "Нет подтверждённого списка площадок для этой кампании. Остановите её при необходимости и повторите поиск."}</p>}
      {c.questions.length > 0 && c.status === "draft" && <div className="mt-2 rounded-lg border border-[var(--line-soft)] p-2 text-[12px]">❓ Уточните (ответьте боту или поправьте текст задачи): {c.questions.join(" · ")}</div>}
      <details className="mt-2" open={c.status === "draft"}>
        <summary className="cursor-pointer text-[12px] text-[var(--text-soft)]">Текст, ключевые слова ({c.keywords.length}), смежные, свои запросы, исключения</summary>
        <div className="mt-2 grid gap-2">
          <div className="whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-[12px]">{c.adText}</div>
          <label className="text-[11px] text-[var(--text-muted)]">Ключевые слова (до 40, через запятую)<textarea className={inputClass + " mt-1 min-h-20"} value={kw} onChange={(e) => setKw(e.target.value)} /></label>
          <label className="text-[11px] text-[var(--text-muted)]">Смежные сообщества (барахолки, экспаты, районы…)<textarea className={inputClass + " mt-1 min-h-12"} value={adj} onChange={(e) => setAdj(e.target.value)} /></label>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px]">
            <label className="text-[11px] text-[var(--text-muted)]">Свои запросы<input className={inputClass + " mt-1"} value={queries} onChange={(e) => setQueries(e.target.value)} /></label>
            <label className="text-[11px] text-[var(--text-muted)]">Исключения<input className={inputClass + " mt-1"} value={excl} onChange={(e) => setExcl(e.target.value)} /></label>
            <label className="text-[11px] text-[var(--text-muted)]">Цель в день<input className={inputClass + " mt-1"} type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
          </div>
          {dirty && <div><Btn variant="spectrum" onClick={() => void save()}>Сохранить</Btn></div>}
        </div>
      </details>
    </div>
  );
}

export default function CampaignsPanel({ headers, onToast, onExport }: Readonly<{ headers: () => Record<string, string>; onToast: (t: string) => void; onExport?: () => void }>) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [task, setTask] = useState("");
  const [mic, setMic] = useState<MediaRecorder | null>(null);
  const [hearing, setHearing] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { try { setWelcome(!sessionStorage.getItem("aurelius-welcome")); } catch { setWelcome(true); } }, []);
  const closeWelcome = () => { setWelcome(false); try { sessionStorage.setItem("aurelius-welcome", "1"); } catch { /* private mode */ } };
  const [place, setPlace] = useState({ url: "", partnerTelegramId: "", dailyLimit: "", minDaysBetween: "", permissionNote: "" });

  const load = useCallback(async () => {
    const r = await fetch("/api/campaigns", { headers: headers(), cache: "no-store" }).catch(() => null);
    if (r?.ok) setData(await r.json());
  }, [headers]);
  useEffect(() => { void load(); }, [load]);
  // Links from the control panel (/groups#today, #partners…) land after the data has rendered.
  const loaded = Boolean(data);
  useEffect(() => { if (loaded && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }, [loaded]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}, label = action) => {
    setBusy(label);
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: headers(), body: JSON.stringify({ action, ...payload }) });
      const d = await r.json().catch(() => ({}));
      if (d.message || d.error) onToast(d.message || d.error);
      await load();
      return d;
    } finally { setBusy(""); }
  }, [headers, load, onToast]);

  if (!data) return null;
  const cap = data.capacity;
  const proofs = data.tasks.filter((t) => t.status === "proof");

  const active = data.campaigns.filter((c) => c.status !== "stopped").length;
  return (
    <>
      {welcome && (
        <div className="glass mb-4 rounded-2xl p-4">
          <div className="text-[15px]">✦ {data.campaigns.length ? "С возвращением в AURELIUS" : "Добро пожаловать в AURELIUS"}</div>
          <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{data.campaigns.length ? "Кампаний в работе: " + active + ". Все кампании, база сообществ и журнал размещений сохранены." : "Опишите задачу текстом или голосом на любом языке, и агент найдёт сообщества и подготовит размещение."}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.campaigns.length > 0 && <Btn onClick={closeWelcome}>↩️ Продолжить</Btn>}
            <Btn variant="spectrum" onClick={() => { closeWelcome(); setTask(""); taskRef.current?.focus(); }}><Plus size={12} />{data.campaigns.length ? "Новый диалог" : "Начать"}</Btn>
            {onExport && data.campaigns.length > 0 && <Btn onClick={onExport}><Download size={12} />Выгрузить в Excel</Btn>}
          </div>
        </div>
      )}
      <Section id="campaigns" title="Рекламные кампании" icon={Megaphone} color="#ff375f" actions={data.campaigns.some((c) => c.status === "approved") ? <Btn onClick={() => void act("stopAll", {}, "stopAll")}><Square size={12} />Остановить всё</Btn> : undefined}>
        <textarea ref={taskRef} className={inputClass + " min-h-20"} placeholder="Задача обычным языком: что рекламируем, где, на каких площадках, сколько в день, текст объявления. Можно голосом на любом языке." value={task} onChange={(e) => setTask(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn variant="spectrum" disabled={task.trim().length < 10 || Boolean(busy)} onClick={async () => { const d = await act("create", { text: task }, "create"); if (d?.ok) setTask(""); }}><Plus size={12} />{busy === "create" ? "Разбираю…" : "Создать кампанию"}</Btn>
          <Btn disabled={hearing} onClick={async () => {
            if (mic) { mic.stop(); setMic(null); return; }
            setMic(await startVoiceRecording((t) => setTask((prev) => (prev ? prev + " " : "") + t), onToast, setHearing));
          }}><Mic size={12} />{hearing ? "Распознаю…" : mic ? "Остановить запись" : "Сказать голосом"}</Btn>
          <span className="text-[11.5px] text-[var(--text-muted)]">на любом языке · или голосовое боту в Telegram</span>
        </div>
        <div className="mt-3 space-y-2">{data.campaigns.map((c) => <CampaignEditor key={c.id + c.updatedAt} c={c} act={act} busy={busy} />)}</div>
      </Section>

      <Section id="today" title={"Сегодня · " + cap.day} icon={Gauge} color="#ffd60a">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {[["Цель в день", cap.target], ["Устойчиво сеть даёт", cap.sustained], ["Площадок с разрешением", cap.places], ["Запланировано", cap.planned], ["Размещено", cap.verified], ["Ждут / ошибки", cap.awaiting + " / " + cap.failed]].map(([l, v]) => (
            <div key={String(l)} className="glass rounded-xl p-3"><div className="text-[11px] text-[var(--text-muted)]">{l}</div><div className="text-[20px] font-light tabular-nums">{v}</div></div>
          ))}
        </div>
        {cap.target > cap.sustained && <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">До цели не хватает ~{cap.target - cap.sustained} размещений в день. Нужны новые площадки с согласием админов: {cap.withoutPermission} групп ждут ответа (кнопка «Письмо» в базе ниже), платные размещения или партнёры.</p>}
        {proofs.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[12px]">Партнёры прислали ссылки — проверьте:</div>
            {proofs.map((t) => <div key={t.id} className="flex flex-wrap items-center gap-2 text-[12px]">{ICON[t.platform]} {t.groupName} · <a className="underline" href={t.link} target="_blank" rel="noreferrer">пост</a><Btn variant="spectrum" onClick={() => void act("verify", { id: t.id, accept: true })}>Засчитать</Btn><Btn onClick={() => void act("verify", { id: t.id, accept: false })}>Нет</Btn></div>)}
          </div>
        )}
        {data.tasks.length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-[12px] text-[var(--text-soft)]">План на сегодня ({data.tasks.length})</summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full min-w-[560px] text-left text-[12px]"><tbody>
                {data.tasks.slice(0, 400).map((t) => <tr key={t.id} className="border-t border-[var(--line-soft)]"><td className="px-2 py-1">{ICON[t.platform]} {t.groupName}</td><td className="px-2 py-1">{t.campaignTitle}</td><td className="px-2 py-1">{MODE[t.mode]}</td><td className="px-2 py-1">{TASK[t.status]}{t.error ? " · " + t.error : ""}</td><td className="px-2 py-1">{t.link && <a className="underline" href={t.link} target="_blank" rel="noreferrer">ссылка</a>}</td></tr>)}
              </tbody></table>
            </div>
          </details>
        )}
      </Section>

      <Section id="partners" title="Площадка партнёра или по договорённости" icon={Plus} color="#30d158">
        {data.partnerLink && <p className="mb-2 text-sm opacity-80">Ссылка для админов, чтобы подключиться самим: <a className="underline" href={data.partnerLink} target="_blank" rel="noreferrer">{data.partnerLink}</a>. Заявка придёт вам в бот на подтверждение.</p>}
        {/* Telega.in and Collabstr have no open API: deals are made on their sites, then the agreed place is added below. */}
        <p className="mb-2 text-sm opacity-80">Платные размещения вручную: <a className="underline" href="https://telega.in/" target="_blank" rel="noreferrer">Telega.in</a> (Telegram-каналы) и <a className="underline" href="https://collabstr.com/" target="_blank" rel="noreferrer">Collabstr</a> (Instagram и TikTok-авторы). Договоритесь там, затем добавьте площадку ниже, а в поле согласия укажите номер заказа.</p>
        <div className="grid gap-2 sm:grid-cols-[2fr_1.2fr_90px_90px_2fr_auto]">
          <input className={inputClass} placeholder="Ссылка: t.me / facebook / instagram / tiktok" value={place.url} onChange={(e) => setPlace({ ...place, url: e.target.value })} />
          <input className={inputClass} placeholder="Telegram ID админа-партнёра" value={place.partnerTelegramId} onChange={(e) => setPlace({ ...place, partnerTelegramId: e.target.value })} />
          <input className={inputClass} placeholder="Постов/день" type="number" value={place.dailyLimit} onChange={(e) => setPlace({ ...place, dailyLimit: e.target.value })} />
          <input className={inputClass} placeholder="Раз в N дней" type="number" value={place.minDaysBetween} onChange={(e) => setPlace({ ...place, minDaysBetween: e.target.value })} />
          <input className={inputClass} placeholder="Чем подтверждено согласие (переписка, договор) — без этого постов не будет" value={place.permissionNote} onChange={(e) => setPlace({ ...place, permissionNote: e.target.value })} />
          <Btn variant="spectrum" disabled={!place.url.trim()} onClick={async () => { const d = await act("addPlace", place); if (d?.ok) setPlace({ url: "", partnerTelegramId: "", dailyLimit: "", minDaysBetween: "", permissionNote: "" }); }}>Добавить</Btn>
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">Партнёр (админ группы или владелец страницы) открывает бота, нажимает Start и присылает /id — это его Telegram ID. Бот будет присылать ему задания, он публикует сам и отвечает /proof со ссылкой, а вы засчитываете.</p>
      </Section>

      {data.mentions.length > 0 && (
        <Section id="monitoring" title={"Мониторинг · " + data.mentions.length} icon={Radio} color="#64d2ff">
          <div className="space-y-1.5">
            {data.mentions.slice(0, 30).map((m) => <div key={m.id} className="text-[12px]">{ICON[m.platform]} <a className="hover:underline" href={m.url} target="_blank" rel="noreferrer">{m.title || m.url}</a>{m.author ? <span className="text-[var(--text-muted)]"> — {m.author}</span> : null}{m.views ? <span className="text-[var(--text-muted)]"> · 👁 {m.views.toLocaleString("ru-RU")}</span> : null}</div>)}
          </div>
        </Section>
      )}
    </>
  );
}
