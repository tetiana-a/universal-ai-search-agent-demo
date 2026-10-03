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

  it("is a Pro feature when plans are enforced", async () => {
    vi.stubEnv("PLAN_ENFORCEMENT", "on");
    vi.stubEnv("DEFAULT_PLAN", "free");
    const response = await send();
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("PLAN_FEATURE_UNAVAILABLE");
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
