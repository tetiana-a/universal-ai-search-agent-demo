import { botHandle, loadSettings } from "@/lib/scout/config";
import { CITY_ALIASES } from "@/lib/scout/extract";
import { getOne, increment, listAll, logAction, putOne, readCounter, removeMany } from "@/lib/scout/store";
import { nowIso, randomId, stableId } from "@/lib/scout/text";
import type { Draft, DraftChannel, Lang, ScoutSettings, StopEntry } from "@/lib/scout/types";

// First-contact rules (spec 4, mandatory): approved templates only, a stop-list
// that is never written to again, per-channel daily limits, and a human presses
// "Отправить" before anything goes out. The agent never DMs strangers by itself.

export function stopKey(contact: string) {
  const c = String(contact || "").trim().toLowerCase().replace(/^mailto:/, "").replace(/^https?:\/\/(www\.)?/, "").replace(/[\s()-]/g, "");
  return stableId("stop", c);
}

export async function isStopped(contact?: string) {
  if (!contact) return false;
  return Boolean(await getOne<StopEntry & { id: string }>("stoplist", stopKey(contact)));
}

// Only a hash of the contact is kept: we must remember not to write, not who it was.
export async function addToStopList(contact: string, reason: string) {
  const key = stopKey(contact);
  await putOne("stoplist", { id: key, key, reason, at: nowIso() });
  await logAction({ actor: "agent", action: "stoplist.add", detail: reason });
}

export function renderTemplate(template: string, vars: Record<string, string | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

// City names are stored in Russian; English and Spanish messages use the local spelling.
export function cityFor(city: string | undefined, lang: Lang) {
  if (!city || lang === "ru" || lang === "uk") return city || "";
  const latin = CITY_ALIASES[city]?.[0];
  return latin ? latin.charAt(0).toUpperCase() + latin.slice(1) : city;
}

export function buildFirstMessage(settings: ScoutSettings, templateId: string, lang: Lang, vars: Record<string, string | undefined>) {
  const template = settings.templates[templateId]?.[lang] || settings.templates[templateId]?.en || "";
  return renderTemplate(template, {
    company: settings.companyName,
    sender: settings.senderName,
    unsubscribe: settings.unsubscribeText[lang],
    bot: botHandle(),
    ...vars,
    city: cityFor(vars.city, lang),
  });
}

// A valid first touch must say who we are, where the contact is from, why, and how to opt out.
export function firstContactProblems(text: string, settings: ScoutSettings, lang: Lang, channel: DraftChannel) {
  const problems: string[] = [];
  if (!text.includes(settings.companyName)) problems.push("нет названия компании");
  if (channel !== "public_reply" && !text.includes(settings.unsubscribeText[lang].slice(0, 20))) problems.push("нет строки об отписке");
  if (text.length > 1500) problems.push("слишком длинное сообщение");
  return problems;
}

function dayKey(channel: DraftChannel) {
  return "sent:" + channel + ":" + new Date().toISOString().slice(0, 10);
}

export async function remainingToday(channel: DraftChannel) {
  const settings = await loadSettings();
  return Math.max(0, settings.dailyLimits[channel] - (await readCounter(dayKey(channel))));
}

export async function createDraft(input: Omit<Draft, "id" | "state" | "createdAt">): Promise<Draft | null> {
  if (await isStopped(input.target.contact)) return null;
  const existing = (await listAll<Draft>("drafts")).find((d) => d.target.id === input.target.id && d.kind === input.kind && d.state === "pending");
  if (existing) return existing;
  const draft: Draft = { ...input, id: randomId("d"), state: "pending", createdAt: nowIso() };
  await putOne("drafts", draft);
  await logAction({ actor: "agent", action: "draft.create", detail: input.kind + " → " + input.target.name });
  return draft;
}

// A one-tap link that opens the message ready to send in the human's own app.
export function sendLink(draft: Draft) {
  const contact = draft.target.contact || "";
  const text = encodeURIComponent(draft.text);
  if (draft.channel === "email" && /@/.test(contact)) return "mailto:" + contact.replace(/^mailto:/, "") + "?subject=" + encodeURIComponent(draft.kind === "partnership" ? "Partnership" : "Real estate") + "&body=" + text;
  if (draft.channel === "whatsapp") return "https://wa.me/" + contact.replace(/\D/g, "") + "?text=" + text;
  if (draft.channel === "telegram" && /^@?\w{5,}$/.test(contact)) return "https://t.me/" + contact.replace(/^@/, "");
  if (/^https?:\/\//.test(contact)) return contact;
  return "";
}

export type DecisionResult = { ok: boolean; draft?: Draft; message: string; link?: string };

export async function decideDraft(id: string, decision: "approve" | "reject" | "edit", by: string, newText?: string): Promise<DecisionResult> {
  const draft = await getOne<Draft>("drafts", id);
  if (!draft) return { ok: false, message: "Черновик не найден" };
  if (draft.state !== "pending") return { ok: false, draft, message: "Черновик уже обработан: " + draft.state };

  if (decision === "edit") {
    if (!newText?.trim()) return { ok: false, draft, message: "Пустой текст" };
    const updated = { ...draft, text: newText.trim() };
    await putOne("drafts", updated);
    await logAction({ actor: "human", action: "draft.edit", detail: by + ": " + draft.target.name });
    return { ok: true, draft: updated, message: "Текст обновлён" };
  }

  if (decision === "reject") {
    const updated: Draft = { ...draft, state: "rejected", decidedAt: nowIso(), decidedBy: by };
    await putOne("drafts", updated);
    await logAction({ actor: "human", action: "draft.reject", detail: by + ": " + draft.target.name });
    return { ok: true, draft: updated, message: "Отклонено" };
  }

  if (await isStopped(draft.target.contact)) {
    await putOne("drafts", { ...draft, state: "rejected", decidedAt: nowIso(), decidedBy: "stoplist" });
    return { ok: false, draft, message: "Контакт в стоп-листе — отправка запрещена" };
  }
  const settings = await loadSettings();
  const limit = settings.dailyLimits[draft.channel];
  const used = await increment(dayKey(draft.channel), 60 * 60 * 26);
  if (used > limit) return { ok: false, draft, message: "Дневной лимит для канала «" + draft.channel + "» исчерпан (" + limit + "). Попробуйте завтра." };

  const updated: Draft = { ...draft, state: "approved", decidedAt: nowIso(), decidedBy: by };
  await putOne("drafts", updated);
  await logAction({ actor: "human", action: "draft.approve", detail: by + ": " + draft.target.name + " via " + draft.channel });
  return { ok: true, draft: updated, link: sendLink(updated), message: "Одобрено. Откройте ссылку и отправьте сообщение." };
}

export async function markSent(id: string, by: string) {
  const draft = await getOne<Draft>("drafts", id);
  if (!draft) return null;
  const updated: Draft = { ...draft, state: "sent", decidedAt: nowIso(), decidedBy: by };
  await putOne("drafts", updated);
  await logAction({ actor: "human", action: "draft.sent", detail: draft.target.name });
  return updated;
}

// GDPR: right to erasure. Removes every card that carries the contact and stop-lists it.
export async function forgetContact(contact: string) {
  const needle = contact.trim().toLowerCase();
  let removed = 0;
  for (const collection of ["investors", "agencies", "leads", "drafts"] as const) {
    const items = await listAll<any>(collection);
    const ids = items.filter((item) => JSON.stringify(item).toLowerCase().includes(needle)).map((item) => item.id);
    removed += ids.length;
    await removeMany(collection, ids);
  }
  await addToStopList(contact, "GDPR erasure request");
  await logAction({ actor: "human", action: "gdpr.forget", detail: removed + " records" });
  return removed;
}
