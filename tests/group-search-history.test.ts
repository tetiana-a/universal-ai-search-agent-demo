import { describe, expect, it, vi } from "vitest";
import { readRun, readSearchHistory, recordGroupSearch } from "@/lib/memory";

describe("group search history", () => {
  it("saves a community search with per-platform counts and its results", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    const entry = await recordGroupSearch({
      query: "недвижимость · Валенсия", origin: "web", added: 2,
      found: [
        { platform: "telegram", url: "https://t.me/a", name: "A" },
        { platform: "facebook", url: "https://www.facebook.com/groups/1", name: "B" },
        { platform: "tiktok", url: "https://www.tiktok.com/@c", name: "C" },
      ],
    });
    expect(entry.byPlatform).toEqual({ telegram: 1, instagram: 0, tiktok: 1, facebook: 1 });
    expect((await readSearchHistory())[0]).toMatchObject({ id: entry.id, kind: "groups", results: 3 });
    expect((await readRun(entry.id))?.results[1]).toMatchObject({ url: "https://www.facebook.com/groups/1", status: "facebook" });
  });
});
