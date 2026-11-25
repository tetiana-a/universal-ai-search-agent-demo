import { readSearchHistory } from "@/lib/memory";
import { COLLECTIONS, getValue, listAll, readLog, setValue, type Collection } from "@/lib/scout/store";
import { stableId } from "@/lib/scout/text";

// Long-term archive in Supabase (PostgreSQL). Redis keeps the working set; every day (and on the
// button) all records are upserted into one table `aurelius_archive` (supabase/archive.sql):
// collection + id is the key, so re-syncing never duplicates, and history outlives Redis limits
// (the journal in Redis keeps only the latest 5000 entries). Only the server key touches it.

export type ArchiveRow = { collection: string; id: string; day: string | null; data: Record<string, unknown> };
export type SyncResult = { ok: boolean; at: string; total: number; byCollection: Record<string, number>; error?: string; mode?: "full" | "incremental"; scanned?: number; fullAt?: string };

const TABLE = "aurelius_archive";
const LAST_KEY = "archive:last";

export const ARCHIVE_LABEL: Record<string, string> = {
  groups: "Сообщества", campaigns: "Кампании", campaign_tasks: "Размещения", group_posts: "Журнал публикаций", group_queue: "Ручная очередь",
  mentions: "Мониторинг", instagram_posts: "Instagram", journal: "Журнал действий", searches: "Поиски", sources: "Источники",
  objects: "Объекты", investors: "Инвесторы", agencies: "Агентства", leads: "Лиды", matches: "Совпадения", drafts: "Черновики",
  meetings: "Встречи", watch: "Наблюдение", stoplist: "Стоп-лист", research_tasks: "Задачи поиска",
};

function config() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return url && key ? { url, key } : null;
}

export function archiveConfigured() {
  return Boolean(config());
}

// The record's own date: what it is about (day of a placement, time of a post, when found).
export function recordDay(r: Record<string, unknown>): string | null {
  for (const k of ["day", "at", "createdAt", "foundAt", "updatedAt"]) {
    const v = String(r[k] ?? "");
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

async function rest(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  const c = config();
  if (!c) throw new Error("Supabase не подключён: добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в Vercel.");
  let last = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 3 ** (attempt - 1)));
    try {
      const res = await fetch(c.url + "/rest/v1/" + path, { ...init, headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json", ...init.headers }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (res.ok) return res;
      last = "HTTP " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200);
      if (res.status < 500 && res.status !== 429) break;
    } catch (error) {
      last = error instanceof Error ? error.message : "network error";
    }
  }
  throw new Error("Supabase: " + last);
}

export async function collectRows(): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  for (const collection of COLLECTIONS) {
    for (const item of await listAll<Record<string, unknown>>(collection as Collection)) {
      if (item?.id) rows.push({ collection, id: String(item.id), day: recordDay(item), data: item });
    }
  }
  for (const entry of await readLog(5000)) {
    const data = entry as unknown as Record<string, unknown>;
    rows.push({ collection: "journal", id: stableId("log", entry.at + "|" + entry.action + "|" + (entry.detail || "")), day: recordDay(data), data });
  }
  for (const run of await readSearchHistory(5000)) {
    if (run && typeof run === "object") rows.push({ collection: "searches", id: String(run.id || stableId("run", JSON.stringify(run).slice(0, 500))), day: recordDay(run), data: run });
  }
  return rows;
}

// Newest timestamp a record carries: changed records have a fresh updatedAt, new ones a fresh at/createdAt.
export function changedAt(r: Record<string, unknown>): string | null {
  let best = "";
  for (const k of ["updatedAt", "at", "createdAt", "foundAt"]) { const v = String(r[k] ?? ""); if (/^\d{4}-\d{2}-\d{2}T/.test(v) && v > best) best = v; }
  return best || null;
}
const FULL_EVERY_MS = 7 * 86_400_000;

// PostgREST rejects the whole batch on a lone UTF-16 surrogate (PGRST102 "Empty or invalid json", e.g. an
// emoji cut in half by .slice()) and Postgres jsonb on \u0000 (22P05). Replace both before sending.
const BAD_TEXT = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]|\u0000/g;
export function archiveJson(value: unknown) {
  return JSON.stringify(value, (_k, v) => (typeof v === "string" ? v.replace(BAD_TEXT, "\ufffd") : v));
}

// Incremental: only records changed since the last good sync (minus an hour of margin) and records with
// no timestamp; a full pass once a week (or on demand) catches anything missed. Upserted in batches of 500.
export async function syncArchive(opts: { full?: boolean } = {}): Promise<SyncResult> {
  const at = new Date().toISOString();
  const byCollection: Record<string, number> = {};
  try {
    const prevGood = await getValue<SyncResult>(LAST_KEY).catch(() => null);
    const full = Boolean(opts.full || !prevGood?.fullAt || Date.parse(at) - Date.parse(prevGood.fullAt) > FULL_EVERY_MS);
    const since = full ? "" : new Date(Date.parse(prevGood!.at) - 3_600_000).toISOString();
    const all = await collectRows();
    const rows = full ? all : all.filter((r) => { const t = changedAt(r.data); return !t || t >= since; });
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500).map((r) => ({ ...r, synced_at: at }));
      await rest(TABLE + "?on_conflict=collection,id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: archiveJson(batch) });
    }
    for (const r of rows) byCollection[r.collection] = (byCollection[r.collection] || 0) + 1;
    const result: SyncResult = { ok: true, at, total: rows.length, byCollection, mode: full ? "full" : "incremental", scanned: all.length, fullAt: full ? at : prevGood?.fullAt };
    await setValue(LAST_KEY, result);
    return result;
  } catch (error) {
    const result: SyncResult = { ok: false, at, total: 0, byCollection, error: error instanceof Error ? error.message : String(error) };
    // A failed run must not move the "since" point, so the last good result stays stored.
    await setValue(LAST_KEY + ":error", result).catch(() => null);
    return result;
  }
}

// Duplicates merged away in Redis must not linger in the archive either.
export async function removeFromArchive(collection: string, ids: string[]) {
  if (!archiveConfigured() || !ids.length || !/^[a-z_]+$/.test(collection)) return;
  const list = ids.map((id) => '"' + id.replace(/["\\]/g, "") + '"').join(",");
  await rest("aurelius_archive?collection=eq." + collection + "&id=in.(" + encodeURIComponent(list) + ")", { method: "DELETE" });
}

// For the panel: the latest attempt, good or failed.
export async function lastSync() {
  const [good, bad] = await Promise.all([getValue<SyncResult>(LAST_KEY), getValue<SyncResult>(LAST_KEY + ":error")]);
  return bad && (!good || bad.at > good.at) ? bad : good;
}

// Read back for download: period by the record's own day, optional collections. Paged 1000 at a time.
export async function readArchive(input: { from?: string; to?: string; collections?: string[]; limit?: number }) {
  const q = ["select=collection,id,day,data", "order=collection.asc,day.desc"];
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (input.from && date.test(input.from)) q.push("day=gte." + input.from);
  if (input.to && date.test(input.to)) q.push("day=lte." + input.to);
  const wanted = (input.collections || []).filter((c) => /^[a-z_]+$/.test(c));
  if (wanted.length) q.push("collection=in.(" + wanted.join(",") + ")");
  const limit = Math.min(input.limit ?? 100_000, 100_000);
  const out: ArchiveRow[] = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const res = await rest(TABLE + "?" + q.join("&"), { headers: { Range: offset + "-" + Math.min(offset + 999, limit - 1), "Range-Unit": "items" } });
    const page = (await res.json()) as ArchiveRow[];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

// Rows grouped into sheets with Russian names, data fields flattened.
export function archiveSheets(rows: ArchiveRow[]) {
  const sheets: Record<string, Record<string, unknown>[]> = {};
  for (const r of rows) (sheets[ARCHIVE_LABEL[r.collection] || r.collection] ||= []).push(r.data);
  return sheets;
}
