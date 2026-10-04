import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch, postJson } from "./helpers";

vi.mock("@/lib/server-exporters", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, createXlsxBuffer: vi.fn(actual.createXlsxBuffer), createPdfBuffer: vi.fn(async () => Buffer.from("%PDF-1.4 test")) };
});

import { POST } from "@/app/api/telegram/send/route";
import * as exporters from "@/lib/server-exporters";

const body = { payload: { query: "q", results: [{ title: "Fund", url: "https://fund.example.com", evidenceQuote: "Fund invests in SaaS." }] } };
const send = () => POST(postJson("http://localhost/api/telegram/send", body));
const telegram = (method: string) => (u: string) => u.startsWith("https://api.telegram.org/") && u.endsWith("/" + method);

beforeEach(() => {
  vi.stubEnv("PLAN_ENFORCEMENT", "off");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("TELEGRAM_CHAT_ID", "555");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Telegram delivery", () => {
  it("explains a missing bot token", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const response = await send();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("TELEGRAM_BOT_TOKEN");
  });

  it("rejects recipients outside the allowlist", async () => {
    const response = await POST(postJson("http://localhost/api/telegram/send", { ...body, chatIds: ["999"] }));
    expect(response.status).toBe(403);
  });

  it("diagnoses an invalid bot token", async () => {
    mockFetch([{ match: telegram("getMe"), respond: () => json({ ok: false, description: "Unauthorized" }, 401) }]);
    const response = await send();
    const data = await response.json();
    expect(response.status).toBe(503);
    expect(data.stage).toBe("bot_token");
    expect(data.hint).toContain("BotFather");
  });

  it("reports 'chat not found' with an actionable hint", async () => {
    mockFetch([
      { match: telegram("getMe"), respond: () => json({ ok: true, result: { id: 1, username: "bot" } }) },
      { match: telegram("sendMessage"), respond: () => json({ ok: false, description: "Bad Request: chat not found" }, 400) },
    ]);
    const response = await send();
    const data = await response.json();
    expect(response.status).toBe(502);
    expect(data.error).toContain("chat not found");
    expect(data.hint).toContain("Start");
  });

  it("still delivers the report when XLSX generation fails", async () => {
    vi.mocked(exporters.createXlsxBuffer).mockRejectedValueOnce(new Error("exceljs exploded"));
    const calls = mockFetch([
      { match: telegram("getMe"), respond: () => json({ ok: true, result: { id: 1, username: "bot" } }) },
      { match: telegram("sendMessage"), respond: () => json({ ok: true, result: { message_id: 10 } }) },
      { match: telegram("sendDocument"), respond: () => json({ ok: true, result: { message_id: 11 } }) },
    ]);
    const response = await send();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.partial).toBe(true);
    expect(data.attachments).toEqual({ xlsx: false, pdf: true });
    expect(data.attachmentErrors[0]).toMatchObject({ stage: "xlsx_generation", error: "exceljs exploded" });
    expect(calls.filter((c) => c.url.endsWith("/sendMessage")).length).toBeGreaterThan(0);
  });

  it("sends the report and both attachments on success", async () => {
    mockFetch([
      { match: telegram("getMe"), respond: () => json({ ok: true, result: { id: 1, username: "bot" } }) },
      { match: telegram("sendMessage"), respond: () => json({ ok: true, result: { message_id: 10 } }) },
      { match: telegram("sendDocument"), respond: () => json({ ok: true, result: { message_id: 11 } }) },
    ]);
    const data = await (await send()).json();
    expect(data).toMatchObject({ ok: true, partial: false, attachments: { xlsx: true, pdf: true } });
  });
});

describe("Telegram on the Free plan", () => {
  it("is open to Free users unless FREE_TELEGRAM=off, and still checks the allowlist", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("PRO_ACCESS_KEYS", "");
    const open = await POST(postJson("http://localhost/api/telegram/send", { ...body, chatIds: ["999"] }));
    expect(open.status).toBe(403);
    expect((await open.json()).stage).toBe("allowlist");
    vi.stubEnv("FREE_TELEGRAM", "off");
    const closed = await send();
    expect(closed.status).toBe(403);
    expect((await closed.json()).code).toBe("PLAN_FEATURE_UNAVAILABLE");
  });
});

describe("Telegram group delivery", () => {
  const ok = (id: number) => () => json({ ok: true, result: { message_id: id } });

  it("sends to a basic group id from TELEGRAM_CHAT_ID", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "-5415363237");
    const calls = mockFetch([
      { match: telegram("getMe"), respond: () => json({ ok: true, result: { id: 8728690642, username: "AURELIUS8_bot" } }) },
      { match: telegram("sendMessage"), respond: ok(10) },
      { match: telegram("sendDocument"), respond: ok(11) },
    ]);
    const data = await (await send()).json();
    expect(data).toMatchObject({ ok: true, partial: false, delivered: [{ chatId: "-5415363237" }] });
    const sent = calls.filter((c) => c.url.endsWith("/sendMessage")).map((c) => JSON.parse(String(c.init?.body)));
    expect(sent.every((b) => b.chat_id === "-5415363237")).toBe(true);
  });

  it("follows a group that was upgraded to a supergroup and reports the new id", async () => {
    vi.stubEnv("TELEGRAM_CHAT_ID", "-5415363237");
    const calls = mockFetch([
      { match: telegram("getMe"), respond: () => json({ ok: true, result: { id: 1, username: "bot" } }) },
      {
        match: telegram("sendMessage"),
        respond: (_u: string, init?: RequestInit) => JSON.parse(String(init?.body)).chat_id === "-5415363237"
          ? json({ ok: false, description: "Bad Request: group chat was upgraded to a supergroup chat", parameters: { migrate_to_chat_id: -1005415363237 } }, 400)
          : json({ ok: true, result: { message_id: 20 } }),
      },
      { match: telegram("sendDocument"), respond: ok(21) },
    ]);
    const data = await (await send()).json();
    expect(data.ok).toBe(true);
    expect(data.delivered[0]).toMatchObject({ chatId: "-5415363237", migratedTo: "-1005415363237" });
    expect(data.migrations).toEqual([{ from: "-5415363237", to: "-1005415363237" }]);
    expect(data.migrationHint).toContain("TELEGRAM_CHAT_ID");
    const docs = calls.filter((c) => c.url.endsWith("/sendDocument"));
    expect(docs.length).toBe(2);
    expect(docs.every((c) => (c.init?.body as FormData).get("chat_id") === "-1005415363237")).toBe(true);
  });
});

describe("Telegram report text", () => {
  it("leads with the query, the progress counters and readable result cards", async () => {
    const { buildTelegramMessages } = await import("@/lib/telegram-report");
    const messages = buildTelegramMessages({
      query: "Инвесторы <B2B> в Амстердаме",
      progressCounters: { sourcesDiscovered: 84, sourcesChecked: 31, matchingCriteria: 11 },
      results: [
        { organization: "Peak", ticket: "€500k", url: "https://peak.example", status: "Verified", match: 88, evidenceQuote: "We back B2B software." },
        { organization: "Bad", url: "javascript:alert(1)" },
      ],
    });
    expect(messages[0]).toContain("Инвесторы &lt;B2B&gt;");
    expect(messages[0]).toContain("Источников обнаружено: <b>84</b>");
    expect(messages[1]).toContain("Чек / стадия: €500k");
    expect(messages[1]).toContain('<a href="https://peak.example">Открыть</a>');
    expect(messages[1]).not.toContain("javascript:");
    expect(messages.every((m) => m.length <= 4096)).toBe(true);
  });
});
