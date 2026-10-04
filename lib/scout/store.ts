import { persistentMemoryConfigured, redisCommand, redisPipeline } from "@/lib/memory";
import type { LogEntry } from "@/lib/scout/types";

// Scout CRM storage. Uses the same Upstash Redis REST database as source memory
// (KV_REST_API_URL / UPSTASH_REDIS_REST_URL); without it, data lives in the
// server's memory and is lost on the next cold start — the UI says so.

export type Collection =
  | "objects"
  | "investors"
  | "agencies"
  | "sources"
  | "watch"
  | "drafts"
  | "leads"
  | "matches"
  | "meetings"
  | "stoplist";

const PREFIX = "aurelius:scout:v1:";
const LOG_KEY = PREFIX + "log";
const LOG_LIMIT = 500;

type MemoryState = { hashes: Map<string, Map<string, string>>; values: Map<string, string>; log: string[] };
const globalScope = globalThis as unknown as { __scoutMemory?: MemoryState };
function memory(): MemoryState {
  globalScope.__scoutMemory ??= { hashes: new Map(), values: new Map(), log: [] };
  return globalScope.__scoutMemory;
}

export function storeIsPersistent() {
  return persistentMemoryConfigured();
}

function hashKey(collection: Collection) {
  return PREFIX + collection;
}

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function listAll<T>(collection: Collection): Promise<T[]> {
  if (storeIsPersistent()) {
    const flat = await redisCommand<string[]>("HGETALL", [hashKey(collection)]);
    const out: T[] = [];
    if (Array.isArray(flat)) for (let i = 1; i < flat.length; i += 2) { const item = parse<T>(flat[i]); if (item) out.push(item); }
    return out;
  }
  const hash = memory().hashes.get(collection);
  return hash ? Array.from(hash.values()).map((v) => parse<T>(v)).filter(Boolean) as T[] : [];
}

export async function getOne<T>(collection: Collection, id: string): Promise<T | null> {
  if (!id) return null;
  if (storeIsPersistent()) return parse<T>(await redisCommand<string>("HGET", [hashKey(collection), id]));
  return parse<T>(memory().hashes.get(collection)?.get(id));
}

export async function putMany<T extends { id: string }>(collection: Collection, items: T[]) {
  if (!items.length) return;
  if (storeIsPersistent()) {
    // Chunked so one request never carries an oversized body.
    for (let i = 0; i < items.length; i += 50) {
      const args: string[] = [hashKey(collection)];
      for (const item of items.slice(i, i + 50)) args.push(item.id, JSON.stringify(item));
      await redisCommand("HSET", args);
    }
    return;
  }
  const state = memory();
  const hash = state.hashes.get(collection) || new Map<string, string>();
  for (const item of items) hash.set(item.id, JSON.stringify(item));
  state.hashes.set(collection, hash);
}

export async function putOne<T extends { id: string }>(collection: Collection, item: T) {
  await putMany(collection, [item]);
}

export async function removeMany(collection: Collection, ids: string[]) {
  if (!ids.length) return;
  if (storeIsPersistent()) { await redisCommand("HDEL", [hashKey(collection), ...ids]); return; }
  const hash = memory().hashes.get(collection);
  for (const id of ids) hash?.delete(id);
}

export async function getValue<T>(key: string): Promise<T | null> {
  if (storeIsPersistent()) return parse<T>(await redisCommand<string>("GET", [PREFIX + key]));
  return parse<T>(memory().values.get(key));
}

export async function setValue(key: string, value: unknown, ttlSeconds?: number) {
  const raw = JSON.stringify(value);
  if (storeIsPersistent()) {
    await redisCommand("SET", ttlSeconds ? [PREFIX + key, raw, "EX", ttlSeconds] : [PREFIX + key, raw]);
    return;
  }
  memory().values.set(key, raw);
}

export async function deleteValue(key: string) {
  if (storeIsPersistent()) { await redisCommand("DEL", [PREFIX + key]); return; }
  memory().values.delete(key);
}

// Atomically claims an idempotency key for a limited time.
// Returns true only to the first caller. Redis uses SET NX EX; the in-memory
// fallback provides best-effort protection within one warm serverless instance.
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const fullKey = PREFIX + key;
  if (storeIsPersistent()) {
    const result = await redisCommand<string | null>("SET", [fullKey, "1", "NX", "EX", Math.max(1, Math.floor(ttlSeconds))]);
    return result === "OK";
  }
  const state = memory();
  if (state.values.has(key)) return false;
  state.values.set(key, JSON.stringify({ claimedAt: Date.now(), ttlSeconds }));
  return true;
}

// Atomic counter (daily send limits). Returns the value after increment.
export async function increment(key: string, ttlSeconds: number): Promise<number> {
  if (storeIsPersistent()) {
    const [value] = await redisPipeline([["INCR", PREFIX + key], ["EXPIRE", PREFIX + key, ttlSeconds]]);
    return Number(value || 0);
  }
  const next = Number(memory().values.get(key) || 0) + 1;
  memory().values.set(key, String(next));
  return next;
}

export async function readCounter(key: string): Promise<number> {
  if (storeIsPersistent()) return Number((await redisCommand<string>("GET", [PREFIX + key])) || 0);
  return Number(memory().values.get(key) || 0);
}

// Every agent action is logged (spec 6: "Логирование").
export async function logAction(entry: Omit<LogEntry, "at">) {
  const full: LogEntry = { at: new Date().toISOString(), ...entry };
  const raw = JSON.stringify(full);
  if (storeIsPersistent()) {
    await redisPipeline([["LPUSH", LOG_KEY, raw], ["LTRIM", LOG_KEY, 0, LOG_LIMIT - 1]]);
    return;
  }
  const log = memory().log;
  log.unshift(raw);
  log.length = Math.min(log.length, LOG_LIMIT);
}

export async function readLog(limit = 100): Promise<LogEntry[]> {
  const raw = storeIsPersistent() ? await redisCommand<string[]>("LRANGE", [LOG_KEY, 0, limit - 1]) : memory().log.slice(0, limit);
  return (Array.isArray(raw) ? raw : []).map((r) => parse<LogEntry>(r)).filter(Boolean) as LogEntry[];
}

// Test helper: wipes the in-memory fallback.
export function resetMemoryStore() {
  globalScope.__scoutMemory = undefined;
}
