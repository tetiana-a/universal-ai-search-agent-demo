import { after } from "next/server";
import { importComments } from "@/lib/scout/bot";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { googleCalendarLink, newMeeting, parseMeetingCommand } from "@/lib/scout/calendar";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/scout/config";
import { matchCountries, detectGoals, detectSegments, classifyInvestorKind } from "@/lib/scout/extract";
import { addToStopList, decideDraft, forgetContact, markSent } from "@/lib/scout/outreach";
import { advanceDialog, GREETING, questionFor } from "@/lib/scout/qualification";
import { sendDailyReport } from "@/lib/scout/report";
import { requestResearchStop } from "@/lib/scout/research-bot";
import { runScan } from "@/lib/scout/scan";
import { scoreInvestor } from "@/lib/scout/scoring";
import { addWatch, removeWatch, setSourceState } from "@/lib/scout/sources";
import { getOne, logAction, putMany, putOne } from "@/lib/scout/store";
import { asText, detectLang, nowIso, parseBudget, randomId, stableId } from "@/lib/scout/text";
import type { Collection } from "@/lib/scout/store";
import type { InvestorCard, Lang, Lead, ScoutSettings, WatchKind } from "@/lib/scout/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATE_COLLECTIONS: Partial<Record<string, Collection>> = { object: "objects", investor: "investors", agency: "agencies", match: "matches", lead: "leads" };
const LANGS = new Set(["ru", "en", "es", "uk"]);

function str(value: unknown, max = 2000) {
  return asText(value).trim().slice(0, max);
}

// Only known settings fields, with types checked, are saved.
function cleanSettings(input: any): Partial<ScoutSettings> {
  const out: Partial<ScoutSettings> = {};
  if (Array.isArray(input?.targets)) out.targets = input.targets.slice(0, 12).map((t: any) => ({ country: str(t.country, 60), city: str(t.city, 60) || undefined, types: (Array.isArray(t.types) ? t.types : []).map((x: unknown) => str(x, 20)).slice(0, 8), lang: LANGS.has(t.lang) ? t.lang : "en" })).filter((t: any) => t.country);
  for (const key of ["priceMin", "priceMax", "areaMin", "minYieldPct", "minDiscountPct", "reminderDays", "maxReminders", "reportHourUtc"] as const) if (input?.[key] !== undefined && Number.isFinite(Number(input[key]))) (out as any)[key] = Number(input[key]);
  for (const key of ["companyName", "senderName"] as const) if (typeof input?.[key] === "string") out[key] = str(input[key], 120);
  if (input?.marketPricePerM2 && typeof input.marketPricePerM2 === "object") out.marketPricePerM2 = Object.fromEntries(Object.entries(input.marketPricePerM2).filter(([, v]) => Number(v) > 0).slice(0, 50).map(([k, v]) => [str(k, 60), Number(v)]));
  if (input?.dailyLimits && typeof input.dailyLimits === "object") out.dailyLimits = { ...DEFAULT_SETTINGS.dailyLimits, ...Object.fromEntries(Object.entries(input.dailyLimits).filter(([k, v]) => k in DEFAULT_SETTINGS.dailyLimits && Number(v) >= 0).map(([k, v]) => [k, Number(v)])) };
  if (Array.isArray(input?.monitorKeywords)) out.monitorKeywords = input.monitorKeywords.map((k: unknown) => str(k, 100)).filter(Boolean).slice(0, 40);
  if (input?.templates && typeof input.templates === "object") out.templates = Object.fromEntries(Object.entries(input.templates).slice(0, 20).map(([id, langs]: [string, any]) => [str(id, 40), Object.fromEntries(["ru", "en", "es", "uk"].map((l) => [l, str(langs?.[l], 1500)]))])) as any;
  if (input?.unsubscribeText && typeof input.unsubscribeText === "object") out.unsubscribeText = Object.fromEntries(["ru", "en", "es", "uk"].map((l) => [l, str(input.unsubscribeText[l], 300)])) as any;
  return out;
}

// CSV rows from an official export (LinkedIn, event attendee lists): name, company, role, country, contact, interest.
function investorsFromRows(rows: any[], source: string, settings: ScoutSettings): InvestorCard[] {
  return rows.slice(0, 500).map((row) => {
    const name = str(row.name || row.Name || [row["First Name"], row["Last Name"]].filter(Boolean).join(" "), 120);
    if (!name) return null;
    const company = str(row.company || row.Company, 120) || undefined;
    const interestText = str(row.interest || row.Interest || row.notes || "", 500) + " " + str(row.country || row.Country || "", 60);
    const budget = parseBudget(interestText);
    const now = nowIso();
    return scoreInvestor({
      id: stableId("inv", name.toLowerCase() + "|" + (company || "")),
      name, company, role: str(row.role || row.Position || row.title, 120) || undefined,
      kind: classifyInvestorKind((company || "") + " " + interestText), country: str(row.country || row.Country, 60) || undefined,
      channel: str(row.contact || row.email || row["Email Address"] || row.url || row.URL, 200) || undefined,
      interest: { segments: detectSegments(interestText), budgetMin: budget?.min, budgetMax: budget?.max, currency: budget?.currency, geography: matchCountries(interestText), goals: detectGoals(interestText) },
      source, score: 0, checklist: {}, firstSeenAt: now, lastSeenAt: now, state: "new",
    }, settings);
  }).filter(Boolean) as InvestorCard[];
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const body: any = await request.json().catch(() => ({}));
  const action = str(body.action, 40);
  const by = "dashboard";

  switch (action) {
    case "scan": {
      // Runs after the response so the dashboard is not blocked; the result lands in the log.
      after(async () => { await runScan({ actor: "human", deadlineAt: Date.now() + 50_000 }); });
      return Response.json({ ok: true, message: "Обход запущен. Обновите страницу через минуту." });
    }
    case "report.send":
      return Response.json(await sendDailyReport("human"));
    case "research.cancel": {
      const result = await requestResearchStop(str(body.chatId, 80), "human");
      return Response.json(result, { status: result.ok ? 200 : 404 });
    }
    case "source.state": {
      const state = str(body.state, 20) as any;
      if (!["approved", "rejected", "disabled", "candidate"].includes(state)) return Response.json({ ok: false, error: "bad state" }, { status: 400 });
      return Response.json({ ok: true, source: await setSourceState(str(body.id, 80), state, by) });
    }
    case "draft.decide": {
      const decision = str(body.decision, 10) as "approve" | "reject" | "edit";
      if (!["approve", "reject", "edit"].includes(decision)) return Response.json({ ok: false, error: "bad decision" }, { status: 400 });
      return Response.json(await decideDraft(str(body.id, 80), decision, by, str(body.text, 1500)));
    }
    case "draft.sent":
      return Response.json({ ok: true, draft: await markSent(str(body.id, 80), by) });
    case "watch.add": {
      const kind = str(body.kind, 10) as WatchKind;
      if (!["person", "group", "keyword", "domain"].includes(kind)) return Response.json({ ok: false, error: "bad kind" }, { status: 400 });
      return Response.json({ ok: true, item: await addWatch(kind, str(body.value, 200), str(body.note, 200) || undefined) });
    }
    case "watch.remove":
      await removeWatch(str(body.id, 80));
      return Response.json({ ok: true });
    case "settings.save":
      return Response.json({ ok: true, settings: await saveSettings(cleanSettings(body.settings)) });
    case "stop.add":
      await addToStopList(str(body.contact, 200), "manual (dashboard)");
      return Response.json({ ok: true });
    case "forget":
      return Response.json({ ok: true, removed: await forgetContact(str(body.contact, 200)) });
    case "comments.import":
      return Response.json({ ok: true, message: await importComments(str(body.postUrl, 500) + "\n" + str(body.comments, 20000), by) });
    case "meeting.create": {
      const parsed = parseMeetingCommand(str(body.text, 300));
      if (!parsed) return Response.json({ ok: false, error: "Формат: 18.10 11:00 Zoom — Engel & Völkers" }, { status: 400 });
      const meeting = newMeeting(parsed);
      await putOne("meetings", meeting);
      await logAction({ actor: "human", action: "meeting.create", detail: meeting.title });
      return Response.json({ ok: true, meeting, google: googleCalendarLink(meeting) });
    }
    case "lead.create": {
      const type = body.type === "object" ? "object" : "investor";
      const lang = (LANGS.has(body.lang) ? body.lang : "ru") as Lang;
      const now = nowIso();
      const first = questionFor(type === "investor" ? "budget" : "price", lang);
      const lead: Lead = { id: randomId("lead"), type, refId: str(body.refId, 80) || undefined, name: str(body.name, 120) || "Контакт", contact: str(body.contact, 200) || undefined, lang, answers: {}, transcript: [{ from: "agent", text: (type === "investor" ? GREETING[lang] + "\n\n" : "") + first, at: now }], state: "in_progress", lastContactAt: now, remindersSent: 0, createdAt: now };
      await putOne("leads", lead);
      return Response.json({ ok: true, lead });
    }
    case "lead.reply": {
      // A reply received in another channel (email, WhatsApp) is pasted here; the agent fills the checklist and proposes the next question.
      const lead = await getOne<Lead>("leads", str(body.id, 80));
      if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
      const text = str(body.text, 3000);
      const outcome = advanceDialog({ ...lead, lang: lead.transcript.some((m) => m.from === "contact") ? lead.lang : detectLang(text, lead.lang), state: "in_progress" }, text);
      await putOne("leads", outcome.lead);
      if (outcome.event === "refused" && lead.contact) await addToStopList(lead.contact, "refused in dialogue");
      return Response.json({ ok: true, lead: outcome.lead, reply: outcome.reply, event: outcome.event });
    }
    case "card.state": {
      const collection = STATE_COLLECTIONS[str(body.type, 20)];
      if (!collection) return Response.json({ ok: false, error: "bad type" }, { status: 400 });
      const item = await getOne<any>(collection, str(body.id, 80));
      if (!item) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      const updated = { ...item, state: str(body.state, 20) };
      await putOne(collection, updated);
      await logAction({ actor: "human", action: collection + ".state", detail: (item.name || item.title || item.id) + " → " + updated.state });
      return Response.json({ ok: true, item: updated });
    }
    case "investors.import": {
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const cards = investorsFromRows(rows, str(body.source, 80) || "импорт CSV", await loadSettings());
      await putMany("investors", cards);
      await logAction({ actor: "human", action: "investors.import", detail: cards.length + " rows" });
      return Response.json({ ok: true, imported: cards.length });
    }
    default:
      return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
