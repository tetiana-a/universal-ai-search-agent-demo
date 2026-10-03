import { dashboardUrl } from "@/lib/scout/config";
import { formatLocal, isTomorrow, timezone } from "@/lib/scout/calendar";
import { getValue, listAll, logAction, setValue } from "@/lib/scout/store";
import { escapeHtml, formatMoney } from "@/lib/scout/text";
import type { AgencyCard, Draft, InvestorCard, Lead, Match, Meeting, ObjectCard, ScanStats, ScoutSource } from "@/lib/scout/types";
import type { Keyboard } from "@/lib/scout/telegram";

// The daily report (spec 3): one Telegram message + a stored copy. Every line links to its card.

export type ReportData = {
  date: string;
  objects: { total: number; byPlace: Array<{ place: string; count: number; top?: ObjectCard }> };
  investors: { total: number; familyOffices: number; private: number; funds: number; companies: number; topMatches: Array<{ match: Match; object?: ObjectCard; investor?: InvestorCard }> };
  dialogs: { inProgress: number; qualified: number; refused: number; escalated: number };
  agencies: { written: number; replied: number; meetings: number };
  intel: { watchPosts: number; watchContacts: number; groups: ScoutSource[]; platforms: ScoutSource[]; agenciesNew: number; agenciesNewCity?: string };
  pendingDrafts: number;
  meetingsTomorrow: Meeting[];
  candidates: ScoutSource[];
};

const DAY = 86400000;

function recent(iso: string | undefined, since: number) {
  return Boolean(iso) && Date.parse(iso!) >= since;
}

export async function collectReport(now = Date.now()): Promise<ReportData> {
  const since = now - DAY;
  const [objects, investors, agencies, leads, matches, meetings, sources, drafts, scan] = await Promise.all([
    listAll<ObjectCard>("objects"), listAll<InvestorCard>("investors"), listAll<AgencyCard>("agencies"), listAll<Lead>("leads"),
    listAll<Match>("matches"), listAll<Meeting>("meetings"), listAll<ScoutSource>("sources"), listAll<Draft>("drafts"), getValue<ScanStats>("last-scan"),
  ]);

  const newObjects = objects.filter((o) => recent(o.firstSeenAt, since) && o.state !== "rejected");
  const places = new Map<string, ObjectCard[]>();
  for (const o of newObjects) { const key = o.country + (o.city ? " (" + o.city + ")" : ""); places.set(key, [...(places.get(key) || []), o]); }
  const byPlace = Array.from(places.entries()).map(([place, list]) => ({ place, count: list.length, top: [...list].sort((a, b) => b.score - a.score)[0] })).sort((a, b) => b.count - a.count);

  const newInvestors = investors.filter((i) => recent(i.firstSeenAt, since));
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const investorById = new Map(investors.map((i) => [i.id, i]));
  const topMatches = matches.filter((m) => m.state === "proposed").sort((a, b) => b.score - a.score).slice(0, 3).map((match) => ({ match, object: objectById.get(match.objectId), investor: investorById.get(match.investorId) }));

  const newSources = sources.filter((s) => recent(s.discoveredAt, since));
  const newAgencies = agencies.filter((a) => recent(a.firstSeenAt, since));
  const cityCount = new Map<string, number>();
  for (const a of newAgencies) if (a.city) cityCount.set(a.city, (cityCount.get(a.city) || 0) + 1);

  return {
    date: new Intl.DateTimeFormat("ru-RU", { timeZone: timezone(), day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(now)),
    objects: { total: newObjects.length, byPlace },
    investors: {
      total: newInvestors.length,
      familyOffices: newInvestors.filter((i) => i.kind === "family_office").length,
      private: newInvestors.filter((i) => i.kind === "private").length,
      funds: newInvestors.filter((i) => i.kind === "fund").length,
      companies: newInvestors.filter((i) => i.kind === "company").length,
      topMatches,
    },
    dialogs: {
      inProgress: leads.filter((l) => l.state === "in_progress").length,
      qualified: leads.filter((l) => l.state === "qualified").length,
      refused: leads.filter((l) => l.state === "refused" && recent(l.lastContactAt, since)).length,
      escalated: leads.filter((l) => l.state === "escalated").length,
    },
    agencies: {
      written: agencies.filter((a) => a.state !== "new").length,
      replied: agencies.filter((a) => ["replied", "meeting", "partner"].includes(a.state)).length,
      meetings: meetings.filter((m) => m.agencyId && Date.parse(m.startsAt) >= now).length,
    },
    intel: {
      watchPosts: scan?.watchPosts || 0,
      watchContacts: investors.filter((i) => i.comment && recent(i.firstSeenAt, since)).length,
      groups: newSources.filter((s) => s.kind === "group" || s.kind === "channel"),
      platforms: newSources.filter((s) => s.kind === "platform" || s.kind === "portal" || s.kind === "registry"),
      agenciesNew: newAgencies.length,
      agenciesNewCity: Array.from(cityCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0],
    },
    pendingDrafts: drafts.filter((d) => d.state === "pending").length,
    meetingsTomorrow: meetings.filter((m) => isTomorrow(m.startsAt, new Date(now))).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    candidates: sources.filter((s) => s.state === "candidate").sort((a, b) => (b.members || 0) - (a.members || 0)).slice(0, 4),
  };
}

const link = (href: string, text: string) => '<a href="' + escapeHtml(href) + '">' + escapeHtml(text) + "</a>";

export function renderReport(data: ReportData): { html: string; keyboard: Keyboard } {
  const L: string[] = [];
  L.push("<b>ОТЧЁТ ЗА " + data.date + "</b>", "");

  L.push("🏠 <b>НЕДВИЖИМОСТЬ</b> — новых: " + data.objects.total);
  for (const p of data.objects.byPlace.slice(0, 6)) {
    L.push(escapeHtml(p.place) + ": " + p.count + " → " + link(dashboardUrl("?tab=objects&place=" + encodeURIComponent(p.place)), "список"));
    if (p.top) L.push("   ★ Топ: " + link(dashboardUrl("?tab=objects&id=" + p.top.id), p.top.title.slice(0, 60)) + ", " + formatMoney(p.top.price, p.top.currency) + (p.top.discountPct && p.top.discountPct > 0 ? " (−" + p.top.discountPct + "% к рынку)" : ""));
  }
  if (!data.objects.total) L.push("   новых объектов за сутки нет");
  L.push("");

  L.push("💼 <b>ИНВЕСТОРЫ</b> — новых: " + data.investors.total);
  L.push("Family offices: " + data.investors.familyOffices + " | Частные: " + data.investors.private + " | Фонды: " + data.investors.funds + (data.investors.companies ? " | Компании: " + data.investors.companies : ""));
  if (data.investors.topMatches.length) {
    L.push("★ Топ-" + data.investors.topMatches.length + " по совпадению с объектами:");
    for (const t of data.investors.topMatches) L.push("   " + link(dashboardUrl("?tab=matches&id=" + t.match.id), (t.investor?.name || "инвестор").slice(0, 40) + " ↔ " + (t.object?.title || "объект").slice(0, 40)) + " — " + t.match.score + "%");
  }
  L.push("");

  L.push("💬 <b>ДИАЛОГИ</b>");
  L.push("В работе: " + data.dialogs.inProgress);
  L.push("Квалифицировано и ждёт тебя: " + data.dialogs.qualified + (data.dialogs.qualified ? " ← <b>ТРЕБУЕТ ДЕЙСТВИЯ</b>" : ""));
  if (data.dialogs.escalated) L.push("Эскалация (деньги/спорное): " + data.dialogs.escalated + " ← <b>ТРЕБУЕТ ДЕЙСТВИЯ</b>");
  L.push("Отказов: " + data.dialogs.refused);
  if (data.pendingDrafts) L.push("Сообщений ждут одобрения: " + data.pendingDrafts + " → " + link(dashboardUrl("?tab=drafts"), "открыть") + " или /drafts");
  L.push("");

  L.push("🤝 <b>АГЕНТСТВА</b>");
  L.push("Написано: " + data.agencies.written + " | Ответили: " + data.agencies.replied + " | Встреч назначено: " + data.agencies.meetings, "");

  L.push("🔭 <b>РАЗВЕДКА</b> (новые источники)");
  L.push("Посты по watchlist: " + data.intel.watchPosts + " → из комментариев извлечено " + data.intel.watchContacts + " контактов");
  const g = data.intel.groups[0];
  L.push("Новые группы: " + data.intel.groups.length + (g ? " (" + link(g.url, g.name.slice(0, 50)) + (g.members ? ", " + g.members.toLocaleString("ru-RU") + " чел." : "") + ")" : ""));
  const pl = data.intel.platforms[0];
  L.push("Новые платформы: " + data.intel.platforms.length + (pl ? " (" + link(pl.url, pl.name.slice(0, 50)) + (pl.country ? ", " + escapeHtml(pl.country) : "") + (pl.hasApi ? " — есть API" : "") + ")" : ""));
  L.push("Новые агентства: " + data.intel.agenciesNew + (data.intel.agenciesNewCity ? " в " + escapeHtml(data.intel.agenciesNewCity) : ""));
  if (data.candidates.length) L.push("→ Одобрить / отклонить: кнопки ниже");
  L.push("");

  if (data.meetingsTomorrow.length) {
    L.push("📅 <b>ВСТРЕЧИ ЗАВТРА</b>");
    for (const m of data.meetingsTomorrow) L.push(formatLocal(m.startsAt) + " — " + escapeHtml(m.where) + ", " + escapeHtml(m.with));
  } else L.push("📅 Встреч завтра нет");
  L.push("", link(dashboardUrl(), "Открыть дашборд Разведчика"));

  const keyboard: Keyboard = data.candidates.map((s) => [
    { text: "✅ " + s.name.slice(0, 22), callback_data: "src:approve:" + s.id },
    { text: "✖️ Отклонить", callback_data: "src:reject:" + s.id },
  ]);
  if (data.pendingDrafts) keyboard.push([{ text: "✉️ Сообщения на одобрение (" + data.pendingDrafts + ")", callback_data: "drafts:list" }]);
  return { html: L.join("\n"), keyboard };
}

export async function sendDailyReport(actor: "cron" | "bot" | "human" = "cron") {
  const { reportChatId, sendLong } = await import("@/lib/scout/telegram");
  const data = await collectReport();
  const { html, keyboard } = renderReport(data);
  await setValue("report:" + new Date().toISOString().slice(0, 10), { data, html });
  const chatId = await reportChatId();
  if (!chatId) return { ok: false, error: "TELEGRAM_CHAT_ID не задан", html };
  const result = await sendLong(chatId, html, keyboard);
  await logAction({ actor, action: "report.send", detail: result.ok ? "→ " + result.chatId : "ошибка: " + result.error });
  return { ok: result.ok, error: result.error, chatId: result.chatId, html };
}
