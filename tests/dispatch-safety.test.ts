import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/campaigns/dispatch/route";
import { dispatchBotTasks, today, type Campaign, type CampaignTask } from "@/lib/scout/campaigns";
import type { GroupCard } from "@/lib/scout/groups";
import { getOne, putOne, resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

const time = "2026-11-22T08:00:00.000Z";
const chat = "-1001234567890";
const group: GroupCard = {
  id: "test-approved", name: "My test group", platform: "telegram",
  url: "https://t.me/my_test_group", chatId: chat,
  botConnected: true, postingEnabled: true,
  status: "free", ads: "allowed", foundAt: time, updatedAt: time,
};
const campaign: Campaign = {
  id: "test-c", title: "Unregulated test post", topic: "flowers", region: "Kraków, Polska",
  adText: "This is an authorized test post", languages: ["pl"], platforms: ["telegram"],
  keywords: ["flowers"], adjacent: [], queries: [], exclusions: [], questions: [], translations: {},
  status: "approved", dailyTarget: 1, source: "text",
  found: { total: 1, core: 1, adjacent: 0, inactive: 0, at: time },
  searchGroupIds: ["test-approved"],
  createdAt: time, updatedAt: time,
};
function task(): CampaignTask { return {
  id: "test-task", campaignId: campaign.id, campaignTitle: campaign.title,
  groupId: group.id, groupName: group.name, platform: "telegram", url: group.url,
  mode: "bot", day: today(), status: "scheduled", createdAt: time, updatedAt: time,
}; }

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-bot-token");
  vi.stubEnv("CAMPAIGN_AUTOPOST", "");
  vi.stubEnv("CRON_SECRET", "test-only-secret");
});

describe("external dispatch waves are opt-in and safe", () => {
  it("requires a signed cron secret, not just a forged user agent", async () => {
    const response = await GET(new Request("https://x/api/campaigns/dispatch", { headers: { "user-agent": "vercel-cron" } }));
    expect(response.status).toBe(401);
  });

  it("is disabled by default, even for an authenticated n8n scheduler", async () => {
    const response = await GET(new Request("https://x/api/campaigns/dispatch", { headers: { authorization: "Bearer test-only-secret" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, disabled: true, sent: 0 });
  });

  it("sends only one message if two dispatch waves overlap", async () => {
    vi.stubEnv("CAMPAIGN_AUTOPOST", "on");
    await putOne("campaigns", campaign);
    await putOne("groups", group);
    await putOne("campaign_tasks", task());
    const delivered: string[] = [];
    mockFetch([{
      match: (url) => url.endsWith("/sendMessage"),
      respond: (_url, init) => {
        const data = JSON.parse(String(init?.body || "{}"));
        delivered.push(data.chat_id);
        return json({ ok: true, result: { message_id: 1 } });
      },
    }]);
    const both = await Promise.all([
      dispatchBotTasks(today(), Date.now() + 10000, 0),
      dispatchBotTasks(today(), Date.now() + 10000, 0),
    ]);
    expect(both.reduce((sum, x) => sum + x.sent, 0)).toBe(1);
    expect(delivered).toEqual([chat]);
    expect((await getOne<CampaignTask>("campaign_tasks", "test-task"))?.status).toBe("sent");
  });
});
