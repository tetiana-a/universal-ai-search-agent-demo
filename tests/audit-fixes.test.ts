import { beforeEach, describe, expect, it, vi } from "vitest";
import { audienceIds, dispatchBotTasks, modeFor, searchPlan, today, type Campaign, type CampaignTask } from "@/lib/scout/campaigns";
import { addGroupManually, collapseTwins, upsertGroups, type GroupCard } from "@/lib/scout/groups";
import { changedAt } from "@/lib/archive";
import { getOne, listAll, putOne, resetMemoryStore, setValue } from "@/lib/scout/store";
import { mockFetch } from "./helpers";

const now = "2026-11-24T00:00:00.000Z";
const camp = (over: Partial<Campaign> = {}): Campaign => ({
  id: "c1", title: "T", topic: "аренда", region: "Валенсия, Испания", adText: "x", languages: ["ru"], platforms: ["telegram"],
  keywords: [], adjacent: [], queries: [], exclusions: [], questions: [], translations: {}, status: "approved", dailyTarget: 1,
  source: "text", createdAt: now, updatedAt: now, ...over,
});
const g = (id: string, over: Partial<GroupCard> = {}) => ({ id, platform: "telegram", url: "https://t.me/" + id, name: id, ads: "allowed", status: "new", foundAt: now, updatedAt: now, ...over }) as GroupCard;

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
});

describe("search covers every approved keyword in every language", () => {
  it("rotates through the whole list across runs", () => {
    const c = camp({ keywords: Array.from({ length: 39 }, (_, i) => "k" + i), languages: ["ru", "es"] });
    const seen = new Set<string>();
    let cursor = { core: 0, adjacent: 0 };
    for (let run = 0; run < 8; run += 1) {
      const plan = searchPlan({ ...c, searchCursor: cursor }, 10);
      expect(plan).toHaveLength(10);
      plan.forEach((p) => seen.add(p.topic + "|" + p.language));
      cursor = { core: cursor.core + plan.length, adjacent: 0 };
    }
    expect(seen.size).toBe(80); // 40 terms (topic + 39) × 2 languages
  });
});

describe("recorded permission", () => {
  it("an agreed status without a record gives no manual task; bot-connected chats still post", () => {
    expect(modeFor(g("a", { platform: "facebook", status: "free" }))).toBeNull();
    expect(modeFor(g("b", { platform: "facebook", status: "free", permissionConfirmedAt: now }))).toBe("manual");
    expect(modeFor(g("c", { status: "free", botConnected: true, postingEnabled: true, chatId: "-100" }))).toBe("bot");
  });

  it("a manual add without a consent note waits as contacted", async () => {
    const a = await addGroupManually({ url: "https://www.facebook.com/groups/one" });
    expect(a?.status).toBe("contacted");
    const b = await addGroupManually({ url: "https://www.facebook.com/groups/two", permissionNote: "переписка с админом 24.11" });
    expect(b).toMatchObject({ status: "free", permissionConfirmedBy: "owner" });
  });
});

describe("dedupe keeps references", () => {
  it("moves campaign audiences and tasks to the surviving card", async () => {
    await putOne("groups", g("pub", { url: "https://t.me/pub", name: "Chat Valencia", members: 500 }));
    await putOne("groups", g("inv", { url: "https://t.me/+abc", name: "Chat Valencia", members: 500 }));
    await putOne("campaigns", camp({ searchGroupIds: ["inv"], controlGroupIds: ["inv", "pub"] }));
    await putOne("campaign_tasks", { id: "t1", groupId: "inv", campaignId: "c1" } as CampaignTask);
    await upsertGroups([]);
    const c = (await getOne<Campaign>("campaigns", "c1"))!;
    expect(c.searchGroupIds).toEqual(["pub"]);
    expect(audienceIds(c)).toEqual(["pub"]);
    expect((await getOne<CampaignTask>("campaign_tasks", "t1"))?.groupId).toBe("pub");
    expect(collapseTwins([g("x", { name: "Same name", members: 10 }), g("y", { name: "Same name", members: 10 })]).survivorOf).toEqual({ y: "x" });
  });
});

describe("sent but not saved", () => {
  it("never sends again once the sent mark exists", async () => {
    vi.stubEnv("CAMPAIGN_AUTOPOST", "on");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
    const group = g("grp", { status: "free", botConnected: true, postingEnabled: true, chatId: "-1001" });
    await putOne("groups", group);
    await putOne("campaigns", camp({ found: { total: 1, core: 1, adjacent: 0, inactive: 0, at: now }, searchGroupIds: ["grp"] }));
    await putOne("campaign_tasks", { id: "t1", campaignId: "c1", campaignTitle: "T", groupId: "grp", groupName: "grp", platform: "telegram", url: group.url, mode: "bot", day: today(), status: "scheduled", createdAt: now, updatedAt: now } as CampaignTask);
    await setValue("campaign-sent:t1", { link: "https://t.me/c/1/5", at: now });
    const calls = mockFetch([]);
    const r = await dispatchBotTasks(today(), Date.now() + 5000, 0);
    expect(r.sent).toBe(0);
    expect(calls.filter((c) => c.url.includes("api.telegram.org"))).toHaveLength(0);
    expect((await getOne<CampaignTask>("campaign_tasks", "t1"))).toMatchObject({ status: "sent", link: "https://t.me/c/1/5" });
    expect((await listAll("group_posts")).length).toBe(1);
  });
});

describe("incremental archive", () => {
  it("uses the newest timestamp of a record", () => {
    expect(changedAt({ createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z" })).toBe("2026-11-20T00:00:00Z");
    expect(changedAt({ day: "2026-11-01" })).toBeNull();
  });
});
