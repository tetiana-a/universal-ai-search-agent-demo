import { formatLocal, googleCalendarLink, newMeeting, parseMeetingCommand } from "@/lib/scout/calendar";
import { botHandle, dashboardUrl, loadSettings, saveSettings } from "@/lib/scout/config";
import { classifyComment, detectGoals, detectSegments, matchCountries } from "@/lib/scout/extract";
import { addToStopList, buildFirstMessage, createDraft, decideDraft, forgetContact, isStopped, markSent } from "@/lib/scout/outreach";
import { advanceDialog, GREETING, leadSummary, questionFor, missingItems } from "@/lib/scout/qualification";
import { collectReport, renderReport } from "@/lib/scout/report";
import { scoreInvestor } from "@/lib/scout/scoring";
import { addWatch, removeWatch, setSourceState } from "@/lib/scout/sources";
import { deleteValue, getOne, getValue, listAll, logAction, putOne, setValue, storeIsPersistent } from "@/lib/scout/store";
import { answerQuestion, applyCriteriaChange, handleResearchCallback, isEditingCriteria, loadTask, startResearch, statusKeyboard, statusText } from "@/lib/scout/research-bot";
import { answerCallback, controlIds, editMessage, reportChatId, sendLong, sendMessage, tgCall, type Keyboard } from "@/lib/scout/telegram";
import { detectLang, escapeHtml, formatMoney, nowIso, stableId } from "@/lib/scout/text";
import { configuredAiProviders } from "@/lib/free-ai";
import { keylessProviders } from "@/lib/keyless-search";
import type { AgencyCard, Draft, InvestorCard, Lead, Match, ObjectCard, ScoutSource, WatchItem, WatchKind } from "@/lib/scout/types";

// Telegram control of the agent (spec 6: Telegram is the main interface).
// - Members of the control chats (TELEGRAM_ALLOWED_CHAT_IDS / TELEGRAM_CHAT_ID) run commands and press buttons.
// - Anyone else who writes to the bot privately gets the scripted qualification dialogue:
//   they started the conversation, so the agent may answer them (spec 4, "safe alternative").

export type BotResult = { background?: () => Promise<void> };

const HELP = [
  "<b>AURELIUS — универсальный AI-агент поиска</b>",
  "Напишите задачу обычным текстом, например: «Найди земельные участки в Мадриде от 10 000 м²» или «Найди инвесторов в Амстердаме для B2B SaaS».",
  "Агент уточнит критерии, соберёт базу источников, проверит их и пришлёт таблицу результатов (Excel + CSV).",
  "В группе: /find задача, упоминание бота или ответ на его сообщение.",
  "/find задача — новый поиск · /status — прогресс текущего поиска",
  "",
  "<b>Разведчик (недвижимость + инвесторы)</b>",
  "/report — отчёт за сегодня",
  "/scan — запустить обход сейчас",
  "/objects [город] — топ объектов",
  "/investors — топ инвесторов",
  "/matches — пары объект ↔ инвестор",
  "/drafts — сообщения на одобрение (Отправить / Изменить / Отклонить)",
  "/leads — диалоги и квалификация",
  "/sources — новые источники (Одобрить / Отклонить)",
  "/watch — watchlist; /watch add person @канал · /watch add keyword текст · /watch add domain сайт.com · /watch add group t.me/… · /watch del значение",
  "/comments ссылка_на_пост + с новой строки «Имя: комментарий» — разобрать комментаторов",
  "/meet 18.10 11:00 Zoom — Engel &amp; Völkers — встреча (.ics + Google Календарь)",
  "/stop контакт — в стоп-лист · /forget контакт — удалить по GDPR",
  "/settings — критерии; /settings price 100000-900000 · /settings discount 15",
  "",
  "Дашборд: " + dashboardUrl(),
].join("\n");

function commandOf(text: string) {
  const m = /^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), args: m[2].trim() } : null;
}

function isControl(chatId: string, userId: string) {
  const ids = controlIds();
  return ids.has(chatId) || ids.has(userId);
}

// ---- Rendering helpers --------------------------------------------------------

function objectLine(o: ObjectCard, i: number) {
  return (i + 1) + ". <a href=\"" + escapeHtml(dashboardUrl("?tab=objects&id=" + o.id)) + "\">" + escapeHtml(o.title.slice(0, 70)) + "</a>\n    " +
    formatMoney(o.price, o.currency) + (o.areaM2 ? " · " + o.areaM2 + " м²" : "") + " · " + escapeHtml(o.city || o.country) + " · скор " + o.score +
    (o.discountPct && o.discountPct > 0 ? " · −" + o.discountPct + "%" : "");
}

function draftText(d: Draft) {
  return "✉️ <b>" + escapeHtml({ first_contact: "Первое касание", reminder: "Напоминание", partnership: "Партнёрство" }[d.kind]) + "</b> → " + escapeHtml(d.target.name) +
    "\nКанал: " + escapeHtml(d.channel) + (d.target.contact ? " · " + escapeHtml(d.target.contact) : "") + " · язык: " + d.lang.toUpperCase() +
    "\n\n" + escapeHtml(d.text);
}

function draftKeyboard(d: Draft): Keyboard {
  return [[
    { text: "✅ Отправить", callback_data: "d:send:" + d.id },
    { text: "✏️ Изменить", callback_data: "d:edit:" + d.id },
    { text: "✖️ Отклонить", callback_data: "d:rej:" + d.id },
  ]];
}

function sourceText(s: ScoutSource) {
  return "🔭 <b>" + escapeHtml(s.name) + "</b>\n" + escapeHtml(s.kind) + (s.country ? " · " + escapeHtml(s.country) : "") + (s.members ? " · " + s.members.toLocaleString("ru-RU") + " чел." : "") + (s.hasApi ? " · есть API" : "") +
    "\nРекомендация: " + ({ join: "вступить", connect: "подключить", ignore: "игнорировать" }[s.recommendation || "ignore"]) +
    (s.summary ? "\n" + escapeHtml(s.summary.slice(0, 220)) : "") + "\n" + escapeHtml(s.url);
}

function mainPanelKeyboard(): Keyboard {
  return [
    [
      { text: "🔎 Новый поиск", callback_data: "menu:find" },
      { text: "📍 Статус", callback_data: "menu:status" },
    ],
    [
      { text: "📊 Отчёт", callback_data: "menu:report" },
      { text: "🛰 Обход", callback_data: "menu:scan" },
    ],
    [
      { text: "🌐 Источники", callback_data: "menu:sources" },
      { text: "✉️ Черновики", callback_data: "menu:drafts" },
    ],
    [
      { text: "👥 Лиды", callback_data: "menu:leads" },
      { text: "⚙️ Настройки", callback_data: "menu:settings" },
    ],
    [{ text: "🩺 Диагностика", callback_data: "menu:health" }],
    [{ text: "🖥 Открыть дашборд", url: dashboardUrl() }],
  ];
}

async function showPanel(chatId: string) {
  const task = await loadTask(chatId);
  const state = task
    ? "Текущая задача: <b>" + escapeHtml(task.query.slice(0, 120)) + "</b>\nСтатус: " + escapeHtml(task.state)
    : "Активной задачи сейчас нет.";
  await sendMessage(
    chatId,
    "<b>AURELIUS · центр управления</b>\n" +
      "Одна панель для поиска, источников, отчётов и действий.\n\n" +
      state +
      "\n\nВыберите действие:",
    mainPanelKeyboard(),
  );
}

async function diagnosticText(chatId: string, userId: string) {
  const [me, hook, reportId] = await Promise.all([
    tgCall("getMe", {}),
    tgCall("getWebhookInfo", {}),
    reportChatId(),
  ]);

  const probeKey = "health-probe:" + userId;
  let redisRoundTrip = false;
  if (storeIsPersistent()) {
    const probe = { at: Date.now(), nonce: userId + ":" + Date.now() };
    await setValue(probeKey, probe, 60);
    const readBack = await getValue<typeof probe>(probeKey);
    redisRoundTrip = Boolean(readBack && readBack.nonce === probe.nonce);
    await deleteValue(probeKey);
  }

  const ai = configuredAiProviders("pro").map((provider) => provider.id + ":" + provider.model);
  const search = keylessProviders();
  const currentHook = String(hook?.result?.url || "");
  const hookError = String(hook?.result?.last_error_message || "");
  const lines = [
    "<b>AURELIUS · диагностика</b>",
    "",
    "Telegram API: " + (me?.ok ? "✅ @" + escapeHtml(String(me?.result?.username || "bot")) : "❌ " + escapeHtml(String(me?.description || "ошибка"))),
    "Webhook: " + (currentHook ? "✅ " + escapeHtml(currentHook) : "❌ не установлен"),
    "Webhook error: " + (hookError ? "⚠️ " + escapeHtml(hookError) : "✅ нет"),
    "Control access: " + (isControl(chatId, userId) ? "✅" : "❌"),
    "User ID: <code>" + escapeHtml(userId) + "</code>",
    "Chat ID: <code>" + escapeHtml(chatId) + "</code>",
    "Redis persistence: " + (storeIsPersistent() ? (redisRoundTrip ? "✅ read/write" : "⚠️ configured, probe failed") : "❌"),
    "AI route: " + (ai.length ? "✅ " + escapeHtml(ai.join(", ")) : "⚠️ rules only"),
    "Search: " + (search.length ? "✅ " + escapeHtml(search.join(", ")) : "❌ disabled"),
    "Report chat: " + (reportId ? "<code>" + escapeHtml(reportId) + "</code>" : "—"),
    "Zero-cost: " + (process.env.ZERO_COST_MODE === "on" ? "✅ on" : "⚠️ off"),
  ];
  return lines.join("\n");
}

function identityText(message: any) {
  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  return [
    "<b>Telegram ID</b>",
    "User ID: <code>" + escapeHtml(userId) + "</code>",
    "Chat ID: <code>" + escapeHtml(chatId) + "</code>",
    "Chat type: " + escapeHtml(String(message.chat?.type || "unknown")),
    "Control access: " + (isControl(chatId, userId) ? "✅ YES" : "❌ NO"),
  ].join("\n");
}

// ---- Commands -------------------------------------------------------------------

async function handleCommand(chatId: string, userId: string, userName: string, cmd: string, args: string): Promise<BotResult> {
  switch (cmd) {
    case "start":
    case "panel":
      await showPanel(chatId);
      return {};

    case "health":
      await sendMessage(chatId, await diagnosticText(chatId, userId), mainPanelKeyboard());
      return {};

    case "help":
      await sendMessage(chatId, HELP, mainPanelKeyboard());
      return {};

    case "find":
    case "search": {
      if (!args) { await sendMessage(chatId, "Напишите задачу после команды, например: /find инвесторы в Амстердаме для B2B SaaS"); return {}; }
      return { background: await startResearch(chatId, userId, args) };
    }

    case "status": {
      const task = await loadTask(chatId);
      if (task) await sendMessage(chatId, statusText(task), statusKeyboard(task));
      else await sendMessage(chatId, "Активной задачи нет. Напишите, что найти.");
      return {};
    }

    case "report": {
      const { html, keyboard } = renderReport(await collectReport());
      await sendLong(chatId, html, keyboard);
      return {};
    }

    case "scan":
      await sendMessage(chatId, "🔎 Запускаю обход источников. Итог пришлю сюда.");
      return {
        background: async () => {
          const { runScan } = await import("@/lib/scout/scan");
          const s = await runScan({ actor: "bot", deadlineAt: Date.now() + 50_000 });
          await sendMessage(chatId, "✅ Обход завершён: объектов +" + s.objectsNew + " (дублей слито " + s.objectsMerged + "), инвесторов +" + s.investorsNew + ", агентств +" + s.agenciesNew + ", источников +" + s.sourcesDiscovered + ", пар +" + s.matchesNew + ". Запросов: " + s.queries + ".\n/report — отчёт");
        },
      };

    case "objects": {
      const city = args.toLowerCase();
      const list = (await listAll<ObjectCard>("objects")).filter((o) => o.state !== "rejected" && (!city || (o.city || "").toLowerCase().includes(city) || o.country.toLowerCase().includes(city))).sort((a, b) => b.score - a.score).slice(0, 8);
      await sendMessage(chatId, list.length ? "<b>Топ объектов</b>\n" + list.map((o, i) => objectLine(o, i)).join("\n") : "Объектов пока нет — /scan запустит обход.");
      return {};
    }

    case "investors": {
      const list = (await listAll<InvestorCard>("investors")).filter((i) => i.state !== "refused").sort((a, b) => b.score - a.score).slice(0, 8);
      await sendMessage(chatId, list.length ? "<b>Топ инвесторов</b>\n" + list.map((i, n) => (n + 1) + ". <a href=\"" + escapeHtml(dashboardUrl("?tab=investors&id=" + i.id)) + "\">" + escapeHtml(i.name) + "</a> · " + i.kind + " · скор " + i.score + (i.comment ? " · 💬 " + escapeHtml(i.comment.text.slice(0, 40)) : "")).join("\n") : "Инвесторов пока нет.");
      return {};
    }

    case "matches": {
      const [matches, objects, investors] = await Promise.all([listAll<Match>("matches"), listAll<ObjectCard>("objects"), listAll<InvestorCard>("investors")]);
      const top = matches.filter((m) => m.state === "proposed").sort((a, b) => b.score - a.score).slice(0, 5);
      if (!top.length) { await sendMessage(chatId, "Пар пока нет: нужны инвесторы с известной географией/бюджетом."); return {}; }
      for (const m of top) {
        const o = objects.find((x) => x.id === m.objectId); const i = investors.find((x) => x.id === m.investorId);
        await sendMessage(chatId, "🔗 <b>" + m.score + "%</b> " + escapeHtml(i?.name || "?") + " ↔ " + escapeHtml(o?.title || "?") + "\n" + escapeHtml(m.reasons.join(", ")), [[{ text: "🤝 Сделать стыковку", callback_data: "m:ok:" + m.id }, { text: "✖️ Не подходит", callback_data: "m:no:" + m.id }]]);
      }
      return {};
    }

    case "drafts": {
      const pending = (await listAll<Draft>("drafts")).filter((d) => d.state === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 5);
      if (!pending.length) { await sendMessage(chatId, "Нет сообщений на одобрение."); return {}; }
      for (const d of pending) await sendMessage(chatId, draftText(d), draftKeyboard(d));
      return {};
    }

    case "leads": {
      const leads = (await listAll<Lead>("leads")).filter((l) => l.state !== "refused").sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt)).slice(0, 10);
      await sendMessage(chatId, leads.length ? "<b>Диалоги</b>\n" + leads.map((l) => "• " + escapeHtml(l.name) + " — " + ({ in_progress: "в работе", qualified: "✅ квалифицирован", escalated: "⚠️ эскалация", refused: "отказ", handed_over: "передан" }[l.state]) + " · осталось вопросов: " + missingItems(l).length).join("\n") : "Диалогов пока нет. Когда человек напишет боту " + botHandle() + ", агент проведёт квалификацию.");
      return {};
    }

    case "sources": {
      const list = (await listAll<ScoutSource>("sources")).filter((s) => s.state === "candidate").slice(0, 6);
      if (!list.length) { await sendMessage(chatId, "Новых источников на одобрение нет."); return {}; }
      for (const s of list) await sendMessage(chatId, sourceText(s), [[{ text: "✅ Одобрить", callback_data: "src:approve:" + s.id }, { text: "✖️ Отклонить", callback_data: "src:reject:" + s.id }]]);
      return {};
    }

    case "watch": {
      const m = /^(add|del)\s+(?:(person|keyword|domain|group)\s+)?([\s\S]+)$/i.exec(args);
      if (m && m[1].toLowerCase() === "add" && m[2]) {
        const item = await addWatch(m[2].toLowerCase() as WatchKind, m[3]);
        await sendMessage(chatId, item ? "👁 Добавлено в watchlist: " + item.kind + " — " + escapeHtml(item.value) : "Не удалось добавить.");
        return {};
      }
      if (m?.[1].toLowerCase() === "del") {
        const all = await listAll<WatchItem>("watch");
        const hit = all.find((w) => w.id === m[3] || w.value.toLowerCase() === m[3].toLowerCase());
        if (hit) await removeWatch(hit.id);
        await sendMessage(chatId, hit ? "Удалено: " + escapeHtml(hit.value) : "Не найдено в watchlist.");
        return {};
      }
      const all = await listAll<WatchItem>("watch");
      const settings = await loadSettings();
      const groups: Record<string, string[]> = { person: [], group: [], keyword: [], domain: [] };
      for (const w of all) groups[w.kind].push(escapeHtml(w.value) + (w.hits ? " (" + w.hits + ")" : ""));
      await sendMessage(chatId, "<b>Watchlist</b>\n👤 Персоны: " + (groups.person.join(", ") || "—") + "\n👥 Группы: " + (groups.group.join(", ") || "—") + "\n🔑 Ключи: " + (groups.keyword.join(", ") || "—") + "\n🌐 Домены: " + (groups.domain.join(", ") || "—") + "\n\nКлючи мониторинга по умолчанию: " + escapeHtml(settings.monitorKeywords.join(", ")) + "\n\nДобавить: /watch add person @канал");
      return {};
    }

    case "comments":
      await sendMessage(chatId, await importComments(args, userName));
      return {};

    case "stop":
      if (!args) { await sendMessage(chatId, "Формат: /stop email, телефон или @username"); return {}; }
      await addToStopList(args, "manual by " + userName);
      await sendMessage(chatId, "⛔ Контакт добавлен в стоп-лист. Агент больше не предложит ему писать.");
      return {};

    case "forget": {
      if (!args) { await sendMessage(chatId, "Формат: /forget email, телефон или @username"); return {}; }
      const n = await forgetContact(args);
      await sendMessage(chatId, "🗑 Удалено записей: " + n + ". Контакт в стоп-листе.");
      return {};
    }

    case "meet": {
      const parsed = parseMeetingCommand(args);
      if (!parsed) { await sendMessage(chatId, "Формат: /meet 18.10 11:00 Zoom — Engel &amp; Völkers Valencia"); return {}; }
      const meeting = newMeeting(parsed);
      const agency = (await listAll<AgencyCard>("agencies")).find((a) => meeting.with.toLowerCase().includes(a.name.toLowerCase().slice(0, 12)));
      if (agency) { meeting.agencyId = agency.id; await putOne("agencies", { ...agency, state: "meeting" }); }
      await putOne("meetings", meeting);
      await logAction({ actor: "human", action: "meeting.create", detail: meeting.title + " " + meeting.startsAt });
      await sendMessage(chatId, "📅 Встреча " + formatLocal(meeting.startsAt) + " — " + escapeHtml(meeting.where) + ", " + escapeHtml(meeting.with), [[{ text: "Google Календарь", url: googleCalendarLink(meeting) }, { text: "Файл .ics", url: dashboardUrl("").replace(/\/scout$/, "") + "/api/scout/ics?id=" + meeting.id }]]);
      return {};
    }

    case "settings": {
      const price = /^price\s+(\d+)\s*-\s*(\d+)$/i.exec(args);
      const discount = /^discount\s+(\d+)$/i.exec(args);
      if (price) await saveSettings({ priceMin: Number(price[1]), priceMax: Number(price[2]) });
      if (discount) await saveSettings({ minDiscountPct: Number(discount[1]) });
      const s = await loadSettings();
      await sendMessage(chatId, (price || discount ? "✅ Сохранено.\n" : "") + "<b>Критерии</b>\n" + s.targets.map((t) => "• " + escapeHtml(t.country + (t.city ? ", " + t.city : "")) + ": " + t.types.join(", ")).join("\n") + "\nЦена: " + formatMoney(s.priceMin) + " – " + formatMoney(s.priceMax) + "\nДисконт к рынку от: " + s.minDiscountPct + "%\nЛимиты в день: " + Object.entries(s.dailyLimits).map(([k, v]) => k + " " + v).join(", ") + "\n\nПолная настройка: " + dashboardUrl("?tab=settings"));
      return {};
    }

    default:
      await sendMessage(chatId, "Не знаю такую команду. /help — список.");
      return {};
  }
}

// Module 5.1 (level-B safe mode): the human copies comments from a post they can see;
// the agent classifies them and drafts a public reply. No DMs to commenters.
export async function importComments(args: string, by: string) {
  const lines = args.split("\n").map((l) => l.trim()).filter(Boolean);
  const postUrl = /^https?:\/\/\S+/.exec(lines[0] || "")?.[0];
  if (!postUrl || lines.length < 2) return "Формат:\n/comments https://ссылка-на-пост\nИмя: текст комментария\nИмя 2: текст";
  const settings = await loadSettings();
  const counts = { explicit: 0, general: 0, neutral: 0 };
  const cards: InvestorCard[] = [];
  for (const line of lines.slice(1)) {
    const m = /^([^:]{2,60}):\s*(.+)$/.exec(line);
    if (!m) continue;
    const level = classifyComment(m[2]);
    counts[level] += 1;
    if (level === "neutral") continue; // spec: only explicit and general interest become investor cards
    const now = nowIso();
    cards.push(scoreInvestor({
      id: stableId("inv", "comment|" + postUrl + "|" + m[1].toLowerCase()),
      name: m[1].trim(), kind: "private",
      interest: { segments: detectSegments(m[2]), geography: matchCountries(m[2]), goals: detectGoals(m[2]) },
      source: "комментарий под постом", sourceUrl: postUrl,
      comment: { postUrl, text: m[2].slice(0, 300), at: now, level },
      score: 0, checklist: {}, firstSeenAt: now, lastSeenAt: now, state: "new",
    }, settings));
  }
  for (const card of cards) await putOne("investors", card);
  const lang = detectLang(lines.slice(1).join(" "), "ru");
  if (cards.length) {
    await createDraft({ target: { type: "commenter", id: stableId("post", postUrl), name: "Публичный ответ под постом", contact: postUrl }, channel: "public_reply", lang, templateId: "public_reply", kind: "first_contact", text: buildFirstMessage(settings, "public_reply", lang, { city: settings.targets[0]?.city }) });
  }
  await logAction({ actor: "human", action: "comments.import", detail: by + ": " + cards.length + " contacts from " + postUrl });
  return "💬 Разобрано: явный интерес " + counts.explicit + ", общий " + counts.general + ", нейтральных " + counts.neutral + ".\nВ базу инвесторов добавлено: " + cards.length + (cards.length ? "\nЧерновик публичного ответа в ветке — /drafts (личные сообщения комментаторам агент не пишет)." : "");
}

// ---- Callback buttons ------------------------------------------------------------

async function handleCallback(query: any): Promise<BotResult> {
  const data = String(query.data || "");
  const chatId = String(query.message?.chat?.id || "");
  const messageId = Number(query.message?.message_id || 0);
  const userId = String(query.from?.id || "");
  const by = query.from?.username ? "@" + query.from.username : query.from?.first_name || userId;
  if (!isControl(chatId, userId)) { await answerCallback(query.id, "Нет доступа"); return {}; }
  const [kind, action, id] = data.split(":");
  if (kind === "menu") {
    await answerCallback(query.id, "✓");
    if (action === "find") {
      await tgForceReply(chatId, "🔎 Напишите одним сообщением, что нужно найти. Я запущу поиск по бесплатному маршруту.");
      return {};
    }
    if (action === "panel") {
      await showPanel(chatId);
      return {};
    }
    if (["status", "report", "scan", "sources", "drafts", "leads", "settings", "health"].includes(action)) {
      return handleCommand(chatId, userId, by, action, "");
    }
    return {};
  }
  if (kind === "rs") return { background: await handleResearchCallback(chatId, action, query.id) };

  if (kind === "src") {
    const updated = await setSourceState(id, action === "approve" ? "approved" : "rejected", by);
    await answerCallback(query.id, updated ? (action === "approve" ? "Источник подключён — завтра агент уже ищет в нём" : "Отклонено") : "Не найдено");
    if (updated && messageId && String(query.message?.text || "").startsWith("🔭")) await editMessage(chatId, messageId, sourceText(updated) + "\n\n" + (action === "approve" ? "✅ Одобрено" : "✖️ Отклонено") + " — " + escapeHtml(by));
    return {};
  }

  if (kind === "d") {
    if (action === "edit") {
      await setValue("edit:" + userId, { draftId: id, chatId }, 900);
      await answerCallback(query.id, "Пришлите новый текст ответом");
      await tgForceReply(chatId, "✏️ Пришлите новый текст сообщения ответом на это сообщение (15 минут).");
      return {};
    }
    if (action === "sent") {
      const draft = await markSent(id, by);
      if (draft) await advanceTarget(draft);
      await answerCallback(query.id, "Отмечено как отправленное");
      if (draft && messageId) await editMessage(chatId, messageId, draftText(draft) + "\n\n📤 Отправлено — " + escapeHtml(by));
      return {};
    }
    const result = await decideDraft(id, action === "send" ? "approve" : "reject", by);
    await answerCallback(query.id, result.message);
    if (result.draft && messageId) {
      const keyboard: Keyboard = [];
      if (result.ok && action === "send") {
        const row = result.link && /^https:/.test(result.link) ? [{ text: "📨 Открыть и отправить", url: result.link }] : [];
        keyboard.push([...row, { text: "✔ Отправлено", callback_data: "d:sent:" + id }]);
      }
      const status = !result.ok ? "⚠️ " + result.message : action === "send" ? "✅ Одобрено — " + escapeHtml(by) + (result.link && !result.link.startsWith("https:") ? "\nОтправьте: " + escapeHtml(result.link.slice(0, 300)) : "") : "✖️ Отклонено — " + escapeHtml(by);
      await editMessage(chatId, messageId, draftText(result.draft) + "\n\n" + status, result.ok ? keyboard : draftKeyboard(result.draft));
    }
    return {};
  }

  if (kind === "m") {
    const match = await getOne<Match>("matches", id);
    if (match) await putOne("matches", { ...match, state: action === "ok" ? "accepted" : "dismissed" });
    await logAction({ actor: "human", action: "match." + action, detail: by + ": " + id });
    await answerCallback(query.id, action === "ok" ? "Стыковка отмечена" : "Пара скрыта");
    if (messageId) await editMessage(chatId, messageId, escapeHtml(String(query.message?.text || "")) + "\n\n" + (action === "ok" ? "🤝 В работе — " : "✖️ Не подходит — ") + escapeHtml(by));
    return {};
  }

  if (kind === "lead") {
    const lead = await getOne<Lead>("leads", id);
    if (lead) await putOne("leads", { ...lead, state: "handed_over" });
    await answerCallback(query.id, "Лид у вас в работе");
    if (messageId) await editMessage(chatId, messageId, escapeHtml(String(query.message?.text || "")) + "\n\n👤 Взял(а) в работу: " + escapeHtml(by));
    return {};
  }

  if (kind === "drafts") {
    await answerCallback(query.id, "Показываю черновики");
    return handleCommand(chatId, userId, by, "drafts", "");
  }

  await answerCallback(query.id, "Неизвестное действие");
  return {};
}

async function tgForceReply(chatId: string, text: string) {
  const { tgCall } = await import("@/lib/scout/telegram");
  await tgCall("sendMessage", { chat_id: chatId, text, reply_markup: { force_reply: true, selective: true } });
}

// After the human confirms a send, the CRM state follows.
async function advanceTarget(draft: Draft) {
  if (draft.target.type === "agency") {
    const agency = await getOne<AgencyCard>("agencies", draft.target.id);
    if (agency && agency.state === "new") await putOne("agencies", { ...agency, state: "written" });
  }
  if (draft.target.type === "investor") {
    const investor = await getOne<InvestorCard>("investors", draft.target.id);
    if (investor && investor.state === "new") await putOne("investors", { ...investor, state: "contacted" });
  }
}

// ---- Inbound qualification dialogue (people who wrote to the bot first) -------------

async function handleInbound(message: any): Promise<BotResult> {
  const userId = String(message.from?.id || "");
  const chatId = String(message.chat?.id || "");
  const text = String(message.text || "").trim();
  if (!text || (await isStopped("tg:" + userId))) return {};
  const name = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || "Контакт";
  const id = "lead_tg_" + userId;
  let lead = await getOne<Lead>("leads", id);
  const now = nowIso();

  if (!lead || text.startsWith("/start")) {
    const lang = detectLang(message.from?.language_code === "es" ? "hola" : text === "/start" ? (message.from?.language_code === "uk" ? "що" : message.from?.language_code === "en" ? "hello" : "привет") : text, "ru");
    lead = { id, type: "investor", name, contact: "tg:" + userId, lang, answers: {}, transcript: [], state: "in_progress", lastContactAt: now, remindersSent: 0, createdAt: now };
    const question = questionFor("budget", lang);
    lead.transcript.push({ from: "agent", text: GREETING[lang], at: now }, { from: "agent", text: question, at: now });
    await putOne("leads", lead);
    await logAction({ actor: "bot", action: "lead.start", detail: name });
    await sendMessage(chatId, escapeHtml(GREETING[lang] + "\n\n" + question));
    if (!text.startsWith("/start")) return handleInbound(message); // the first message may already carry answers
    return {};
  }
  if (lead.state !== "in_progress") return {};

  const outcome = advanceDialog(lead, text);
  await putOne("leads", outcome.lead);
  await sendMessage(chatId, escapeHtml(outcome.reply));

  if (outcome.event === "refused") {
    await addToStopList("tg:" + userId, "refused in dialogue");
    await logAction({ actor: "bot", action: "lead.refused", detail: name });
  }
  if (outcome.event === "qualified" || outcome.event === "escalated") {
    const group = await reportChatId();
    const header = outcome.event === "qualified" ? "✅ <b>Квалифицированный лид</b> — ждёт тебя" : "⚠️ <b>Эскалация</b> — денежный/спорный вопрос";
    const body = header + "\n👤 " + escapeHtml(name) + (message.from?.username ? " (@" + escapeHtml(message.from.username) + ")" : "") + " · язык " + outcome.lead.lang.toUpperCase() +
      "\n\n" + escapeHtml(leadSummary(outcome.lead)) + (outcome.lead.escalation ? "\n\n💬 «" + escapeHtml(outcome.lead.escalation) + "»" : "") +
      "\n\nНазначить встречу: /meet ДД.ММ ЧЧ:ММ Zoom — " + escapeHtml(name);
    const buttons: Keyboard = [[{ text: "👤 Беру в работу", callback_data: "lead:done:" + id }, ...(message.from?.username ? [{ text: "Написать", url: "https://t.me/" + message.from.username }] : [])]];
    if (group) await sendMessage(group, body, buttons);
    await logAction({ actor: "bot", action: "lead." + outcome.event, detail: name });
  }
  return {};
}

// ---- Universal research by plain text --------------------------------------------

// In a group the bot only takes text addressed to it (a reply to its message or an
// @mention); in a private chat every message is for the bot.
function addressedText(message: any) {
  const text = String(message.text || "").trim();
  if (message.chat?.type === "private") return text;
  const handle = botHandle().toLowerCase();
  const mentioned = text.toLowerCase().includes(handle);
  const replyToBot = Boolean(message.reply_to_message?.from?.is_bot);
  if (!mentioned && !replyToBot) return "";
  return text.replace(new RegExp(handle.replace("@", "@?"), "ig"), "").trim();
}

async function handleResearchText(message: any, chatId: string, userId: string): Promise<BotResult> {
  const text = addressedText(message);
  if (!text) return {};
  if (await isEditingCriteria(chatId)) return { background: await applyCriteriaChange(chatId, text) };
  const task = await loadTask(chatId);
  if (task?.state === "clarifying") return { background: await answerQuestion(task, text) };
  if (text.length < 8) { await sendMessage(chatId, "Опишите, что найти, одной-двумя фразами. /help — подсказка."); return {}; }
  return { background: await startResearch(chatId, userId, text) };
}

// ---- Entry point ---------------------------------------------------------------

export async function handleUpdate(update: any): Promise<BotResult> {
  if (update?.callback_query) return handleCallback(update.callback_query);
  const message = update?.message || update?.edited_message;
  if (!message?.text || message.from?.is_bot) return {};
  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  const userName = message.from?.username ? "@" + message.from.username : message.from?.first_name || userId;
  const command = commandOf(message.text);

  // /id is always safe: it only returns IDs from the caller's own update.
  if (command?.cmd === "id") {
    await sendMessage(chatId, identityText(message));
    return {};
  }

  const control = isControl(chatId, userId);
  if (!control && command && ["panel", "find", "search", "status", "report", "scan", "objects", "investors", "matches", "drafts", "leads", "sources", "watch", "comments", "stop", "forget", "meet", "settings", "health"].includes(command.cmd)) {
    await sendMessage(chatId, "⛔ Нет доступа к панели управления. Отправьте /id и добавьте ваш <b>User ID</b> в TELEGRAM_ALLOWED_CHAT_IDS или SCOUT_ADMIN_TELEGRAM_IDS в Vercel.");
    return {};
  }

  if (control) {
    // A reply with new text for a draft being edited.
    const editing = await getValue<{ draftId: string; chatId: string }>("edit:" + userId);
    if (editing && !message.text.startsWith("/")) {
      await deleteValue("edit:" + userId);
      const result = await decideDraft(editing.draftId, "edit", userName, message.text);
      if (result.draft) await sendMessage(chatId, draftText(result.draft) + "\n\n" + escapeHtml(result.message), result.ok ? draftKeyboard(result.draft) : undefined);
      return {};
    }
    if (command) return handleCommand(chatId, userId, userName, command.cmd, command.args);
    return handleResearchText(message, chatId, userId);
  }

  // Strangers in groups are ignored; only private chats start a qualification dialogue.
  if (message.chat?.type !== "private") return {};
  return handleInbound(message);
}

