import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchWarning, planTasks, type Campaign } from "@/lib/scout/campaigns";
import { parseJoinArgs } from "@/lib/scout/campaigns-bot";
import type { GroupCard } from "@/lib/scout/groups";

beforeEach(() => vi.unstubAllEnvs());

const now = new Date().toISOString();
const group = (id: string, over: Partial<GroupCard> = {}): GroupCard => ({ id, platform: "facebook", url: "https://www.facebook.com/groups/" + id, name: id, ads: "unknown", status: "free", permissionConfirmedAt: now, foundAt: now, updatedAt: now, ...over });
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ id: "c1", title: "Квартира Валенсия", adText: "Продаю квартиру", topic: "недвижимость", region: "Валенсия, Испания", languages: ["ru"], keywords: ["квартира"], adjacent: [], queries: [], exclusions: [], questions: [], translations: {}, platforms: ["telegram", "facebook", "instagram", "tiktok"], dailyTarget: 300, status: "approved", source: "text", createdAt: now, updatedAt: now, found: { total: 1, core: 1, adjacent: 0, inactive: 0, at: now }, searchGroupIds: ["searched"], ...over });

describe("consented places outside the campaign's own search", () => {
  it("get the campaign on a topic hit, never when unrelated or empty", () => {
    const partner = group("partner", { partnerTelegramId: "555", topic: "недвижимость, Валенсия" });
    const flowers = group("flowers", { partnerTelegramId: "556", topic: "цветы Краков" });
    const empty = group("empty", { partnerTelegramId: "557" });
    const control = group("aurelius", { platform: "telegram", url: "https://t.me/aurelius", name: "AURELIUS", botConnected: true, postingEnabled: true, chatId: "-100" });
    const botChat = group("vlc", { platform: "telegram", url: "https://t.me/vlc", name: "Квартиры Валенсия чат", botConnected: true, postingEnabled: true, chatId: "-101" });
    const noConsent = group("free-rider", { status: "new", permissionConfirmedAt: undefined, topic: "недвижимость Валенсия" });
    const tasks = planTasks([campaign()], [partner, flowers, empty, control, botChat, noConsent], [], "2026-11-26");
    expect(tasks.map((t) => [t.groupId, t.mode])).toEqual([["partner", "partner"], ["vlc", "bot"]]);
  });
});

describe("/join topics", () => {
  it("reads limits and topics", () => {
    expect(parseJoinArgs("https://www.facebook.com/groups/valencia 1 3 недвижимость, Валенсия")).toEqual({ url: "https://www.facebook.com/groups/valencia", dailyLimit: 1, minDaysBetween: 3, topic: "недвижимость, Валенсия" });
    expect(parseJoinArgs("https://t.me/x 2")).toEqual({ url: "https://t.me/x", dailyLimit: 2, minDaysBetween: undefined, topic: undefined });
  });
});

describe("dispatch heartbeat", () => {
  it("warns only when posting is on, a campaign runs and the last wave is 3+ hours old", () => {
    const run = [campaign()];
    expect(dispatchWarning(null, run)).toBe("");
    vi.stubEnv("CAMPAIGN_AUTOPOST", "on");
    expect(dispatchWarning(null, run)).toContain("ни разу");
    expect(dispatchWarning(Date.now() - 3600_000, run)).toBe("");
    expect(dispatchWarning(Date.now() - 5 * 3600_000, run)).toContain("5 ч");
    expect(dispatchWarning(null, [campaign({ status: "stopped" })])).toBe("");
  });
});
