import { formatLocal, googleCalendarLink, newMeeting, parseMeetingCommand } from "@/lib/scout/calendar";
import { botHandle, dashboardUrl, loadSettings, saveSettings } from "@/lib/scout/config";
import { classifyComment, detectGoals, detectSegments, matchCountries } from "@/lib/scout/extract";
import { addToStopList, buildFirstMessage, createDraft, decideDraft, forgetContact, isStopped, markSent } from "@/lib/scout/outreach";
import { advanceDialog, GREETING, leadSummary, questionFor, missingItems } from "@/lib/scout/qualification";
import { collectReport, renderReport } from "@/lib/scout/report";
import { scoreInvestor } from "@/lib/scout/scoring";
import { addWatch, removeWatch, setSourceState } from "@/lib/scout/sources";
import { deleteValue, getOne, getValue, listAll, logAction, putOne, setValue } from "@/lib/scout/store";
import { answerQuestion, applyCriteriaChange, handleResearchCallback, isEditingCriteria, listRecentResearchTasks, loadTask, startFreshDialog, startResearch, statusKeyboard, statusText } from "@/lib/scout/research-bot";
import { answerCallback, controlIds, editMessage, isOpenGroup, isOwnersGroupAdmin, reportChatId, sendDocument, sendLong, sendMessage, type Keyboard } from "@/lib/scout/telegram";
import { detectLang, escapeHtml, formatMoney, nowIso, stableId } from "@/lib/scout/text";
import { collectOperationalHealth } from "@/lib/scout/health";
import { addBotUrl, fullExportXlsx, groupsCsv, handleMyChatMember, listGroups, registerOwnedTelegramGroup } from "@/lib/scout/groups";
import { GROUP_COMMANDS, handleGroupCallback, handleGroupCommand } from "@/lib/scout/groups-bot";
import { CAMPAIGN_COMMANDS, campaignSummary, handleCampaignCallback, handleCampaignCommand, handleJoin, handleLeave, handleProof, handleVoice, maybeAnswer, partnerInviteLink, promptNewCampaign } from "@/lib/scout/campaigns-bot";
import { ADVISOR_COMMANDS, advisorMode, handleAdvisorCallback, handleAdvisorCommand, handleAdvisorText, handleAdvisorVoice } from "@/lib/scout/advisor-bot";
import { advanceAdWizard, adWizardButton, cancelAdWizard, isAdPostingIntent, startAdWizard } from "@/lib/scout/ad-wizard";
import { createPostizDraft, listPostizChannels, postizConfigured } from "@/lib/scout/postiz";
import { cancelInstagramJob, jobPlatform, jobStatusRu, listInstagramJobs, refreshInstagramJobs, scheduleInstagram } from "@/lib/scout/instagram-posts";
import type { AgencyCard, Draft, InvestorCard, Lead, Match, ObjectCard, ScoutSource, WatchItem, WatchKind } from "@/lib/scout/types";

// Telegram control of the agent (spec 6: Telegram is the main interface).
// - Members of the control chats (TELEGRAM_ALLOWED_CHAT_IDS / TELEGRAM_CHAT_ID) run commands and press buttons.
// - Anyone else who writes to the bot privately gets the scripted qualification dialogue:
//   they started the conversation, so the agent may answer them (spec 4, "safe alternative").

export type BotResult = { background?: () => Promise<void> };

const HELP = [
  "✦ <b>AURELIUS</b> · AI-агент для поиска сообществ и размещения объявлений",
  "━━━━━━━━━━━━━━",
  "",
  "🎙 <b>Поставить задачу</b>",
  "Отправьте голосовое или текст: что рекламируем, где, на каких площадках. Я задам уточнения, предложу 40 ключевых слов и начну работу только после вашего «да».",
  "",
  "🔎 <b>Поиск сообществ</b>",
  "Facebook, Telegram, Instagram, TikTok на любом языке: профильные и смежные (экспаты, барахолки, городские), с проверкой активности и выгрузкой в Excel.",
  "",
  "📣 <b>Размещение</b>",
  "Каждый день до цели (например, 300) и только там, где реклама разрешена: бот в Telegram-группах, где его добавили админы, задания админам-партнёрам и ваши страницы через Postiz.",
  "",
  "📡 <b>Мониторинг и отчёты</b>",
  "Публикации по кампании, просмотры и ежедневный отчёт сюда.",
  "",
  "🧭 <b>Советник</b>",
  "/advisor — разговор с экспертом по недвижимости, ретритам, маркетингу и партнёрствам. Голосом спросили — голосом ответит. /client — подобрать сообщества под клиента.",
  "",
  "<b>Главное</b>",
  "/campaign — новая кампания · /campaigns — все кампании",
  "/capacity — ёмкость сети · /creport — отчёт за день",
  "/schedule — расписание · /cwatch — параметры мониторинга",
  "/recall — проверка полноты по ручному списку · /activity — порог активности",
  "/cstop all — остановить всё",
  "",
  "/ttqueue — видео в TikTok сам (подпись к видео: /ttqueue сейчас | текст) · /igqueue — фото в Instagram",
  "🤝 Ссылка для админов-партнёров: " + partnerInviteLink(),
  "➕ Добавить бота в группу: " + addBotUrl({ platform: "telegram", kind: "group" }),
  "➕ Добавить бота в канал: " + addBotUrl({ platform: "telegram", kind: "channel" }),
  "Всё остальное — кнопками в /panel.",
].join("\n");

const TT_HELP = "🎬 <b>Автопубликация в TikTok (ваш аккаунт через Postiz)</b>\n\nПришлите ВИДЕО (mp4, до 20 МБ) с подписью:\n<code>/ttqueue сейчас | Текст и #хештеги</code>\nили со временем:\n<code>/ttqueue 2026-11-25T19:00:00+01:00 | Текст</code>\n\nБот загрузит видео в Postiz, и пост выйдет сам в указанное время, без подтверждения на сайте. Проверить: /igstatus · отменить: /igcancel ID";

const TT_TOO_BIG = "⚠️ Видео больше 20 МБ — Telegram не отдаёт боту такие файлы.\nСожмите его (CapCut → Экспорт → 720p) или пришлите ссылку:\n<code>/ttqueue сейчас | https://…/video.mp4 | текст</code>";

function ttResultText(result: { ok: boolean; error?: string; job?: { channelName: string; scheduledAt: string; id: string } }) {
  if (result.ok && result.job)
    return "✅ <b>TikTok запланирован</b>\nАккаунт: " + escapeHtml(result.job.channelName) + "\nВремя: " + escapeHtml(result.job.scheduledAt) + "\nID: <code>" + escapeHtml(result.job.id) + "</code>\nPostiz опубликует сам. Проверить: /igstatus";
  if (result.error === "MEDIA_TOO_LARGE") return TT_TOO_BIG;
  return "⚠️ TikTok не запланирован: " + escapeHtml(result.error || "ошибка") + "\nПодсказка: /tthelp";
}

function commandOf(text: string) {
  const m = /^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), args: m[2].trim() } : null;
}

async function isControl(chatId: string, userId: string, chatType?: string) {
  const ids = controlIds();
  if (ids.has(chatId) || ids.has(userId)) return true;
  if (await isOwnersGroupAdmin(chatId, userId, chatType)) return true;
  return isOpenGroup(chatId, chatType);
}

function healthIcon(level: "ok" | "warning" | "error") {
  if (level === "ok") return "✅ ";
  if (level === "warning") return "⚠️ ";
  return "❌ ";
}

function taskStateIcon(state: string) {
  if (state === "done") return "✅";
  if (state === "failed") return "❌";
  if (state === "stopped") return "⏹";
  return "⏳";
}

function taskStateLabel(state: string) {
  if (state === "clarifying") return "жду уточнение";
  if (state === "running") return "ищу";
  if (state === "done") return "готово";
  if (state === "stopped") return "остановлено";
  if (state === "failed") return "ошибка";
  return state;
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
    [{ text: "📢 Новая кампания", callback_data: "menu:newcampaign" }, { text: "🗂 Мои кампании", callback_data: "menu:campaigns" }],
    [{ text: "📊 Отчёт за день", callback_data: "menu:creport" }, { text: "📈 Ёмкость сети", callback_data: "menu:capacity" }],
    [{ text: "🔎 Найти что угодно", callback_data: "menu:find" }, { text: "📣 Одно объявление", callback_data: "menu:advert" }],
    [{ text: "📥 Выгрузка в Excel", callback_data: "menu:export" }],
    [
      { text: "📋 Мои поиски", callback_data: "menu:tasks" },
      { text: "✅ Результаты", callback_data: "menu:results" },
    ],
    [
      { text: "📍 Что сейчас?", callback_data: "menu:status" },
      { text: "➕ Ещё", callback_data: "menu:more" },
    ],
    [{ text: "🖥 Открыть кабинет", url: dashboardUrl() }],
  ];
}

function moreMenuKeyboard(): Keyboard {
  return [
    [
      { text: "📊 Отчёт", callback_data: "menu:report" },
      { text: "🛰 Обновить данные", callback_data: "menu:scan" },
    ],
    [
      { text: "🌐 Источники", callback_data: "menu:sources" },
      { text: "✉️ Сообщения", callback_data: "menu:drafts" },
    ],
    [
      { text: "👥 Диалоги", callback_data: "menu:leads" },
      { text: "⚙️ Настройки", callback_data: "menu:settings" },
    ],
    [
      { text: "📢 Кампании", callback_data: "menu:campaigns" },
      { text: "👥 Группы и постинг", callback_data: "menu:groups" },
    ],
    [
      { text: "📣 Отчёт постинга", callback_data: "menu:posts" },
    ],
    [
      { text: "🩺 Проверка", callback_data: "menu:health" },
      { text: "⬅️ Назад", callback_data: "menu:panel" },
    ],
  ];
}

async function showPanel(chatId: string) {
  const task = await loadTask(chatId);
  const state = task
    ? "Сейчас: <b>" + escapeHtml(task.query.slice(0, 120)) + "</b>\n" + taskStateIcon(task.state) + " " + escapeHtml(taskStateLabel(task.state))
    : "Сейчас ничего не ищу.";

  await sendMessage(
    chatId,
    "✦ <b>AURELIUS</b>\n━━━━━━━━━━━━━━\n" +
      (await campaignSummary()) + "\n\n" +
      "🔎 " + state + "\n\n" +
      "<i>Отправьте голосовое с задачей или выберите действие.</i>",
    mainPanelKeyboard(),
  );
}

// First screen: a returning user picks «continue» (everything is kept in the database) or «new dialog».
async function showWelcome(chatId: string, rawName: string) {
  const userName = /^\d+$/.test(rawName) ? "" : rawName.replace(/^@/, "");
  const [task, campaigns] = await Promise.all([loadTask(chatId), listAll("campaigns")]);
  const hello = "✦ <b>AURELIUS</b>\n━━━━━━━━━━━━━━\n";
  if (!task && !campaigns.length) {
    await sendMessage(chatId, hello + "👋 Здравствуйте" + (userName ? ", " + escapeHtml(userName) : "") + "! Я AI-агент: нахожу сообщества в Facebook, Telegram, Instagram и TikTok, размещаю объявления там, где это разрешено, и присылаю отчёты.\n\n🎙 Начните с голосового: что рекламируем, где и на каких площадках.", mainPanelKeyboard());
    return;
  }
  await sendMessage(chatId, hello + "👋 С возвращением" + (userName ? ", " + escapeHtml(userName) : "") + "!\n\n" + (await campaignSummary()) + (task ? "\n🔎 Последний поиск: <b>" + escapeHtml(task.query.slice(0, 80)) + "</b>" : "") + "\n\n<i>Все кампании, поиски и база сообществ сохранены.</i>", [
    [{ text: "↩️ Продолжить", callback_data: "menu:panel" }, { text: "🆕 Новый диалог", callback_data: "menu:fresh" }],
    [{ text: "📥 Выгрузка в Excel", callback_data: "menu:export" }],
  ]);
}

async function sendExport(chatId: string) {
  await sendMessage(chatId, "📥 Готовлю Excel: база сообществ, журнал публикаций, размещения кампаний…");
  const day = new Date().toISOString().slice(0, 10);
  await sendDocument(chatId, "aurelius-" + day + ".xlsx", await fullExportXlsx(), "📥 AURELIUS · база сообществ, журнал публикаций и размещения кампаний");
  // CSV for Google Sheets (File → Import) and any other tool.
  await sendDocument(chatId, "aurelius-groups-" + day + ".csv", Buffer.from(groupsCsv(await listGroups())), "📄 База сообществ · CSV (Google Sheets: Файл → Импорт)");
}

async function showMoreMenu(chatId: string) {
  await sendMessage(
    chatId,
    "<b>Дополнительные функции</b>\nЗдесь отчёты, источники, сообщения и настройки.",
    moreMenuKeyboard(),
  );
}

async function diagnosticText(chatId: string, userId: string) {
  const health = await collectOperationalHealth();
  const lines = [
    "<b>AURELIUS · диагностика</b>",
    "",
    ...health.checks.map((item) => healthIcon(item.level) + "<b>" + escapeHtml(item.label) + "</b>: " + escapeHtml(item.detail)),
    "",
    "Control access: " + ((await isControl(chatId, userId)) ? "✅" : "❌"),
    "User ID: <code>" + escapeHtml(userId) + "</code>",
    "Chat ID: <code>" + escapeHtml(chatId) + "</code>",
    "Report chat: " + (health.telegram.reportChatId ? "<code>" + escapeHtml(health.telegram.reportChatId) + "</code>" : "—"),
    "Zero-cost: " + (health.ai.zeroCost ? "✅ on" : "⚠️ off"),
  ];
  return lines.join("\n");
}

async function identityText(message: any) {
  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  return [
    "<b>Telegram ID</b>",
    "User ID: <code>" + escapeHtml(userId) + "</code>",
    "Chat ID: <code>" + escapeHtml(chatId) + "</code>",
    "Chat type: " + escapeHtml(String(message.chat?.type || "unknown")),
    "Control access: " + ((await isControl(chatId, userId, String(message.chat?.type || ""))) ? "✅ YES" : "❌ NO"),
  ].join("\n");
}

// ---- Commands -------------------------------------------------------------------

async function handleCommand(chatId: string, userId: string, userName: string, cmd: string, args: string): Promise<BotResult> {
  switch (cmd) {
    case "start":
      await showWelcome(chatId, userName);
      return {};
    case "panel":
      await showPanel(chatId);
      return {};
    case "export":
      await sendExport(chatId);
      return {};

    case "postiz": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId, "⛔ Postiz доступен только владельцу и админам группы.");
        return {};
      }
      if (!postizConfigured()) {
        await sendMessage(chatId, "⚠️ Postiz не подключён. Откройте Settings → Agents / Developer → Public API и сохраните POSTIZ_API_KEY в Vercel.");
        return {};
      }
      try {
        const channels = await listPostizChannels();
        await sendLong(chatId, "<b>Postiz · подключённые аккаунты</b>\n" + (channels.length
          ? channels.map((c, i) => (i+1) + ". " + escapeHtml(c.name) + " · " + escapeHtml(c.identifier) +
            (c.disabled ? " · отключён" : " · доступен") + "\nID: <code>" + escapeHtml(c.id) + "</code>").join("\n\n")
          : "Нет подключённых аккаунтов. В Postiz подключите собственную страницу.") +
          "\n\nЧерновик: <code>/postizdraft ID | текст</code>. Никаких публикаций автоматически не будет.");
      } catch {
        await sendMessage(chatId, "⚠️ Postiz API недоступен. Проверьте ключ в Vercel и тариф.");
      }
      return {};
    }

    case "postizdraft": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId, "⛔ Черновик Postiz доступен только владельцу и админам группы.");
        return {};
      }
      const separator = args.indexOf("|");
      if (separator < 1) {
        await sendMessage(chatId, "Формат: <code>/postizdraft ID_аккаунта | точный текст</code>\nID получаете командой /postiz.");
        return {};
      }
      const integrationId = args.slice(0, separator).trim();
      const content = args.slice(separator+1).trim();
      const requestId = "tg-" + userId + "-" + Date.now().toString(36);
      const result = await createPostizDraft({ integrationId, content, requestId }).catch(() => ({ok:false,error:"POSTIZ_API_ERROR"}));
      await sendMessage(chatId, result.ok
        ? "✅ Создан черновик в Postiz, НЕ ОПУБЛИКОВАНО.\nPost ID: <code>" + escapeHtml(("postId" in result ? result.postId : "") || "") + "</code>\nПроверьте черновик в кабинете Postiz."
        : "⚠️ Черновик не создан: " + escapeHtml(result.error || "ошибка подключения"));
      return {};
    }

    case "ighelp": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId,"⛔ Только владелец и админы группы."); return {};
      }
      await sendMessage(chatId,"📸 <b>Автоматические публикации Instagram через Postiz</b>\n\n1. Пришлите ОДНУ фотографию с подписью:\n<code>/igqueue 2026-11-25T19:00:00+01:00 | Мой текст публикации</code>\n\n2. Или без фото, с публичной HTTPS-ссылкой:\n<code>/igqueue 2026-11-25T19:00:00+01:00 | https://example.com/photo.jpg | Мой текст</code>\n\nЭто подтверждённое задание в расписание: Postiz автоматически опубликует пост в указанный час. Нужны права на контент, собственный Instagram и медиа. Контроль: /igstatus. Отмена: /igcancel ID. Время пишите с часовым поясом +01:00 или +02:00.");
      return {};
    }
    case "igqueue": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId,"⛔ Instagram доступен только владельцу и админам группы."); return {};
      }
      const parts=args.split("|").map(x=>x.trim());
      if (parts.length !== 3) {
        await sendMessage(chatId,"📸 Пришлите фото с подписью /igqueue ДАТА_С_ПОЯСОМ | текст. Или команду /igqueue ДАТА | публичный_https_файл | текст. Подробно: /ighelp");
        return {};
      }
      const [scheduledAt,mediaUrl,...caption]=parts;
      const requestId="tgig-"+userId+"-"+Date.now().toString(36);
      await sendMessage(chatId,"⏳ Проверяю Instagram и ставлю фото в расписание Postiz…");
      const result=await scheduleInstagram({ requestId, ownerId:userId, mediaUrl, caption:caption.join(" | "), scheduledAt })
        .catch(()=>({ok:false,error:"INSTAGRAM_API_UNAVAILABLE",job:undefined}));
      await sendMessage(chatId,result.ok && result.job
        ? "✅ <b>Instagram запланирован автоматически</b>\nАккаунт: "+escapeHtml(result.job.channelName)+"\nДата: "+escapeHtml(result.job.scheduledAt)+"\nID: <code>"+escapeHtml(result.job.id)+"</code>\nЭто расписание, а не доказательство публикации. Проверить: /igstatus"
        : "⚠️ Instagram не запланирован: "+escapeHtml(result.error||"неизвестная ошибка")+"\nПроверьте /ighelp и настройки INSTAGRAM_AUTOPOST.");
      return {};
    }
    case "ttqueue": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId,"⛔ TikTok доступен только владельцу и админам группы."); return {};
      }
      const parts=args.split("|").map(x=>x.trim());
      if (parts.length < 3) { await sendMessage(chatId,TT_HELP); return {}; }
      const [scheduledAt,mediaUrl,...caption]=parts;
      await sendMessage(chatId,"⏳ Ставлю видео в расписание TikTok через Postiz…");
      const result=await scheduleInstagram({ platform:"tiktok", requestId:"tgtt-"+userId+"-"+Date.now().toString(36), ownerId:userId, mediaUrl, caption:caption.join(" | "), scheduledAt })
        .catch(()=>({ok:false,error:"TIKTOK_API_UNAVAILABLE",job:undefined}));
      await sendMessage(chatId,ttResultText(result));
      return {};
    }
    case "tthelp": {
      await sendMessage(chatId,TT_HELP); return {};
    }
    case "igstatus": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId,"⛔ Только владелец и админы группы."); return {};
      }
      let posts=await refreshInstagramJobs().catch(()=>null);
      const stale=!posts;
      posts ??=await listInstagramJobs();
      const rows=posts.slice(0,8).map(p=>"<code>"+escapeHtml(p.id)+"</code> · "+jobPlatform(p)+" · "+escapeHtml(p.channelName)+" · "+jobStatusRu(p.status)+
        "\n"+escapeHtml(p.scheduledAt)+(p.releaseURL ? "\n"+escapeHtml(p.releaseURL) : "")+(p.error ? "\nПричина: "+escapeHtml(p.error) : "")).join("\n\n");
      await sendMessage(chatId,"📊 <b>Postiz · Instagram, TikTok, Facebook</b>"+(stale?"\n⚠️ API статистики недоступен, показан журнал AURELIUS.":"")+
        "\n\n"+(rows||"Очередь пуста. /ighelp"));
      return {};
    }
    case "igcancel": {
      if (!(await isControl(chatId, userId))) {
        await sendMessage(chatId,"⛔ Только владелец и админы группы."); return {};
      }
      if (!/^(ig|tt)-[\w-]{8,80}$/.test(args)) {
        await sendMessage(chatId,"Укажите ID из /igstatus: <code>/igcancel ig-...</code> или <code>/igcancel tt-...</code>");return {};
      }
      const cancelled=await cancelInstagramJob(args).catch(()=>({ok:false,error:"POSTIZ_CANCEL_FAILED"}));
      await sendMessage(chatId,cancelled.ok?"⏹ Запланированная публикация отменена в Postiz.":"⚠️ Отмена не подтверждена: "+escapeHtml(cancelled.error||"ошибка"));
      return {};
    }

    case "health":
      await sendMessage(chatId, await diagnosticText(chatId, userId), mainPanelKeyboard());
      return {};

    case "tasks": {
      const tasks = (await listRecentResearchTasks(12)).filter((task) => task.chatId === chatId || task.ownerId === userId).slice(0, 8);
      if (!tasks.length) {
        await sendMessage(chatId, "Поисков пока нет. Нажмите «🔎 Найти» или просто напишите, что нужно найти.", mainPanelKeyboard());
        return {};
      }
      const lines = tasks.map((task, index) => {
        const mark = taskStateIcon(task.state);
        const found = task.counters.afterDedupe ? " · найдено " + task.counters.afterDedupe : "";
        return mark + " <b>" + (index + 1) + ". " + escapeHtml(task.query.slice(0, 120)) + "</b>" +
          "\n" + escapeHtml(taskStateLabel(task.state)) + found;
      });
      await sendLong(chatId, "<b>Мои последние поиски</b>\n\n" + lines.join("\n\n"), mainPanelKeyboard());
      return {};
    }

    case "results": {
      const task = await loadTask(chatId);
      if (!task) {
        await sendMessage(chatId, "Результатов пока нет. Нажмите «🔎 Найти» или просто напишите запрос.", mainPanelKeyboard());
        return {};
      }
      if (!task.results.length) {
        await sendMessage(chatId, statusText(task), statusKeyboard(task));
        return {};
      }
      const lines = task.results.slice(0, 8).map((row: any, index: number) => {
        const title = String(row?.title || row?.organization || row?.name || row?.domain || "Result " + (index + 1)).slice(0, 100);
        const rawUrl = String(row?.url || "");
        const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
        const status = String(row?.status || row?.verificationStatus || "");
        return (index + 1) + ". " + (url ? "<a href=\"" + escapeHtml(url) + "\">" + escapeHtml(title) + "</a>" : "<b>" + escapeHtml(title) + "</b>") + (status ? " · " + escapeHtml(status) : "");
      });
      const header = "<b>Вот что я нашёл</b>\n" +
        escapeHtml(task.query.slice(0, 220)) + "\n\n" +
        "Всего: <b>" + task.counters.afterDedupe + "</b> · подтверждено: <b>" + task.counters.matchingCriteria + "</b>" +
        (task.counters.needsReview ? " · проверить вручную: <b>" + task.counters.needsReview + "</b>" : "");
      await sendLong(chatId, header + "\n\n" + lines.join("\n"), [[{ text: "📍 Что сейчас?", callback_data: "menu:status" }, { text: "🖥 Открыть кабинет", url: dashboardUrl("?tab=tasks") }]]);
      return {};
    }

    case "help":
      await sendMessage(chatId, HELP, mainPanelKeyboard());
      return {};

    case "find":
    case "search": {
      if (!args) { await sendMessage(chatId, "Просто напишите одним сообщением, что нужно найти. Например: «инвесторы в Амстердаме для B2B SaaS»", mainPanelKeyboard()); return {}; }
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

    case "campaign":
    case "campaigns":
    case "keywords":
    case "cq":
    case "cx":
    case "cstop":
    case "capacity":
    case "monitor":
    case "creport":
    case "schedule":
    case "cwatch":
    case "recall":
    case "activity":
      return handleCampaignCommand(chatId, userId, cmd, args);

    case "groups":
    case "post":
    case "queue":
    case "posts":
      return handleGroupCommand(chatId, cmd, args, userName);

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
  if (!(await isControl(chatId, userId, String(query.message?.chat?.type || "")))) { await answerCallback(query.id, "Нет доступа"); return {}; }
  const [kind, action, id] = data.split(":");
  if (kind === "adv") { await answerCallback(query.id, "✓"); await handleAdvisorCallback(chatId, action); return {}; }
  if (kind === "menu") {
    await answerCallback(query.id, "✓");
    if (action === "find") {
      await tgForceReply(chatId, "🔎 Что найти? Напишите запрос обычным сообщением.");
      return {};
    }
    if (action === "advert") return startAdWizard(chatId, userId);
    if (action === "fresh") {
      await startFreshDialog(chatId);
      await sendMessage(chatId, "🆕 <b>Новый диалог</b>\nПрошлые кампании и результаты сохранены, их можно открыть в «Мои кампании».\n\nЧто делаем? Отправьте голосовое или выберите действие.", mainPanelKeyboard());
      return {};
    }
    if (action === "export") {
      await sendExport(chatId);
      return {};
    }
    if (action === "newcampaign") {
      await promptNewCampaign(chatId);
      return {};
    }
    if (action === "more") {
      await showMoreMenu(chatId);
      return {};
    }
    if (action === "panel") {
      await showPanel(chatId);
      return {};
    }
    if (action === "groups") {
      await sendMessage(chatId, "<b>Группы и постинг</b>\n\n<code>/groups Испания, Барселона, недвижимость</code> — найти группы (таблица + Excel)\n<code>/post текст</code> — опубликовать ботом там, где его добавили админы, или поставить в очередь\n/queue — следующий пост для ручной публикации со своего аккаунта\n/posts — отчёт за сегодня");
      return {};
    }
    if (["status", "tasks", "results", "report", "scan", "sources", "drafts", "leads", "settings", "health", "posts", "queue", "campaigns", "capacity", "creport"].includes(action)) {
      return handleCommand(chatId, userId, by, action, "");
    }
    return {};
  }
  if (kind === "aw") return adWizardButton(chatId, userId, query.id, action, id);
  if (kind === "gp") return handleGroupCallback(query, action, id, by);
  if (kind === "cp") return handleCampaignCallback(query, action, id, by);
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
  // The bot was added to (or removed from) a group or channel.
  if (update?.my_chat_member) { await handleMyChatMember(update.my_chat_member); return {}; }
  const message = update?.message || update?.edited_message;
  // Partners confirm a publication with /proof; they are not owners, so this comes before the access check.
  if (message?.text && /^\/proof(@\w+)?\s/i.test(message.text) && !message.from?.is_bot) {
    await handleProof(String(message.chat?.id || ""), String(message.from?.id || ""), String(message.text).replace(/^\/proof(@\w+)?\s*/i, ""));
    return {};
  }
  // Publisher Network: any admin can connect their community in a private chat (owner approves).
  const join = message?.text && message.chat?.type === "private" && !message.from?.is_bot ? /^\/(join|leave)(@\w+)?(?:\s+([\s\S]*))?$|^\/start(?:@\w+)?\s+partner\b/i.exec(String(message.text).trim()) : null;
  if (join) {
    const who = message.from?.username ? "@" + message.from.username : message.from?.first_name || String(message.from?.id);
    if (join[1]?.toLowerCase() === "leave") await handleLeave(String(message.chat.id), String(message.from.id), join[3] || "");
    else await handleJoin(String(message.chat.id), String(message.from.id), who, join[3] || "");
    return {};
  }
  // Owner's voice message → campaign task (TZ 1.2: voice control).
  const voice = message?.voice || message?.audio;
  if (voice?.file_id && !message.from?.is_bot) {
    const chatId = String(message.chat?.id || "");
    const userId = String(message.from?.id || "");
    if (!(await isControl(chatId, userId, String(message.chat?.type || "")))) return {};
    if (await advisorMode(chatId)) return handleAdvisorVoice(chatId, voice.file_id);
    return handleVoice(chatId, voice.file_id, userId);
  }
  // Telegram owner photo with explicit time + caption -> Postiz media upload and
  // A video (or mp4 file) captioned /ttqueue TIME | text: scheduled on the owner's own TikTok via Postiz.
  const ttVideo = message?.video || (/^video\/mp4$/i.test(String(message?.document?.mime_type || "")) ? message.document : null);
  if (ttVideo && /^\/ttqueue(?:@\w+)?\s/i.test(String(message.caption || "")) && !message.from?.is_bot) {
    const chatId=String(message.chat?.id||"");
    const userId=String(message.from?.id||"");
    if (!(await isControl(chatId, userId, String(message.chat?.type || "")))) return {};
    const parts=String(message.caption).replace(/^\/ttqueue(?:@\w+)?\s*/i,"").split("|").map((x:string)=>x.trim());
    if(parts.length<2){ await sendMessage(chatId,TT_HELP); return {}; }
    if(Number(ttVideo.file_size||0)>20*1024*1024){ await sendMessage(chatId,TT_TOO_BIG); return {}; }
    const requestId="tgtt-"+userId+"-"+String(message.message_id||Date.now());
    await sendMessage(chatId,"⏳ Загружаю видео в Postiz и ставлю публикацию в TikTok…");
    return { background:async()=>{
      const result=await scheduleInstagram({platform:"tiktok",requestId,ownerId:userId,telegramFileId:String(ttVideo.file_id||""),scheduledAt:parts[0],caption:parts.slice(1).join(" | ")})
        .catch(()=>({ok:false,error:"TIKTOK_API_UNAVAILABLE",job:undefined}));
      await sendMessage(chatId,ttResultText(result));
    }};
  }

  // one scheduled Instagram feed post. Does not require an additional n8n cron.
  if (message?.photo && /^\/igqueue(?:@\w+)?\s/i.test(String(message.caption || "")) && !message.from?.is_bot) {
    const chatId=String(message.chat?.id||"");
    const userId=String(message.from?.id||"");
    if (!(await isControl(chatId, userId, String(message.chat?.type || "")))) return {};
    const parts=String(message.caption).replace(/^\/igqueue(?:@\w+)?\s*/i,"").split("|").map((x:string)=>x.trim());
    if(parts.length!==2){
      await sendMessage(chatId,"Формат подписи фото: /igqueue 2026-11-25T19:00:00+01:00 | Текст поста");return {};
    }
    const photo=message.photo[message.photo.length-1];
    const fileId=String(photo?.file_id||"");
    const requestId="tgig-"+userId+"-"+String(message.message_id||Date.now());
    await sendMessage(chatId,"⏳ Загружаю вашу фотографию в Postiz и ставлю Instagram-публикацию в расписание…");
    return { background:async()=>{
      const result=await scheduleInstagram({requestId,ownerId:userId,telegramFileId:fileId,scheduledAt:parts[0],caption:parts[1]})
        .catch(()=>({ok:false,error:"INSTAGRAM_API_UNAVAILABLE",job:undefined}));
      await sendMessage(chatId,result.ok && result.job
        ? "✅ <b>Instagram запланирован в Postiz</b>\nАккаунт: "+escapeHtml(result.job.channelName)+"\nДата: "+escapeHtml(result.job.scheduledAt)+"\nID: <code>"+escapeHtml(result.job.id)+"</code>\nПроверить: /igstatus"
        : "⚠️ Запланировать не удалось: "+escapeHtml(result.error||"ошибка")+"\nЕсли ответ не подтверждён, проверьте Postiz перед повторением.");
    }};
  }

  // A photo whose caption starts with /campaign: the campaign carries that photo.
  if (message?.photo && /^\/campaign(@\w+)?\b/i.test(String(message.caption || "")) && !message.from?.is_bot) {
    const chatId = String(message.chat?.id || "");
    const userId = String(message.from?.id || "");
    if (!(await isControl(chatId, userId, String(message.chat?.type || "")))) return {};
    const photos = Array.isArray(message.photo) ? message.photo : [];
    return handleCampaignCommand(chatId, userId, "campaign", String(message.caption).replace(/^\/campaign(@\w+)?\s*/i, ""), photos[photos.length - 1]?.file_id);
  }
  // A photo whose caption starts with /post: the post goes out with that photo.
  if (message?.photo && /^\/post(@\w+)?\b/i.test(String(message.caption || "")) && !message.from?.is_bot) {
    const chatId = String(message.chat?.id || "");
    const userId = String(message.from?.id || "");
    if (!(await isControl(chatId, userId, String(message.chat?.type || "")))) return {};
    const photos = Array.isArray(message.photo) ? message.photo : [];
    const by = message.from?.username ? "@" + message.from.username : message.from?.first_name || userId;
    return handleGroupCommand(chatId, "post", String(message.caption).replace(/^\/post(@\w+)?\s*/i, ""), by, photos[photos.length - 1]?.file_id);
  }
  // Owners and group admins may attach an image with its ad text while the ad wizard is active.
  if (message?.photo && !message.from?.is_bot) {
    const ownerChat = String(message.chat?.id || "");
    const ownerId = String(message.from?.id || "");
    if (await isControl(ownerChat, ownerId, String(message.chat?.type || ""))) {
      const photos = Array.isArray(message.photo) ? message.photo : [];
      const result = await advanceAdWizard(ownerChat, ownerId, String(message.caption || ""), photos[photos.length - 1]?.file_id);
      if (result) return result;
    }
  }
  if (!message?.text || message.from?.is_bot) return {};
  const chatId = String(message.chat?.id || "");
  const userId = String(message.from?.id || "");
  const userName = message.from?.username ? "@" + message.from.username : message.from?.first_name || userId;
  const command = commandOf(message.text);

  // /id is always safe: it only returns IDs from the caller's own update.
  if (command?.cmd === "id") {
    await sendMessage(chatId, await identityText(message));
    return {};
  }

  // For bot admins whose original my_chat_member event was missed by the
  // webhook: register an owned group after checking Telegram permissions.
  if (command?.cmd === "connect") {
    if (message.chat?.type === "private") {
      await sendMessage(chatId, "Откройте вашу тестовую группу и отправьте /connect прямо в ней.");
      return {};
    }
    if (!controlIds().has(userId) && !(await isOwnersGroupAdmin(chatId, userId, String(message.chat?.type || "")))) {
      await sendMessage(chatId, "⛔ Только владелец и админы группы могут подключать группы.");
      return {};
    }
    const result = await registerOwnedTelegramGroup(message.chat, userId);
    await sendMessage(chatId, result.message + (result.group ? "\nГруппа: " + escapeHtml(result.group.name) + "\nChat ID: <code>" + escapeHtml(String(result.group.chatId || "")) + "</code>" : ""));
    return {};
  }

  const control = await isControl(chatId, userId, String(message.chat?.type || ""));
  if (!control && message.chat?.type === "private" && command && ["panel", "find", "search", "status", "tasks", "results", "report", "scan", "objects", "investors", "matches", "drafts", "leads", "sources", "watch", "comments", "stop", "forget", "meet", "settings", "health", ...GROUP_COMMANDS, ...CAMPAIGN_COMMANDS, ...ADVISOR_COMMANDS].includes(command.cmd)) {
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
    if (command?.cmd === "ad" || command?.cmd === "advert") return startAdWizard(chatId, userId);
    if (command?.cmd === "cancel" && await cancelAdWizard(chatId, userId)) return {};
    if (command && ADVISOR_COMMANDS.includes(command.cmd)) return handleAdvisorCommand(chatId, command.cmd, command.args);
    if (command) return handleCommand(chatId, userId, userName, command.cmd, command.args);
    // The wizard is per chat and per person, so it works the same in a group.
    const wizard = await advanceAdWizard(chatId, userId, String(message.text));
    if (wizard) return wizard;
    const intentText = addressedText(message);
    if (intentText && isAdPostingIntent(intentText) && !(await advisorMode(chatId))) return startAdWizard(chatId, userId);
    const answer = await maybeAnswer(chatId, String(message.text), userId);
    if (answer) return answer;
    if (await advisorMode(chatId)) {
      const asked = addressedText(message);
      return asked ? handleAdvisorText(chatId, asked) : {};
    }
    return handleResearchText(message, chatId, userId);
  }

  // Strangers in groups are ignored; only private chats start a qualification dialogue.
  if (message.chat?.type !== "private") return {};
  return handleInbound(message);
}

