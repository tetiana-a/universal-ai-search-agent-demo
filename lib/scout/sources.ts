import { getOne, listAll, logAction, putMany, putOne, removeMany } from "@/lib/scout/store";
import { domainOf, nowIso, stableId } from "@/lib/scout/text";
import type { ScoutSource, WatchItem, WatchKind } from "@/lib/scout/types";

// Module 5.5 — self-learning. Approved sources join modules 1–2 on the next run;
// approved sources with no useful result for 30 days are marked "dead" and offered for disabling.

export const DEAD_AFTER_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export async function addCandidates(found: ScoutSource[]) {
  const existing = new Map((await listAll<ScoutSource>("sources")).map((s) => [s.id, s]));
  const fresh = found.filter((s) => !existing.has(s.id));
  // Keep one entry per id within this batch too.
  const unique = Array.from(new Map(fresh.map((s) => [s.id, s])).values());
  await putMany("sources", unique);
  return unique;
}

export async function setSourceState(id: string, state: ScoutSource["state"], by: string) {
  const source = await getOne<ScoutSource>("sources", id);
  if (!source) return null;
  const updated: ScoutSource = { ...source, state, approvedAt: state === "approved" ? nowIso() : source.approvedAt };
  await putOne("sources", updated);
  await logAction({ actor: "human", action: "source." + state, detail: by + ": " + source.name });
  return updated;
}

// Credits approved sources whose domain produced useful cards in this run.
export function creditSources(sources: ScoutSource[], usefulDomains: Map<string, number>, at = nowIso()) {
  return sources.map((s) => {
    if (s.state !== "approved") return s;
    const useful = usefulDomains.get(s.domain) || 0;
    return { ...s, checkedCount: s.checkedCount + 1, usefulCount: s.usefulCount + useful, lastUsefulAt: useful ? at : s.lastUsefulAt };
  });
}

export function markDeadSources(sources: ScoutSource[], now = Date.now()) {
  const dead: ScoutSource[] = [];
  const out = sources.map((s) => {
    if (s.state !== "approved") return s;
    const since = Date.parse(s.lastUsefulAt || s.approvedAt || s.discoveredAt);
    if (Number.isFinite(since) && now - since >= DEAD_AFTER_DAYS * DAY) {
      const updated = { ...s, state: "dead" as const };
      dead.push(updated);
      return updated;
    }
    return s;
  });
  return { sources: out, dead };
}

export function approvedDomains(sources: ScoutSource[]) {
  return sources.filter((s) => s.state === "approved" && s.kind !== "group" && s.kind !== "channel").map((s) => s.domain).filter(Boolean);
}

// ---- Watchlist (persons, groups, keywords, domains), editable without a programmer.

export function normalizeWatchValue(kind: WatchKind, value: string) {
  const v = value.trim();
  if (kind === "domain") return domainOf(/^https?:/.test(v) ? v : "https://" + v) || v.toLowerCase();
  return v.replace(/\s+/g, " ");
}

export async function addWatch(kind: WatchKind, value: string, note?: string) {
  const clean = normalizeWatchValue(kind, value);
  if (!clean || clean.length > 200) return null;
  const item: WatchItem = { id: stableId("w", kind + ":" + clean.toLowerCase()), kind, value: clean, note, addedAt: nowIso(), hits: 0 };
  const existing = await getOne<WatchItem>("watch", item.id);
  if (existing) return existing;
  await putOne("watch", item);
  await logAction({ actor: "human", action: "watch.add", detail: kind + ": " + clean });
  return item;
}

export async function removeWatch(id: string) {
  await removeMany("watch", [id]);
  await logAction({ actor: "human", action: "watch.remove", detail: id });
}

// Public Telegram channel handle from "@name", "t.me/name" or "https://t.me/s/name".
export function telegramHandle(value: string) {
  const m = /^(?:@|(?:https?:\/\/)?t\.me\/(?:s\/)?)([a-z][a-z0-9_]{4,31})\/?$/i.exec(value.trim());
  return m ? m[1] : null;
}
