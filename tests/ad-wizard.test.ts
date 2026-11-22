import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleUpdate } from "@/lib/scout/bot";
import { isAdPostingIntent, platformChoice } from "@/lib/scout/ad-wizard";
import { getValue, listAll, resetMemoryStore } from "@/lib/scout/store";
import type { Campaign } from "@/lib/scout/campaigns";
import { json, mockFetch } from "./helpers";

const owner = "8213865630";
const chat = 8213865630;
const example = "Продаю двухкомнатную квартиру в Валенсии за 240 000 €. Звоните +34 600 000 000.";

function incoming(text: string) {
  return { message: { message_id: 9, chat: { id: chat, type: "private" }, from: { id: chat, first_name: "Owner" }, text } };
}

function telegramRecorder() {
  const sent: any[] = [];
  mockFetch([{
    match: (url) => url.startsWith("https://api.telegram.org/bottest-bot-token/"),
    respond: (_url, init) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      sent.push(payload);
      return json({ ok: true, result: { message_id: sent.length } });
    },
  }]);
  return sent;
}

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", owner);
  vi.stubEnv("TELEGRAM_CHAT_ID", owner);
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});

describe("Telegram advertisement posting wizard", () => {
  it("recognizes publication requests, not ordinary information searches", () => {
    expect(isAdPostingIntent("нужно разместить объявление")).toBe(true);
    expect(isAdPostingIntent("Опубликовать рекламу")).toBe(true);
    expect(isAdPostingIntent("Хочу розмістити оголошення")).toBe(true);
    expect(isAdPostingIntent("Please publish an advert")).toBe(true);
    expect(isAdPostingIntent("Найди объявления о продаже квартир")).toBe(false);
    expect(isAdPostingIntent("Хочу найти группы о недвижимости")).toBe(false);
    expect(platformChoice("Телеграм и Фейсбук")).toEqual(["telegram", "facebook"]);
    expect(platformChoice("всі")).toEqual(["telegram", "facebook", "instagram", "tiktok"]);
  });

  it("routes ordinary text through the 3-step wizard, creating a draft without publishing", async () => {
    const sent = telegramRecorder();
    await handleUpdate(incoming("нужно разместить объявление"));
    expect(sent.at(-1).text).toContain("Размещение объявления · 1/3");
    expect(await listAll<Campaign>("campaigns")).toHaveLength(0);

    await handleUpdate(incoming("Валенсия, Испания"));
    expect(sent.at(-1).text).toContain("Размещение объявления · 2/3");

    await handleUpdate(incoming(example));
    expect(sent.at(-1).text).toContain("Размещение объявления · 3/3");

    const finish = await handleUpdate(incoming("Telegram и Facebook"));
    expect(typeof finish.background).toBe("function");
    await finish.background?.();

    const campaigns = await listAll<Campaign>("campaigns");
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toMatchObject({ status: "draft", region: "Валенсия, Испания", adText: example, platforms: ["telegram", "facebook"] });
    expect(sent.some((item) => String(item.text || "").includes("НИЧЕГО НЕ ОПУБЛИКОВАНО"))).toBe(true);
    expect(sent.every((item) => String(item.chat_id) === owner)).toBe(true);
  });

  it("supports a photo and platform buttons without auto-sending", async () => {
    const sent = telegramRecorder();
    await handleUpdate(incoming("/ad"));
    await handleUpdate(incoming("Барселона, Испания"));
    await handleUpdate({ message: {
      message_id: 10,
      chat: { id: chat, type: "private" },
      from: { id: chat, first_name: "Owner" },
      photo: [{ file_id: "small_photo" }, { file_id: "large_photo" }],
      caption: example,
    } });
    expect(sent.at(-1).text).toContain("Размещение объявления · 3/3");
    const callback = await handleUpdate({ callback_query: {
      id: "cb_wizard",
      data: "aw:platforms:tgfb",
      message: { message_id: 11, chat: { id: chat, type: "private" } },
      from: { id: chat },
    } });
    await callback.background?.();
    const campaigns = await listAll<Campaign>("campaigns");
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].photo).toBe("large_photo");
    expect(campaigns[0].platforms).toEqual(["telegram", "facebook"]);
    expect(campaigns[0].status).toBe("draft");
    expect(sent.every((item) => !String(item.chat_id).startsWith("-100"))).toBe(true);
  });

  it("cancels safely via plain text and does not create a campaign", async () => {
    telegramRecorder();
    await handleUpdate(incoming("нужно разместить объявление"));
    await handleUpdate(incoming("отмена"));
    expect(await getValue("advert-wizard:" + owner + ":" + owner)).toBeNull();
    expect(await listAll<Campaign>("campaigns")).toHaveLength(0);
  });

  it("ignores a forged callback when no wizard was started", async () => {
    const sent = telegramRecorder();
    await handleUpdate({ callback_query: {
      id: "bad",
      data: "aw:platforms:tgfb",
      message: { message_id: 12, chat: { id: chat, type: "private" } },
      from: { id: chat },
    } });
    expect(await listAll<Campaign>("campaigns")).toHaveLength(0);
    expect(sent.some((x) => x.text && x.text.includes("Черновик готов"))).toBe(false);
  });
});
