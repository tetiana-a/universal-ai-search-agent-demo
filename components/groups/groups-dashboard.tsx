"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Download, ExternalLink, ListChecks, Megaphone, MessageSquare, Radar, ScrollText, Send, Users, X } from "lucide-react";
import type { GroupCard, GroupStatus, PostLog, QueueItem } from "@/lib/scout/groups";

// Group finder + compliant posting. Same access key as /scout (stored in this browser).

type State = {
  groups: GroupCard[];
  queue: QueueItem[];
  posts: PostLog[];
  bot: string;
  summary: { today: { bot: number; manual: number; failed: number }; groups: { total: number; telegram: number; facebook: number; botReady: number; paid: number }; queuePending: number };
};

const KEY_STORAGE = "aurelius-scout-key";
const inputClass = "scout-input w-full min-h-9 rounded-lg border border-[var(--line-soft)] bg-[var(--surface-strong)] px-3 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--line)]";
const ADS: Record<string, string> = { allowed: "разрешены", paid: "платно", forbidden: "запрещены", unknown: "—" };
const STATUS: Record<GroupStatus, string> = { new: "новая", contacted: "написали админу", free: "бесплатно", exchange: "обмен", paid: "платно", declined: "отказ" };

function Button({ children, onClick, variant = "ghost", disabled, href }: { children: ReactNode; onClick?: () => void; variant?: "ghost" | "spectrum"; disabled?: boolean; href?: string }) {
  const cls = "scout-button inline-flex min-h-[30px] items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition disabled:opacity-40 " +
    (variant === "spectrum" ? "spectrum-button text-white shadow-lg" : "border border-[var(--line-soft)] bg-[var(--surface)] text-[var(--text-soft)] hover:border-[var(--line)] hover:text-[var(--text)]");
  if (href) return <a className={cls} href={href} target="_blank" rel="noreferrer">{children}</a>;
  return <button type="button" disabled={disabled} onClick={onClick} className={cls}>{children}</button>;
}

function Panel({ title, icon: Icon, color, children, actions }: { title: string; icon: typeof Radar; color: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass scout-panel rounded-[18px] p-3 sm:p-4">
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

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function GroupsDashboard() {
  const [key, setKey] = useState("");
  const [needKey, setNeedKey] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState({ country: "Испания", city: "Барселона", topic: "недвижимость" });
  const [post, setPost] = useState({ text: "", photoUrl: "" });
  const [filter, setFilter] = useState("");
  const [outreach, setOutreach] = useState<{ group: GroupCard; drafts: { free: string; exchange: string; paid: string; contactUrl: string } } | null>(null);

  useEffect(() => {
    try {
      document.documentElement.classList.toggle("light", window.localStorage.getItem("aurelius-theme") === "light");
      setKey(window.localStorage.getItem(KEY_STORAGE) || "");
    } catch {}
  }, []);

  const headers = useCallback((): Record<string, string> => ({ "content-type": "application/json", ...(key ? { "x-scout-key": key } : {}) }), [key]);

  const load = useCallback(async () => {
    const response = await fetch("/api/groups", { headers: headers(), cache: "no-store" }).catch(() => null);
    if (!response) { setToast("Сервер недоступен"); return; }
    if (response.status === 401) { setNeedKey(true); return; }
    setNeedKey(false);
    setState(await response.json());
  }, [headers]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 6000); return () => clearTimeout(t); } }, [toast]);

  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}, label = action) => {
    setBusy(label);
    try {
      const response = await fetch("/api/groups", { method: "POST", headers: headers(), body: JSON.stringify({ action, ...payload }) });
      const data = await response.json().catch(() => ({}));
      if (data.message) setToast(data.message);
      else if (data.error) setToast(data.error);
      await load();
      return data;
    } finally { setBusy(""); }
  }, [headers, load]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (state?.groups || []).filter((g) => !q || [g.name, g.city, g.country, g.topic, g.adminContact].join(" ").toLowerCase().includes(q));
  }, [state, filter]);

  const saveKey = () => { try { window.localStorage.setItem(KEY_STORAGE, key); } catch {} void load(); };
  const s = state?.summary;
  const exportHref = "/api/groups/export" + (key ? "?key=" + encodeURIComponent(key) : "");

  return (
    <main className="scout-ui relative isolate min-h-screen overflow-x-clip bg-[var(--bg)] text-[var(--text)] spectrum-shell">
      <div className="app-grid pointer-events-none fixed inset-0 z-0 opacity-45" />
      <div className="relative z-10 mx-auto max-w-[1400px] space-y-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <a href="/" className="brand-mark font-display text-[24px] tracking-[.19em]">AURELIUS</a>
            <h1 className="mt-1 text-[18px] font-light">Группы и публикации</h1>
            <p className="text-[12px] text-[var(--text-muted)]">Поиск групп · письма админам · постинг ботом там, где его добавили админы · ручная очередь для своих аккаунтов</p>
          </div>
          <div className="flex gap-2"><Button href="/scout">← Разведчик</Button></div>
        </header>

        {needKey && (
          <Panel title="Нужен ключ доступа" icon={Radar} color="#ff9500">
            <div className="flex gap-2"><input className={inputClass} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Ключ доступа (как в Разведчике)" /><Button variant="spectrum" onClick={saveKey}>Войти</Button></div>
          </Panel>
        )}

        {s && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["Групп в базе", s.groups.total], ["Бот публикует в", s.groups.botReady], ["Сегодня ботом", s.today.bot], ["Сегодня вручную", s.today.manual], ["В очереди", s.queuePending]].map(([label, value]) => (
              <div key={String(label)} className="glass rounded-xl p-3"><div className="text-[11px] text-[var(--text-muted)]">{label}</div><div className="text-[22px] font-light tabular-nums">{value}</div></div>
            ))}
          </div>
        )}

        <Panel title="1. Найти группы" icon={Radar} color="#30d158">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
            <input className={inputClass} placeholder="Страна" value={search.country} onChange={(e) => setSearch({ ...search, country: e.target.value })} />
            <input className={inputClass} placeholder="Город" value={search.city} onChange={(e) => setSearch({ ...search, city: e.target.value })} />
            <input className={inputClass} placeholder="Тема (например, недвижимость)" value={search.topic} onChange={(e) => setSearch({ ...search, topic: e.target.value })} />
            <Button variant="spectrum" disabled={Boolean(busy)} onClick={() => void act("find", search, "find")}>{busy === "find" ? "Ищу… 1–2 мин" : "Найти группы"}</Button>
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">Ищем публичные Telegram-группы и каналы и публичные Facebook-группы. Участники и правила берутся с открытых страниц групп.</p>
        </Panel>

        <Panel title={"2. База групп · " + groups.length} icon={Users} color="#0a84ff" actions={<><input className={inputClass + " w-48"} placeholder="Фильтр" value={filter} onChange={(e) => setFilter(e.target.value)} /><Button href={exportHref}><Download size={13} />Excel</Button></>}>
          {!groups.length ? <p className="text-[12.5px] text-[var(--text-muted)]">Пока пусто. Запустите поиск выше.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-[12px]">
                <thead className="text-[11px] text-[var(--text-muted)]"><tr>{["", "Название", "Участники", "Реклама", "Админ", "Статус", "Цена, €", "Бот / постинг", ""].map((h, i) => <th key={i} className="px-2 py-1.5 font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-[var(--line-soft)] align-middle">
                      <td className="px-2 py-1.5">{g.platform === "telegram" ? "✈️" : "📘"}</td>
                      <td className="max-w-[260px] px-2 py-1.5">{g.url ? <a className="hover:underline" href={g.url} target="_blank" rel="noreferrer">{g.name}</a> : g.name}<div className="text-[10.5px] text-[var(--text-muted)]">{[g.city, g.country, g.kind === "channel" ? "канал" : ""].filter(Boolean).join(" · ")}</div></td>
                      <td className="px-2 py-1.5 tabular-nums">{g.members ? g.members.toLocaleString("ru-RU") : "—"}</td>
                      <td className="px-2 py-1.5">{ADS[g.ads]}</td>
                      <td className="px-2 py-1.5"><input className={inputClass + " min-h-7 w-36"} defaultValue={g.adminContact || ""} placeholder="@admin" onBlur={(e) => e.target.value !== (g.adminContact || "") && void act("update", { id: g.id, patch: { adminContact: e.target.value } })} /></td>
                      <td className="px-2 py-1.5"><select className={inputClass + " min-h-7 w-36"} value={g.status} onChange={(e) => void act("update", { id: g.id, patch: { status: e.target.value } })}>{Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                      <td className="px-2 py-1.5"><input className={inputClass + " min-h-7 w-20"} type="number" min={0} defaultValue={g.price ?? ""} onBlur={(e) => String(g.price ?? "") !== e.target.value && void act("update", { id: g.id, patch: { price: Number(e.target.value), currency: "EUR" } })} /></td>
                      <td className="px-2 py-1.5">{g.botConnected ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(g.postingEnabled)} onChange={(e) => void act("update", { id: g.id, patch: { postingEnabled: e.target.checked } })} />вкл.</label> : <span className="text-[var(--text-muted)]">нет бота</span>}</td>
                      <td className="px-2 py-1.5"><div className="flex gap-1.5"><Button onClick={async () => { const d = await act("outreach", { id: g.id }, "o"); if (d?.drafts) setOutreach({ group: g, drafts: d.drafts }); }}><MessageSquare size={12} />Письмо</Button><Button onClick={() => void act("remove", { id: g.id })}><X size={12} /></Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">Чтобы бот публиковал в группе, попросите админа добавить <b>{state?.bot || "бота"}</b> в группу. Если его добавил сам админ, постинг включится автоматически; иначе включите галочку после согласия админа. Лимит — 3 поста в день на группу.</p>
        </Panel>

        <Panel title="3. Опубликовать объявление" icon={Megaphone} color="#ff9f0a">
          <textarea className={inputClass + " min-h-28"} placeholder="Текст объявления" value={post.text} onChange={(e) => setPost({ ...post, text: e.target.value })} />
          <input className={inputClass + " mt-2"} placeholder="Ссылка на фото (https://…), необязательно" value={post.photoUrl} onChange={(e) => setPost({ ...post, photoUrl: e.target.value })} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="spectrum" disabled={!post.text.trim() || Boolean(busy)} onClick={() => void act("post.bot", post, "post")}><Send size={13} />Отправить ботом ({s?.groups.botReady ?? 0} групп)</Button>
            <Button disabled={!post.text.trim() || Boolean(busy)} onClick={() => void act("queue.add", post, "queue")}><ListChecks size={13} />В очередь для ручной публикации</Button>
          </div>
          <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">Бот публикует только в группах, где его добавили админы. Остальные группы и все Facebook-группы попадают в очередь: вы публикуете со своего аккаунта по одной кнопке.</p>
        </Panel>

        <Panel title={"4. Очередь ручной публикации · " + (state?.queue.length || 0)} icon={ListChecks} color="#bf5af2">
          {!state?.queue.length ? <p className="text-[12.5px] text-[var(--text-muted)]">Очередь пуста.</p> : (
            <div className="space-y-2">
              {state.queue.slice(0, 30).map((q) => (
                <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line-soft)] p-2.5">
                  <div className="min-w-0 flex-1"><div className="text-[12.5px]">{q.platform === "telegram" ? "✈️" : "📘"} {q.groupName}</div><div className="truncate text-[11px] text-[var(--text-muted)]">{q.text}</div></div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button onClick={async () => setToast((await copy(q.text)) ? "Текст скопирован" : "Не удалось скопировать")}><Copy size={12} />Копировать</Button>
                    {q.url && <Button href={q.url}><ExternalLink size={12} />Открыть группу</Button>}
                    <Button variant="spectrum" onClick={() => void act("queue.done", { id: q.id })}>Опубликовал</Button>
                    <Button onClick={() => void act("queue.skip", { id: q.id })}>Пропустить</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="5. Журнал публикаций" icon={ScrollText} color="#64d2ff" actions={<Button href={exportHref}><Download size={13} />Excel</Button>}>
          {!state?.posts.length ? <p className="text-[12.5px] text-[var(--text-muted)]">Публикаций пока нет.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="text-[11px] text-[var(--text-muted)]"><tr>{["Время", "Группа", "Способ", "Статус", ""].map((h) => <th key={h} className="px-2 py-1.5 font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {state.posts.slice(0, 100).map((p) => (
                    <tr key={p.id} className="border-t border-[var(--line-soft)]">
                      <td className="px-2 py-1.5 tabular-nums">{new Date(p.at).toLocaleString("ru-RU")}</td>
                      <td className="px-2 py-1.5">{p.groupName}</td>
                      <td className="px-2 py-1.5">{p.mode === "bot" ? "бот" : "вручную"}</td>
                      <td className="px-2 py-1.5">{{ sent: "✅ отправлено", failed: "❌ ошибка", published: "✅ опубликовано", skipped: "⏭ пропущено" }[p.status]}{p.error ? " · " + p.error : ""}</td>
                      <td className="px-2 py-1.5">{p.link && <a className="hover:underline" href={p.link} target="_blank" rel="noreferrer">пост</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {outreach && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOutreach(null)}>
          <div className="glass max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[var(--surface-strong)] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><h3 className="text-[15px]">Письмо админу · {outreach.group.name}</h3><Button onClick={() => setOutreach(null)}><X size={13} /></Button></div>
            {([["free", "Бесплатно"], ["exchange", "Обмен"], ["paid", "Платное размещение"]] as const).map(([k, label]) => (
              <div key={k} className="mb-3 rounded-lg border border-[var(--line-soft)] p-3">
                <div className="mb-1.5 text-[12px] text-[var(--text-muted)]">{label}</div>
                <p className="whitespace-pre-wrap text-[12.5px]">{outreach.drafts[k]}</p>
                <div className="mt-2 flex gap-2">
                  <Button onClick={async () => { const ok = await copy(outreach.drafts[k]); if (ok && outreach.group.status === "new") await act("update", { id: outreach.group.id, patch: { status: "contacted" } }); setToast(ok ? "Скопировано. Вставьте в чат с админом." : "Не удалось скопировать"); }}><Copy size={12} />Копировать</Button>
                  <Button href={outreach.drafts.contactUrl}><ExternalLink size={12} />Написать админу</Button>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-[var(--text-muted)]">Письмо отправляете вы сами, со своего аккаунта. Когда админ ответит, поменяйте статус и цену в таблице.</p>
          </div>
        </div>
      )}

      {toast && <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2 text-[12.5px] shadow-xl">{toast}</div>}
    </main>
  );
}
