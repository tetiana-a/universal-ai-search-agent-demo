import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTgStatHits, tgStatEnabled, tgStatSearch } from "@/lib/scout/tgstat";
import { json, mockFetch } from "./helpers";

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv("TGSTAT_SEARCH_ENABLED", "off");
  vi.stubEnv("TGSTAT_TOKEN", "");
});
describe("TGStat optional search", () => {
  it("is completely off without both explicit approval and a token", async () => {
    expect(tgStatEnabled()).toBe(false);
    const result = await tgStatSearch("flowers", "Poland");
    expect(result).toMatchObject({ ok: false, error: "TGSTAT_NOT_CONFIGURED" });
  });
  it("keeps only public group/channel URLs and discards bots/private links", () => {
    expect(normalizeTgStatHits({ status: "ok", response: { items: [
      { link: "t.me/flowers_krakow" },
      { username: "@florists_pl" },
      { username: "@florists_pl" },
      { link: "t.me/joinchat/secret" },
      { link: "https://t.me/flowers_bot" },
      { link: "https://bad.example/flower" },
    ] } })).toEqual(["https://t.me/flowers_krakow", "https://t.me/florists_pl"]);
  });
  it("queries the official endpoint with country code and never returns a token in output", async () => {
    vi.stubEnv("TGSTAT_SEARCH_ENABLED", "on");
    vi.stubEnv("TGSTAT_TOKEN", "test-only-tgstat");
    const called = mockFetch([{
      match: url => url.startsWith("https://api.tgstat.ru/channels/search"),
      respond: () => json({ status: "ok", response: { count: 1, items: [{ link: "t.me/flowers_krakow" }] } }),
    }]);
    const result = await tgStatSearch("kwiaty Kraków", "Poland");
    expect(result).toMatchObject({ ok: true, urls: ["https://t.me/flowers_krakow"] });
    expect(called[0].url).toContain("country=pl");
    expect(JSON.stringify(result)).not.toContain("test-only-tgstat");
  });
});
