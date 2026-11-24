"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Download, RefreshCw } from "lucide-react";

// Supabase archive: status, «sync now», and download of any period as styled Excel or CSV.
const SECTIONS: Array<[string, string]> = [["", "Все разделы"], ["groups", "Сообщества"], ["campaign_tasks", "Размещения"], ["group_posts", "Журнал публикаций"], ["mentions", "Мониторинг"], ["campaigns", "Кампании"], ["journal", "Журнал действий"], ["searches", "Поиски"]];
const input = "h-8 rounded-md border border-[var(--line-soft)] bg-transparent px-2 text-[12px] text-[var(--text)]";

export function ArchivePanel({ auth }: { auth: () => Record<string, string> }) {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [section, setSection] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/archive", { headers: auth(), cache: "no-store" }).catch(() => null);
    setInfo(res?.ok ? await res.json() : null);
  }, [auth]);
  useEffect(() => { void load(); }, [load]);

  const sync = async () => {
    setBusy("sync"); setNote("Переношу данные в Supabase…");
    const res = await fetch("/api/archive", { method: "POST", headers: auth() }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setNote(body?.ok ? "Готово: в архиве обновлено " + body.total + " записей" + (body.mode === "incremental" ? " (только изменённые с прошлого раза; полная сверка раз в неделю)." : " (полная сверка).") : "Ошибка: " + (body?.error || "нет связи"));
    setBusy(""); void load();
  };

  const download = async (format: "xlsx" | "csv") => {
    setBusy(format); setNote("Готовлю файл из архива…");
    const params = new URLSearchParams({ format, from, to, ...(section ? { collections: section } : {}) });
    const res = await fetch("/api/archive?" + params, { headers: auth() }).catch(() => null);
    if (!res?.ok) { const body = await res?.json().catch(() => null); setNote("Не удалось: " + (body?.error || "нет связи")); setBusy(""); return; }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "aurelius-archive." + format;
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: name }).click();
    URL.revokeObjectURL(url);
    setNote(""); setBusy("");
  };

  if (!info) return null;
  const last = info.last;
  return (
    <section className="glass rounded-[18px] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Database size={15} style={{ color: "#3ecf8e" }} />
        <h2 className="text-[14px]">Архив Supabase</h2>
        <span className="text-[12px] text-[var(--text-muted)]">
          {!info.configured ? "не подключён — добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в Vercel"
            : last ? (last.ok ? "последний перенос: " + new Date(last.at).toLocaleString("ru-RU") + " · " + last.total + " записей" : "последний перенос с ошибкой: " + last.error) : "ещё не переносили"}
        </span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">Автоматически каждый день</span>
      </div>
      {info.configured && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={Boolean(busy)} onClick={() => void sync()} className="spectrum-button inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] text-white disabled:opacity-40"><RefreshCw size={13} className={busy === "sync" ? "animate-spin" : ""} />Перенести сейчас</button>
          <label className="text-[12px] text-[var(--text-muted)]">с <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-[12px] text-[var(--text-muted)]">по <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <select aria-label="Раздел архива" className={input} value={section} onChange={(e) => setSection(e.target.value)}>
            {SECTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <button type="button" disabled={Boolean(busy)} onClick={() => void download("xlsx")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-soft)] px-3 text-[12px] text-[var(--text-soft)] disabled:opacity-40"><Download size={13} />Excel</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => void download("csv")} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line-soft)] px-3 text-[12px] text-[var(--text-soft)] disabled:opacity-40"><Download size={13} />CSV</button>
        </div>
      )}
      {note && <p className="mt-2 text-[12px] text-[var(--text-muted)]">{note}</p>}
    </section>
  );
}
