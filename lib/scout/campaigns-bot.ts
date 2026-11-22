import { answerCampaign, capacity, capacityText, cleanKeywords, createCampaign, digestText, dispatchBotTasks, findForCampaign, listCampaigns, monitorCampaign, notifyPartners, planDay, setCampaignStatus, submitProof, today, transcribeTelegramVoice, updateCampaign, verifyProof, type Campaign, type CampaignTask } from "@/lib/scout/campaigns";
import { dashboardUrl } from "@/lib/scout/config";
import { addGroupManually, groupsXlsx, PLATFORM_LABEL, platformOfUrl, updateGroup, type GroupCard } from "@/lib/scout/groups";
import { botHandle } from "@/lib/scout/config";
import { controlIds, reportChatId } from "@/lib/scout/telegram";
import { deleteValue, getOne, getValue, listAll, removeMany, setValue } from "@/lib/scout/store";
import { answerCallback, editMessage, sendDocument, sendLong, sendMessage, type Keyboard } from "@/lib/scout/telegram";
import { escapeHtml, stableId } from "@/lib/scout/text";
import { isPolishWineCampaign, POLISH_WINE_NOTICE } from "@/lib/scout/wine-compliance";

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
const STATUS_ICON: Record<Campaign["status"], string> = { draft: "📝", searching: "🔎", ready: "🟡", approved: "🟢", stopped: "⏹" };
const LINE = "━━━━━━━━━━━━━━";

function bar(done: number, target: number) {
  const n = target > 0 ? Math.min(10, Math.round((done / target) * 10)) : 0;
  return "▰".repeat(n) + "▱".repeat(10 - n);
}

// Today's placements per campaign: several campaigns run in parallel, each with its own progress.
export async function campaignBoard() {
  const [list, tasks] = await Promise.all([listCampaigns(), listAll<CampaignTask>("campaign_tasks")]);
  const day = today();
  const done = new Map<string, number>();
  for (const t of tasks) if (t.day === day && (t.status === "sent" || t.status === "verified")) done.set(t.campaignId, (done.get(t.campaignId) || 0) + 1);
  const active = list.filter((c) => c.status !== "stopped");
  const placed = active.reduce((n, c) => n + (done.get(c.id) || 0), 0);
  const target = active.filter((c) => c.status === "approved").reduce((n, c) => n + c.dailyTarget, 0);
  return { list, active, done, placed, target };
}

export async function campaignSummary() {
  const b = await campaignBoard();
  if (!b.list.length) return "📢 Кампаний пока нет. Отправьте голосовое с задачей.";
  return "📢 Кампаний в работе: <b>" + b.active.length + "</b>" + (b.target ? "\n📈 Сегодня размещено: <b>" + b.placed + " / " + b.target + "</b>\n" + bar(b.placed, b.target) : "");
}

export function campaignCard(c: Campaign) {
  return STATUS_ICON[c.status] + " <b>" + escapeHtml(c.title) + "</b>\n<i>" + STATUS[c.status] + " · <code>" + c.id + "</code></i>\n" + LINE +
    "\n🎯 <b>Тема:</b> " + escapeHtml(c.topic || "—") +
    "\n📍 <b>Регион:</b> " + escapeHtml(c.region || "—") +
    "\n🌐 <b>Языки:</b> " + escapeHtml(c.languages.join(", ") || "—") +
    "\n📱 <b>Площадки:</b> " + c.platforms.map((p) => PLATFORM_LABEL[p]).join(", ") +
    "\n📈 <b>Цель:</b> " + c.dailyTarget + " размещений в день" +
    (c.found ? "\n👥 <b>Найдено:</b> " + c.found.total + " (профильных " + c.found.core + ", смежных " + c.found.adjacent + ", неактивных " + c.found.inactive + ")" : "") +
    "\n\n📝 <b>Объявление</b>\n<blockquote>" + escapeHtml(c.adText.slice(0, 900)) + "</blockquote>" +
    (Object.keys(c.translations || {}).length ? "<i>Переводы: " + Object.keys(c.translations).join(", ") + "</i>\n" : "") +
    (c.questions.length ? "\n❓ <b>Уточните, пожалуйста</b> (одним сообщением)\n" + c.questions.map((q) => "• " + escapeHtml(q)).join("\n") + "\n" : "") +
    "\n🔑 <b>Ключевые слова · " + c.keywords.length + "</b>\n<blockquote expandable>" + escapeHtml(c.keywords.join(" · ")) + "</blockquote>" +
    (c.adjacent.length ? "🧭 <b>Смежные сообщества:</b> " + escapeHtml(c.adjacent.join(", ")) + "\n" : "") +
    (c.queries.length ? "➕ <b>Свои запросы:</b> " + escapeHtml(c.queries.join(", ")) + "\n" : "") +
    (c.exclusions.length ? "🚫 <b>Исключения:</b> " + escapeHtml(c.exclusions.join(", ")) + "\n" : "") +
    (isPolishWineCampaign(c) ? "\n" + escapeHtml(POLISH_WINE_NOTICE) + "\n" : "") +
    "\n<i>Правка слов:</i> <code>/keywords " + c.id + " +слово -слово</code>";
}

function draftKeyboard(c: Campaign): Keyboard {
  return [
    [{ text: isPolishWineCampaign(c) ? "🔎 Поиск B2B-сообществ (без публикации)" : "✅ Слова верны — искать сообщества", callback_data: "cp:search:" + c.id }],
    [{ text: "✖️ Удалить черновик", callback_data: "cp:del:" + c.id }, { text: "🗂 Все кампании", callback_data: "menu:campaigns" }],
  ];
}

function runningKeyboard(c: Campaign): Keyboard {
  const search = [{ text: "📡 Мониторинг", callback_data: "cp:mon:" + c.id }, { text: "🔎 Искать ещё", callback_data: "cp:search:" + c.id }];
  const nav = [{ text: "📊 Ёмкость", callback_data: "cp:cap:" + c.id }, { text: "🗂 Все кампании", callback_data: "menu:campaigns" }];
  if (isPolishWineCampaign(c)) return [search, nav];
  if (c.status !== "approved" && (!c.found || c.found.total === 0)) return [search, nav];
  return [
    c.status === "approved" ? [{ text: "⏹ Остановить", callback_data: "cp:stop:" + c.id }] : [{ text: "▶️ Запустить размещение", callback_data: "cp:start:" + c.id }],
    search,
    nav,
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
export async function promptNewCampaign(chatId: string) {
  await setValue("cmp-new:" + chatId, "1", 3600);
  await sendMessage(chatId, "📢 <b>Новая кампания</b>\n" + LINE + "\nОтправьте <b>голосовое</b> или напишите одним сообщением:\n\n• что рекламируем и текст объявления\n• город и страна\n• площадки: Telegram, Facebook, Instagram, TikTok\n• сколько размещений в день\n\n<i>Пример: «Продаю квартиру в Валенсии, 3 комнаты, 250 000 €. Telegram и Facebook, 300 в день.»</i>");
}

export async function maybeAnswer(chatId: string, text: string, ownerId = chatId): Promise<Result | null> {
  if (!text.startsWith("/") && (await getValue<string>("cmp-new:" + chatId))) {
    await deleteValue("cmp-new:" + chatId);
    return startCampaignFromText(chatId, text, ownerId, "text");
  }
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
    (isPolishWineCampaign(result.campaign) ? "\n\n" + escapeHtml(POLISH_WINE_NOTICE) : "") +
    (!f.total ? "\n⚠️ Публикацию запускать нельзя: подходящие площадки не подтверждены." : "") +
    (result.notes.length ? "\n⚠️ " + escapeHtml(result.notes.slice(0, 2).join(" ")) : "") + (top.length ? "\n\n" + top.join("\n") : ""), runningKeyboard(result.campaign));
  if (result.groups.length) await sendDocument(chatId, "communities-" + id + ".xlsx", await groupsXlsx(result.groups), "База сообществ (Excel)");
}

async function startPlacement(chatId: string, id: string) {
  const existing = await getOne<Campaign>("campaigns", id);
  if (!existing) { await sendMessage(chatId, "Кампания не найдена."); return; }
  if (isPolishWineCampaign(existing)) {
    await sendMessage(chatId, escapeHtml(POLISH_WINE_NOTICE) + "\n\nДля B2B-поиска напишите в чат: «Найди импортеров итальянского вина и оптовых дистрибьюторов в Польше».");
    return;
  }
  if (!existing.found?.total) {
    await sendMessage(chatId, "⛔ Размещение не запущено: найдено 0 подтверждённых сообществ. Исправьте ключевые слова или проверьте поисковые API.");
    return;
  }
  const c = await setCampaignStatus(id, "approved");
  if (!c) { await sendMessage(chatId, "Размещение заблокировано проверкой кампании."); return; }
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
      const b = await campaignBoard();
      if (!b.list.length) { await promptNewCampaign(chatId); return {}; }
      const shown = b.list.slice(0, 10);
      const lines = shown.map((c, i) => (i + 1) + ". " + STATUS_ICON[c.status] + " <b>" + escapeHtml(c.title.slice(0, 60)) + "</b>\n    " + STATUS[c.status] +
        (c.status === "approved" ? " · сегодня " + (b.done.get(c.id) || 0) + "/" + c.dailyTarget : "") + (c.found ? " · сообществ " + c.found.total : ""));
      const buttons: Keyboard = [];
      for (let i = 0; i < shown.length; i += 2) buttons.push(shown.slice(i, i + 2).map((c, j) => ({ text: (i + j + 1) + ". " + c.title.slice(0, 22), callback_data: "cp:open:" + c.id })));
      buttons.push([{ text: "➕ Новая кампания", callback_data: "menu:newcampaign" }, { text: "📊 Отчёт", callback_data: "menu:creport" }]);
      await sendMessage(chatId, "🗂 <b>Кампании</b>\n" + LINE + "\n" + lines.join("\n\n") + (b.target ? "\n" + LINE + "\n📈 Сегодня всего: <b>" + b.placed + " / " + b.target + "</b>\n" + bar(b.placed, b.target) : "") + "\n\n<i>Все кампании работают одновременно. Нажмите, чтобы открыть.</i>", buttons);
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

// ---- Publisher Network: admins connect their own community once ---------------------------

export function partnerInviteLink() {
  return "https://t.me/" + botHandle().replace(/^@/, "") + "?start=partner";
}

export function parseJoinArgs(args: string) {
  const url = /https?:\/\/\S+|(?:t\.me|facebook\.com|instagram\.com|tiktok\.com)\/\S+/i.exec(args)?.[0] || "";
  const nums = (args.replace(url, " ").match(/\d+/g) || []).map(Number);
  return { url, dailyLimit: nums[0], minDaysBetween: nums[1] };
}

const JOIN_HELP = "🤝 <b>Подключение к сети партнёров</b>\n\nВы админ группы, канала или владелец страницы и готовы публиковать подходящие объявления? Подключитесь один раз:\n\n" +
  "<b>Telegram</b>: добавьте бота {bot} администратором в группу или канал — публикации пойдут автоматически, в пределах лимита.\n\n" +
  "<b>Facebook, Instagram, TikTok</b> (или Telegram с согласованием каждого поста): отправьте\n<code>/join ссылка постов_в_день раз_в_N_дней</code>\nНапример: <code>/join https://www.facebook.com/groups/valencia 1 3</code>\n\n" +
  "Бот будет присылать вам готовые задания, вы публикуете сами и отвечаете /proof со ссылкой. Отключиться: /leave ссылка.";

export async function handleJoin(chatId: string, userId: string, who: string, args: string) {
  const { url, dailyLimit, minDaysBetween } = parseJoinArgs(args);
  if (!url) { await sendMessage(chatId, JOIN_HELP.replace("{bot}", escapeHtml(botHandle()))); return; }
  const found = platformOfUrl(url);
  const existing = found ? await getOne<GroupCard>("groups", stableId("grp", found.url.toLowerCase())) : null;
  if (existing?.partnerTelegramId && existing.partnerTelegramId !== userId && existing.status !== "declined") { await sendMessage(chatId, "Эта площадка уже подключена другим админом. Если это ошибка, напишите владельцу сети."); return; }
  const card = await addGroupManually({ url, pending: true, partnerTelegramId: userId, dailyLimit: dailyLimit ?? 1, minDaysBetween: minDaysBetween ?? 1, permissionNote: "самоподключение через бота: " + who + ", " + new Date().toISOString().slice(0, 10) });
  if (!card) { await sendMessage(chatId, "Нужна ссылка на группу или страницу в Telegram, Facebook, Instagram или TikTok."); return; }
  await sendMessage(chatId, "✅ Заявка принята: " + escapeHtml(card.name) + " (" + PLATFORM_LABEL[card.platform] + "), до " + (card.dailyLimit ?? 1) + " постов в день, не чаще раза в " + (card.minDaysBetween || 1) + " дн. После проверки владельцем вы начнёте получать задания.");
  const owner = [...controlIds()].find((id) => /^\d+$/.test(id)) || (await reportChatId());
  if (owner) await sendMessage(owner, "🤝 Новый партнёр: " + escapeHtml(who) + " (ID " + userId + ")\n" + escapeHtml(card.url) + " · " + PLATFORM_LABEL[card.platform] + " · " + (card.dailyLimit ?? 1) + "/день", [[{ text: "✅ Подключить", callback_data: "cp:pok:" + card.id }, { text: "✖️ Отклонить", callback_data: "cp:pno:" + card.id }]]);
}

export async function handleLeave(chatId: string, userId: string, args: string) {
  const { url } = parseJoinArgs(args);
  const found = url ? platformOfUrl(url) : null;
  const card = found ? await getOne<GroupCard>("groups", stableId("grp", found.url.toLowerCase())) : null;
  if (!card || card.partnerTelegramId !== userId) { await sendMessage(chatId, "Формат: <code>/leave ссылка</code> — для площадки, которую вы подключали."); return; }
  await updateGroup(card.id, { status: "declined", partnerTelegramId: "" });
  await sendMessage(chatId, "Площадка отключена, задания больше не придут.");
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
    case "open": {
      const c = await getOne<Campaign>("campaigns", id);
      await answerCallback(query.id, c ? "✓" : "Не найдено");
      if (c) await showDraft(chatId, c);
      return {};
    }
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
    case "pok": case "pno": {
      const g = await getOne<GroupCard>("groups", id);
      if (!g) { await answerCallback(query.id, "Не найдено"); return {}; }
      await updateGroup(id, { status: action === "pok" ? "free" : "declined", ...(action === "pno" ? { partnerTelegramId: "" } : {}) });
      await answerCallback(query.id, action === "pok" ? "Подключено" : "Отклонено");
      if (messageId) await editMessage(chatId, messageId, (action === "pok" ? "✅ Партнёр подключён: " : "✖️ Отклонено: ") + escapeHtml(g.name));
      if (g.partnerTelegramId) await sendMessage(g.partnerTelegramId, action === "pok" ? "✅ Ваша площадка подключена к сети: " + escapeHtml(g.name) + ". Задания будут приходить сюда." : "Заявка на подключение " + escapeHtml(g.name) + " отклонена.");
      return {};
    }
    case "ok": case "no": {
      const t = await verifyProof(id, action === "ok", by);
      await answerCallback(query.id, t ? (action === "ok" ? "Засчитано" : "Не засчитано") : "Уже обработано");
      if (t && messageId) await editMessage(chatId, messageId, (action === "ok" ? "✅ Засчитано: " : "✖️ Не засчитано: ") + escapeHtml(t.groupName) + "\n" + escapeHtml(t.link || ""));
      return {};
    }
  }
  return {};
}

