import { persistentMemoryConfigured, redisCommand, redisPipeline } from "@/lib/memory";
import type { LogEntry } from "@/lib/scout/types";

// Scout CRM storage.
// Priority:
// 1) LOCAL_STORE_DIR -> local JSON persistence (zero-cost/self-hosted mode)
// 2) Upstash/Vercel KV -> cloud persistence
// 3) process memory -> last-resort ephemeral fallback

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
const globalScope = globalThis as unknown as { __scoutMemory?: MemoryState; __scoutDiskQueue?: Promise<unknown> };
function memory(): MemoryState {
  globalScope.__scoutMemory ??= { hashes: new Map(), values: new Map(), log: [] };
  return globalScope.__scoutMemory;
}

type DiskState = {
  hashes: Record<string, Record<string, string>>;
  values: Record<string, string>;
  expires: Record<string, number>;
  log: string[];
};

function localStoreDir() {
  return String(process.env.LOCAL_STORE_DIR || "").trim();
}

function emptyDisk(): DiskState {
  return { hashes: {}, values: {}, expires: {}, log: [] };
}

async function diskPath() {
  const { join } = await import("node:path");
  return join(localStoreDir(), "scout-store.json");
}

async function readDisk(): Promise<DiskState> {
  if (!localStoreDir()) return emptyDisk();
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(await diskPath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      hashes: parsed?.hashes && typeof parsed.hashes === "object" ? parsed.hashes : {},
      values: parsed?.values && typeof parsed.values === "object" ? parsed.values : {},
      expires: parsed?.expires && typeof parsed.expires === "object" ? parsed.expires : {},
      log: Array.isArray(parsed?.log) ? parsed.log : [],
    };
  } catch {
    return emptyDisk();
  }
}

async function writeDisk(state: DiskState) {
  if (!localStoreDir()) return;
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  await mkdir(localStoreDir(), { recursive: true });
  const path = await diskPath();
  const tmp = path + ".tmp";
  await writeFile(tmp, JSON.stringify(state), "utf8");
  await rename(tmp, path);
}

async function mutateDisk<T>(fn: (state: DiskState) => T | Promise<T>): Promise<T> {
  const previous = globalScope.__scoutDiskQueue || Promise.resolve();
  let resolveResult!: (value: T) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const state = await readDisk();
        const value = await fn(state);
        await writeDisk(state);
        resolveResult(value);
      } catch (error) {
        rejectResult(error);
      }
    });
  globalScope.__scoutDiskQueue = next;
  return result;
}

export function storeIsPersistent() {
  return Boolean(localStoreDir()) || persistentMemoryConfigured();
}

function hashKey(collection: Collection) {
  return PREFIX + collection;
}

function parse<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function purgeExpired(state: DiskState, key: string) {
  const expires = Number(state.expires[key] || 0);
  if (expires && expires <= Date.now()) {
    delete state.expires[key];
    delete state.values[key];
    return true;
  }
  return false;
}

export async function listAll<T>(collection: Collection): Promise<T[]> {
  if (localStoreDir()) {
    const state = await readDisk();
    return Object.values(state.hashes[collection] || {}).map((v) => parse<T>(v)).filter(Boolean) as T[];
  }
  if (persistentMemoryConfigured()) {
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
  if (localStoreDir()) return parse<T>((await readDisk()).hashes[collection]?.[id]);
  if (persistentMemoryConfigured()) return parse<T>(await redisCommand<string>("HGET", [hashKey(collection), id]));
  return parse<T>(memory().hashes.get(collection)?.get(id));
}

export async function putMany<T extends { id: string }>(collection: Collection, items: T[]) {
  if (!items.length) return;
  if (localStoreDir()) {
    await mutateDisk((state) => {
      const hash = state.hashes[collection] || {};
      for (const item of items) hash[item.id] = JSON.stringify(item);
      state.hashes[collection] = hash;
    });
    return;
  }
  if (persistentMemoryConfigured()) {
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
  if (localStoreDir()) {
    await mutateDisk((state) => {
      const hash = state.hashes[collection] || {};
      for (const id of ids) delete hash[id];
      state.hashes[collection] = hash;
    });
    return;
  }
  if (persistentMemoryConfigured()) { await redisCommand("HDEL", [hashKey(collection), ...ids]); return; }
  const hash = memory().hashes.get(collection);
  for (const id of ids) hash?.delete(id);
}

export async function getValue<T>(key: string): Promise<T | null> {
  if (localStoreDir()) {
    const state = await readDisk();
    if (purgeExpired(state, key)) await writeDisk(state);
    return parse<T>(state.values[key]);
  }
  if (persistentMemoryConfigured()) return parse<T>(await redisCommand<string>("GET", [PREFIX + key]));
  return parse<T>(memory().values.get(key));
}

export async function setValue(key: string, value: unknown, ttlSeconds?: number) {
  const raw = JSON.stringify(value);
  if (localStoreDir()) {
    await mutateDisk((state) => {
      state.values[key] = raw;
      if (ttlSeconds) state.expires[key] = Date.now() + ttlSeconds * 1000;
      else delete state.expires[key];
    });
    return;
  }
  if (persistentMemoryConfigured()) {
    await redisCommand("SET", ttlSeconds ? [PREFIX + key, raw, "EX", ttlSeconds] : [PREFIX + key, raw]);
    return;
  }
  memory().values.set(key, raw);
}

export async function deleteValue(key: string) {
  if (localStoreDir()) {
    await mutateDisk((state) => { delete state.values[key]; delete state.expires[key]; });
    return;
  }
  if (persistentMemoryConfigured()) { await redisCommand("DEL", [PREFIX + key]); return; }
  memory().values.delete(key);
}

export async function increment(key: string, ttlSeconds: number): Promise<number> {
  if (localStoreDir()) {
    return mutateDisk((state) => {
      purgeExpired(state, key);
      const next = Number(state.values[key] || 0) + 1;
      state.values[key] = String(next);
      state.expires[key] = Date.now() + ttlSeconds * 1000;
      return next;
    });
  }
  if (persistentMemoryConfigured()) {
    const [value] = await redisPipeline([["INCR", PREFIX + key], ["EXPIRE", PREFIX + key, ttlSeconds]]);
    return Number(value || 0);
  }
  const next = Number(memory().values.get(key) || 0) + 1;
  memory().values.set(key, String(next));
  return next;
}

export async function readCounter(key: string): Promise<number> {
  if (localStoreDir()) {
    const state = await readDisk();
    if (purgeExpired(state, key)) await writeDisk(state);
    return Number(state.values[key] || 0);
  }
  if (persistentMemoryConfigured()) return Number((await redisCommand<string>("GET", [PREFIX + key])) || 0);
  return Number(memory().values.get(key) || 0);
}

export async function logAction(entry: Omit<LogEntry, "at">) {
  const full: LogEntry = { at: new Date().toISOString(), ...entry };
  const raw = JSON.stringify(full);
  if (localStoreDir()) {
    await mutateDisk((state) => {
      state.log.unshift(raw);
      state.log = state.log.slice(0, LOG_LIMIT);
    });
    return;
  }
  if (persistentMemoryConfigured()) {
    await redisPipeline([["LPUSH", LOG_KEY, raw], ["LTRIM", LOG_KEY, 0, LOG_LIMIT - 1]]);
    return;
  }
  const log = memory().log;
  log.unshift(raw);
  log.length = Math.min(log.length, LOG_LIMIT);
}

export async function readLog(limit = 100): Promise<LogEntry[]> {
  if (localStoreDir()) {
    const raw = (await readDisk()).log.slice(0, limit);
    return raw.map((r) => parse<LogEntry>(r)).filter(Boolean) as LogEntry[];
  }
  const raw = persistentMemoryConfigured() ? await redisCommand<string[]>("LRANGE", [LOG_KEY, 0, limit - 1]) : memory().log.slice(0, limit);
  return (Array.isArray(raw) ? raw : []).map((r) => parse<LogEntry>(r)).filter(Boolean) as LogEntry[];
}

export function resetMemoryStore() {
  globalScope.__scoutMemory = undefined;
}
