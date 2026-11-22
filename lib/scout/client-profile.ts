import { findForCampaign, listCampaigns } from "@/lib/scout/campaigns";
import { findGroups, listGroups, type FindInput } from "@/lib/scout/groups";
import { getValue, logAction, setValue } from "@/lib/scout/store";

// The client's own activity (from his Telegram profile «We Samadhi»): businessman, spiritual
// mentor, 20+ real-estate and other projects, open to partnership. The community base is built
// around these themes: core = where his offers sell directly, adjacent = audiences that buy them.
// Regions are a first guess (Russian-speaking investors, relocation and retreat destinations).
export const CLIENT_PROFILE = {
  name: "We Samadhi",
  summary: "Бизнесмен и духовный наставник: 20+ проектов в недвижимости и других направлениях, ретриты и духовные практики, открыт к партнёрству и инвесторам.",
  themes: [
    { topic: "инвестиции в недвижимость", relevance: "core" },
    { topic: "недвижимость купить виллу апартаменты", relevance: "core" },
    { topic: "духовные практики ретриты", relevance: "core" },
    { topic: "медитация йога ретрит", relevance: "core" },
    { topic: "бизнес партнёрство инвесторы", relevance: "core" },
    { topic: "предприниматели нетворкинг бизнес-клуб", relevance: "adjacent" },
    { topic: "релокация экспаты переезд", relevance: "adjacent" },
    { topic: "саморазвитие осознанность коучинг", relevance: "adjacent" },
    { topic: "wellness путешествия трансформационные туры", relevance: "adjacent" },
  ] as const,
  regions: [
    { country: "Греция" }, { country: "Кипр" }, { country: "ОАЭ", city: "Дубай" }, { country: "Индонезия", city: "Бали" },
    { country: "Таиланд" }, { country: "Испания" }, { country: "Турция" }, { country: "Черногория" }, { country: "Россия", city: "Москва" }, {},
  ] as { country?: string; city?: string }[],
};

// Every theme × region pair, in an order that alternates regions so each batch covers several places.
export function profilePlan(): FindInput[] {
  const { themes, regions } = CLIENT_PROFILE;
  return regions.flatMap((_, r) => themes.map((t, i) => ({ topic: t.topic, relevance: t.relevance, ...regions[(r + i) % regions.length] })));
}

const CURSOR_KEY = "client-profile:cursor";

// Runs the next pairs of the plan until the time budget ends; the cursor wraps, so the
// whole base is re-checked (liveness, members, ads rules) and grows every cycle.
export async function runProfileBatch(deadlineAt = Date.now() + 150_000) {
  const plan = profilePlan();
  let cursor = Number(await getValue<number>(CURSOR_KEY)) || 0;
  const before = (await listGroups()).length;
  let runs = 0, added = 0;
  while (Date.now() < deadlineAt - 50_000 && runs < plan.length) {
    const input = plan[cursor % plan.length];
    const r = await findGroups(input, Math.min(deadlineAt - 5_000, Date.now() + 45_000)).catch(() => null);
    added += r?.added || 0;
    runs += 1;
    cursor = (cursor + 1) % plan.length;
    await setValue(CURSOR_KEY, cursor);
  }
  const total = (await listGroups()).length;
  await logAction({ actor: "agent", action: "groups.profile", detail: "Подбор под клиента: " + runs + " запросов, новых " + added + ", в базе " + total + " (было " + before + ")" });
  return { runs, added, total, cursor, planSize: plan.length };
}

// Approved campaigns keep finding new communities: the one searched longest ago is refreshed.
export async function refreshOneCampaign(deadlineAt: number) {
  const active = (await listCampaigns()).filter((c) => c.status === "approved")
    .sort((a, b) => Date.parse(a.found?.at || "0") - Date.parse(b.found?.at || "0"));
  if (!active.length || Date.now() > deadlineAt - 60_000) return null;
  const r = await findForCampaign(active[0].id, deadlineAt);
  return r ? { campaign: r.campaign.title, total: r.campaign.found?.total || 0 } : null;
}
