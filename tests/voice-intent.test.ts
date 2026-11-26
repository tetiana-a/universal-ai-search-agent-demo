import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCampaignIntent, isSearchQuestion } from "@/lib/scout/ad-wizard";
import { voiceIsSearch, campaignCard } from "@/lib/scout/campaigns-bot";
import { placeableCount, type Campaign } from "@/lib/scout/campaigns";
import { handleUpdate } from "@/lib/scout/bot";
import type { GroupCard } from "@/lib/scout/groups";
import { putOne, resetMemoryStore, setValue } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

const owner = 8213865630;
const now = new Date().toISOString();
const group = (id: string, over: Partial<GroupCard> = {}): GroupCard => ({ id, platform: "telegram", url: "https://t.me/" + id, name: id, ads: "unknown", status: "free", foundAt: now, updatedAt: now, ...over });
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ id: "c1", title: "Dance Antarctica", adText: "Dance group", topic: "dance", region: "Antarctica", languages: ["en"], keywords: ["dance"], adjacent: [], queries: [], exclusions: [], questions: [], translations: { en: "x" }, platforms: ["telegram"], dailyTarget: 300, status: "ready", source: "voice", createdAt: now, updatedAt: now, ...over });

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("TELEGRAM_ALLOWED_CHAT_IDS", String(owner));
});

describe("voice intent", () => {
  it("sends questions to research and ad tasks to campaigns", async () => {
    expect(isSearchQuestion("Найди мне в Японии самого лучшего программиста.")).toBe(true);
    expect(isSearchQuestion("Where can I find a dancing group in Antarctica?")).toBe(true);
    expect(isCampaignIntent("Найди мне в Японии самого лучшего программиста.")).toBe(false);
    expect(isCampaignIntent("Продаю квартиру в Валенсии, Telegram и Facebook, 300 в день")).toBe(true);
    expect(isCampaignIntent("Разместите объявление о продаже машины")).toBe(true);
    const chat = String(owner);
    expect(await voiceIsSearch(chat, "Where can I find a dancing group in Antarctica?")).toBe(true);
    expect(await voiceIsSearch(chat, "Продаю квартиру в Валенсии")).toBe(false);
    // After a draft's questions, a plain answer completes the draft; a new question is a new search.
    await setValue("cmp-answer:" + chat, "c1", 60);
    expect(await voiceIsSearch(chat, "Python и удалёнка, полный день")).toBe(false);
    expect(await voiceIsSearch(chat, "Где найти хорошего стоматолога в Праге?")).toBe(true);
  });

  it("keeps the ad text and the next line apart", () => {
    const card = campaignCard(campaign({ keywords: ["dance", "programmer"], adjacent: ["Antarctica community"] }));
    expect(card).toContain("</blockquote>\n<i>Переводы");
    expect(card).toContain("programmer</blockquote>\n🧭");
  });
});

describe("placement start", () => {
  it("counts only places whose admins allowed publishing", () => {
    const c = campaign({ status: "approved", searchGroupIds: ["a", "b"] });
    expect(placeableCount(c, [group("a"), group("b")])).toBe(0);
    expect(placeableCount(c, [group("a", { botConnected: true, postingEnabled: true, chatId: "-1" }), group("b")])).toBe(1);
  });

  it("does not start when found places have no permission", async () => {
    const sent: any[] = [];
    mockFetch([{ match: (u) => u.startsWith("https://api.telegram.org/"), respond: (_u, init) => { sent.push(JSON.parse(String(init?.body || "{}"))); return json({ ok: true, result: { message_id: 1 } }); } }]);
    await putOne("groups", group("a"));
    await putOne("campaigns", campaign({ searchGroupIds: ["a"], found: { total: 1, core: 0, adjacent: 1, inactive: 0, at: now } }));
    const r: any = await handleUpdate({ update_id: 1, callback_query: { id: "q", from: { id: owner }, data: "cp:start:c1", message: { message_id: 5, chat: { id: owner, type: "private" } } } } as any);
    await r.background?.();
    const texts = sent.map((p) => String(p.text || "")).join("\n");
    expect(texts).toContain("публиковать пока негде");
    expect(texts).not.toContain("Размещение запущено");
  });
});
