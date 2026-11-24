import { describe, expect, it } from "vitest";
import { collapseTwins, normalizeTelegramUrl, sameCommunity, type GroupCard } from "@/lib/scout/groups";

const card = (id: string, url: string, name: string, members?: number, extra: Partial<GroupCard> = {}) =>
  ({ id, platform: "telegram", url, name, members, status: "new", foundAt: "2026-11-21T00:00:00Z", ...extra }) as GroupCard;

describe("one community, one record", () => {
  it("treats joinchat and + invite links as the same link", () => {
    expect(normalizeTelegramUrl("https://t.me/joinchat/QuDJqRZids7m_uqT")).toBe("https://t.me/+QuDJqRZids7m_uqT");
  });

  it("matches a public link and an invite link of the same chat, not different chats with one title", () => {
    expect(sameCommunity(card("a", "https://t.me/IgresinversionPSI", "IGRES INVERSION PSI VALENCIA", 732), card("b", "https://t.me/+u7zordrwU2AxOTc0", "IGRES INVERSION PSI VALENCIA", 732))).toBe(true);
    expect(sameCommunity(card("a", "https://t.me/investment_in_spain", "Валенсия: недвижимость", 1234), card("b", "https://t.me/+qSmzs", "Валенсия: недвижимость", 1235))).toBe(true);
    expect(sameCommunity(card("a", "https://t.me/nedvizhimostAlicante", "НЕДВИЖИМОСТЬ АЛИКАНТЕ", 1045), card("b", "https://t.me/alicante_rent_piso", "НЕДВИЖИМОСТЬ АЛИКАНТЕ", 2630))).toBe(false);
  });

  it("keeps the public link, or the card the owner already worked with", () => {
    const pub = card("pub", "https://t.me/Spain_chat1", "ИСПАНИЯ | ЧАТ", 741);
    const inv = card("inv", "https://t.me/+nTWTFc", "ИСПАНИЯ | ЧАТ", 741, { adminContact: "@admin" });
    let r = collapseTwins([inv, pub]);
    expect(r.keep.map((g) => g.id)).toEqual(["pub"]);
    expect(r.dropped).toEqual(["inv"]);
    expect(r.keep[0].adminContact).toBe("@admin");
    r = collapseTwins([pub, { ...inv, status: "free" }]);
    expect(r.keep.map((g) => g.id)).toEqual(["inv"]);
  });
});
