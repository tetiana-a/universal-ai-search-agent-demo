import { answerCampaign, capacity, capacityText, cleanKeywords, createCampaign, digestText, dispatchBotTasks, findForCampaign, listCampaigns, monitorCampaign, notifyPartners, planDay, setCampaignStatus, submitProof, transcribeTelegramVoice, updateCampaign, verifyProof, type Campaign } from "@/lib/scout/campaigns";
import { dashboardUrl } from "@/lib/scout/config";
import { groupsXlsx, PLATFORM_LABEL } from "@/lib/scout/groups";
import { deleteValue, getOne, getValue, removeMany, setValue } from "@/lib/scout/store";
import { answerCallback, editMessage, sendDocument, sendLong, sendMessage, type Keyboard } from "@/lib/scout/telegram";
import { escapeHtml } from "@/lib/scout/text";

// Telegram control for campaigns (TZ 1.2):
//   voice or /campaign <task> → AI task + clarifying questions + 40 keywords for approval
//   ✅ keywords → search of core and adjacent communities → ▶️ start placement (daily, toward the target)
//   /campaigns · /keywords <id> … · /cq <id> query · /cx <id> exclusion · /cstop <id|all> · /capacity · /monitor <id> · /creport
//   /proof <task> <link> — from partners (admins who agreed to publish by hand)

type Result = { background?: () => Promise<void> };
export const CAMPAIGN_COMMANDS = ["campaign", "campaigns", "keywords", "cq", "cx", "cstop", "capacity", "monitor", "creport"];

function pageUrl() {
  return dashboardUrl().replace(/\/scout$/, "/groups");
}

const STATUS: Record<Campaign["status"], string> = { draft: "черновик", searching: "ищу сообщества", ready: "сообщества найдены", approved: "размещение идёт", stopped: "остановлена" };

export function campaignCard(c: Campaign) {
  const kw = c.keywords.map((k, i) => (i + 1) + ". " + escapeHtml(k)).join("\n");
  return "<b>Кампания</b> <code>" + c.id + "</code> · " + STATUS[c.status] +
    "\n<b>" + escapeHtml(c.title) + "</b>" +
    "\nТема: " + escapeHtml(c.topic || "—") + " · Регион: " + escapeHtml(c.region || "—") +
    "\nЯзыки: " + escapeHtml(c.languages.join(", ") || "—") + " · Площадки: " + c.platforms.map((p) => PLATFORM_LABEL[p]).join(", ") +
    "\nЦель: " + c.dailyTarget + " размещений в день" +
    "\n\n<b>Текст объявления</b>\n" + escapeHtml(c.adText.slice(0, 900)) +
    (Object.keys(c.translations || {}).length ? "\n<i>Переводы: " + Object.keys(c.translations).join(", ") + "</i>" : "") +
    (c.questions.length ? "\n\n❓ <b>Уточните, пожалуйста</b> (ответьте одним сообщением):\n" + c.questions.map((q) => "• " + escapeHtml(q)).join("\n") : "") +
    "\n\n<b>Ключевые слова (" + c.keywords.length + ")</b>\n" + kw +
    (c.adjacent.length ? "\n\n<b>Смежные сообщества</b>: " + escapeHtml(c.adjacent.join(", ")) : "") +
    (c.queries.length ? "\n<b>Свои запросы</b>: " + escapeHtml(c.queries.join(", ")) : "") +
    (c.exclusions.length ? "\n<b>Исключения</b>: " + escapeHtml(c.exclusions.join(", ")) : "") +
    "\n\nПравка: <code>/keywords " + c.id + " +слово -слово</code> · свой запрос <code>/cq " + c.id + " текст</code> · исключить <code>/cx " + c.id + " слово</code>";
}

function draftKeyboard(c: Campaign): Keyboard {
  return [
    [{ text: "✅ Слова верны — искать сообщества", callback_data: "cp:search:" + c.id }],
    [{ text: "✖️ Удалить черновик", callback_data: "cp:del:" + c.id }],
  ];
}

function runningKeyboard(c: Campaign): Keyboard {
  return [
    c.status === "approved" ? [{ text: "⏹ Остановить", callback_data: "cp:stop:" + c.id }] : [{ text: "▶️ Запустить размещение", callback_data: "cp:start:" + c.id }],
    [{ text: "📡 Мониторинг", callback_data: "cp:mon:" + c.id }, { text: "🔎 Искать ещё", callback_data: "cp:search:" + c.id }],
  ];
}

async function showDraft(chatId: string, c: Campaign) {
  if (c.questions.length) await setValue("cmp-answer:" + chatId, c.id, 24 * 3600);
  await sendLong(chatId, campaignCard(c), c.status === "draft" ? draftKeyboard(c) : runningKeyboard(c));
}

export async function startCampaignFromText(chatId: string, text: string, ownerId: string, source: Campaign["source"], photo?: string): Promise<Result> {
  if (text.trim().length < 10) { await sendMessage(chatId, "Опишите задачу: что рекламируем, где (город/страна), на каких площадках, текст объявления."); return {}; }
  await sendMessage(chatId, "🧠 Разбираю задачу и готовлю ключевые слова…");
  return { background: async () => { const { campaign } = await createCampaign(text, source, ownerId, photo); await showDraft(chatId, campaign); } };
}

// A voice message from the owner: speech → text → campaign draft.
export async function handleVoice(chatId: string, fileId: string, ownerId: string): Promise<Result> {
  await sendMessage(chatId, "🎙 Распознаю голосовое…");
  return {
    background: async () => {
      const voice = await transcribeTelegramVoice(fileId);
      if (!voice.ok) { await sendMessage(chatId, "⚠️ " + escapeHtml(voice.message)); return; }
      await sendMessage(chatId, "📝 <i>" + escapeHtml(voice.text.slice(0, 1500)) + "</i>");
      const pending = await getValue<string>("cmp-answer:" + chatId);
      if (pending) { await deleteValue("cmp-answer:" + chatId); const c = await answerCampaign(pending, voice.text); if (c) { await showDraft(chatId, c); return; } }
      const { campaign } = await createCampaign(voice.text, "voice", ownerId);
      await showDraft(chatId, campaign);
    },
  };
}

// A plain text message right after clarifying questions is the answer to them.
export async function maybeAnswer(chatId: string, text: string): Promise<Result | null> {
  const pending = await getValue<string>("cmp-answer:" + chatId);
  if (!pending || text.startsWith("/")) return null;
  await deleteValue("cmp-answer:" + chatId);
  await sendMessage(chatId, "🧠 Дополняю задачу…");
  return { background: async () => { const c = await answerCampaign(pending, text); if (c) await showDraft(chatId, c); } };
}

export function editKeywords(current: string[], args: string) {
  const tokens = args.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
  if (tokens.every((t) => /^[+-]/.test(t))) {
    let out = [...current];
    for (const t of tokens) {
      const word = t.slice(1).trim();
      if (t.startsWith("+")) out.push(word);
      else out = out.filter((k) => k.toLowerCase() !== word.toLowerCase() && String(out.indexOf(k) + 1) !== word);
    }
    return cleanKeywords(out, 40);
  }
  return cleanKeywords(tokens, 40);
}

async function runSearch(chatId: string, id: string) {
  const result = await findForCampaign(id);
  if (!result) return;
  const f = result.campaign.found!;
  const top = result.groups.sort((a, b) => Number(a.relevance === "adjacent") - Number(b.relevance === "adjacent") || (b.members || 0) - (a.members || 0)).slice(0, 15)
    .map((g, i) => (i + 1) + ". " + (g.relevance === "adjacent" ? "🟡 " : "🟢 ") + "<a href=\"" + escapeHtml(g.url) + "\">" + escapeHtml(g.name.slice(0, 50)) + "</a>" + (g.members ? " · " + g.members.toLocaleString("ru-RU") : "") + (g.activity === "inactive" ? " · 💤 неактивна" : "") + "\n   <i>запрос: " + escapeHtml(g.foundBy || "") + "</i>");
  await sendLong(chatId, "<b>Сообщества для «" + escapeHtml(result.campaign.title) + "»</b>\nЗапросов: " + result.queries + " · найдено " + f.total + " (🟢 профильных " + f.core + ", 🟡 смежных " + f.adjacent + ", 💤 неактивных " + f.inactive + " — исключены из размещения)" +
    (result.notes.length ? "\n⚠️ " + escapeHtml(result.notes.slice(0, 2).join(" ")) : "") + (top.length ? "\n\n" + top.join("\n") : ""), runningKeyboard(result.campaign));
  if (result.groups.length) await sendDocument(chatId, "communities-" + id + ".xlsx", await groupsXlsx(result.groups), "База сообществ (Excel)");
}

async function startPlacement(chatId: string, id: string) {
  const c = await setCampaignStatus(id, "approved");
  if (!c) return;
  const plan = await planDay();
  const partners = await notifyPartners();
  await sendMessage(chatId, "▶️ <b>Размещение запущено</b>: " + escapeHtml(c.title) + "\nНа сегодня: " + plan.created + " (бот " + plan.byMode.bot + ", партнёры " + plan.byMode.partner + ", вручную " + plan.byMode.manual + "). Партнёрам отправлено заданий: " + partners.notified +
    "\nДальше — каждый день автоматически, отчёт вечером. Ручная очередь: /queue. Остановить всё: <code>/cstop " + c.id + "</code>", [[{ text: "📈 Ёмкость", callback_data: "cp:cap:x" }]]);
  const bot = await dispatchBotTasks(undefined, Date.now() + 230_000);
  await sendMessage(chatId, "📣 Бот опубликовал: " + bot.sent + ", ошибок: " + bot.failed + (bot.left ? ", перенесено на следующий запуск: " + bot.left : "") + (bot.disabled ? " (автопостинг выключен настройкой CAMPAIGN_AUTOPOST=off или нет токена)" : ""));
}

async function runMonitor(chatId: string, id: string) {
  const r = await monitorCampaign(id);
  const top = r.top.map((m, i) => (i + 1) + ". <a href=\"" + escapeHtml(m.url) + "\">" + escapeHtml((m.title || m.url).slice(0, 80)) + "</a>" + (m.author ? " — " + escapeHtml(m.author) : "") + (m.views ? " · 👁 " + m.views.toLocaleString("ru-RU") : ""));
  await sendLong(chatId, "📡 <b>Мониторинг</b>\n" + escapeHtml(r.message) + (top.length ? "\n\n<b>Самые просматриваемые</b>\n" + top.join("\n") : ""));
}

export async function handleCampaignCommand(chatId: string, userId: string, cmd: string, args: string, photo?: string): Promise<Result> {
  const [first, ...rest] = args.split(/\s+/);
  const byId = async () => getOne<Campaign>("campaigns", first || "");
  switch (cmd) {
    case "campaign":
      if (!args.trim()) { await sendMessage(chatId, "Отправьте голосовое или напишите задачу после команды:\n<code>/campaign Продаю квартиру в Валенсии, 2 спальни, 240 000 €. Разместить в Telegram и Facebook, 300 в день. Текст: …</code>"); return {}; }
      return startCampaignFromText(chatId, args, userId, "text", photo);
    case "campaigns": {
      const list = await listCampaigns();
      if (!list.length) { await sendMessage(chatId, "Кампаний пока нет. Отправьте голосовое с задачей или /campaign текст."); return {}; }
      for (const c of list.slice(0, 6)) await sendMessage(chatId, "<code>" + c.id + "</code> · <b>" + escapeHtml(c.title) + "</b>\n" + STATUS[c.status] + " · цель " + c.dailyTarget + "/день" + (c.found ? " · сообществ " + c.found.total : ""), c.status === "draft" ? draftKeyboard(c) : runningKeyboard(c));
      return {};
    }
    case "keywords": case "cq": case "cx": {
      const c = await byId();
      if (!c) { await sendMessage(chatId, "Укажите id кампании: <code>/" + cmd + " cmp_xxxx …</code> (список — /campaigns)"); return {}; }
      const value = rest.join(" ");
      const next = cmd === "keywords" ? await updateCampaign(c.id, { keywords: editKeywords(c.keywords, value) })
        : cmd === "cq" ? await updateCampaign(c.id, { queries: [...c.queries, ...value.split(/[,;\n]/)] })
          : await updateCampaign(c.id, { exclusions: [...c.exclusions, ...value.split(/[,;\n]/)] });
      if (next) await showDraft(chatId, next);
      return {};
    }
    case "cstop": {
      const list = first === "all" ? (await listCampaigns()).filter((c) => c.status !== "stopped") : [await byId()].filter(Boolean) as Campaign[];
      if (!list.length) { await sendMessage(chatId, "Формат: <code>/cstop cmp_xxxx</code> или <code>/cstop all</code>"); return {}; }
      for (const c of list) await setCampaignStatus(c.id, "stopped");
      await sendMessage(chatId, "⏹ Остановлено кампаний: " + list.length + ". Неопубликованные задания отменены, партнёры предупреждены.");
      return {};
    }
    case "capacity":
      await sendMessage(chatId, capacityText(await capacity()), [[{ text: "🖥 Кампании и база", url: pageUrl() }]]);
      return {};
    case "creport":
      await sendLong(chatId, await digestText());
      return {};
    case "monitor": {
      const c = await byId();
      if (!c) { await sendMessage(chatId, "Формат: <code>/monitor cmp_xxxx</code>"); return {}; }
      await sendMessage(chatId, "📡 Ищу публикации по кампании… 1–3 минуты.");
      return { background: () => runMonitor(chatId, c.id) };
    }
  }
  return {};
}

// /proof works for partners too (they are not owners of the bot).
export async function handleProof(chatId: string, userId: string, args: string) {
  const [taskId, url] = args.split(/\s+/);
  if (!taskId || !url) { await sendMessage(chatId, "Формат: <code>/proof ct_xxxx https://ссылка-на-пост</code>"); return; }
  const r = await submitProof(taskId, userId, url);
  await sendMessage(chatId, (r.ok ? "✅ " : "⚠️ ") + escapeHtml(r.message));
}

export async function handleCampaignCallback(query: any, action: string, id: string, by: string): Promise<Result> {
  const chatId = String(query.message?.chat?.id || "");
  const messageId = Number(query.message?.message_id || 0);
  switch (action) {
    case "search":
      await answerCallback(query.id, "Ищу сообщества…");
      await sendMessage(chatId, "🔎 Ищу профильные и смежные сообщества по всему списку слов. Это 3–5 минут, результат придёт сюда.");
      return { background: () => runSearch(chatId, id) };
    case "start":
      await answerCallback(query.id, "Запускаю");
      return { background: () => startPlacement(chatId, id) };
    case "stop": {
      const c = await setCampaignStatus(id, "stopped", by);
      await answerCallback(query.id, c ? "Остановлено" : "Не найдено");
      if (c && messageId) await editMessage(chatId, messageId, "⏹ Кампания остановлена: " + escapeHtml(c.title));
      return {};
    }
    case "del":
      await removeMany("campaigns", [id]);
      await answerCallback(query.id, "Удалено");
      if (messageId) await editMessage(chatId, messageId, "✖️ Черновик удалён.");
      return {};
    case "mon":
      await answerCallback(query.id, "Мониторинг…");
      return { background: () => runMonitor(chatId, id) };
    case "cap":
      await answerCallback(query.id, "✓");
      await sendMessage(chatId, capacityText(await capacity()));
      return {};
    case "ok": case "no": {
      const t = await verifyProof(id, action === "ok", by);
      await answerCallback(query.id, t ? (action === "ok" ? "Засчитано" : "Не засчитано") : "Уже обработано");
      if (t && messageId) await editMessage(chatId, messageId, (action === "ok" ? "✅ Засчитано: " : "✖️ Не засчитано: ") + escapeHtml(t.groupName) + "\n" + escapeHtml(t.link || ""));
      return {};
    }
  }
  return {};
}

