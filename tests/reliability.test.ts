import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { tgCall } from "@/lib/scout/telegram";
import { listAll, putOne, resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
});

describe("Telegram flood control", () => {
  it("waits retry_after on 429 and retries instead of losing the post", async () => {
    vi.useFakeTimers();
    let n = 0;
    mockFetch([{ match: (u) => u.includes("/sendMessage"), respond: () => (++n === 1 ? json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 2 } }, 429) : json({ ok: true, result: { message_id: 7 } })) }]);
    const pending = tgCall("sendMessage", { chat_id: 1, text: "x" });
    await vi.advanceTimersByTimeAsync(3000);
    expect((await pending).ok).toBe(true);
    expect(n).toBe(2);
    vi.useRealTimers();
  });
  it("does not retry a permanent error", async () => {
    let n = 0;
    mockFetch([{ match: () => true, respond: () => { n += 1; return json({ ok: false, error_code: 403, description: "bot was kicked" }, 403); } }]);
    expect((await tgCall("sendMessage", { chat_id: 1, text: "x" })).ok).toBe(false);
    expect(n).toBe(1);
  });
});

describe("database failures are loud, not silent", () => {
  it("retries a 5xx and then throws instead of returning an empty list", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "x");
    vi.stubEnv("KV_REST_API_URL", "");
    let n = 0;
    mockFetch([{ match: (u) => u.startsWith("https://redis.test"), respond: () => { n += 1; return new Response("busy", { status: 503 }); } }]);
    await expect(listAll("campaign_tasks")).rejects.toThrow(/недоступна/);
    await expect(putOne("groups", { id: "g" })).rejects.toThrow();
    expect(n).toBe(6);
  });
  it("recovers when a retry succeeds", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "x");
    vi.stubEnv("KV_REST_API_URL", "");
    let n = 0;
    mockFetch([{ match: () => true, respond: () => (++n === 1 ? new Response("", { status: 502 }) : json({ result: ["a", JSON.stringify({ id: "a" })] })) }]);
    expect(await listAll("groups")).toEqual([{ id: "a" }]);
  });
});
