import { recordGroupSearch } from "@/lib/memory";
import { dashboardUrl } from "@/lib/scout/config";
import { ADS_LABEL, PLATFORM_LABEL, STATUS_LABEL, adminLetter, findGroups, listGroups, updateGroup, groupsXlsx, listQueue, markQueued, postViaBot, postingSummary, postingTargets, queueManual } from "@/lib/scout/groups";
import { deleteValue, getValue, setValue } from "@/lib/scout/store";
import { answerCallback, editMessage, sendDocument, sendLong, sendMessage, type Keyboard } from "@/lib/scout/telegram";
import { escapeHtml, randomId } from "@/lib/scout/text";
import type { GroupCard, GroupStatus, Platform, QueueItem } from "@/lib/scout/groups";
import { loadSettings } from "@/lib/scout/config";

// Telegram commands for the group finder and compliant posting:
//   /groups Испания, Барселона, недвижимость — find groups, get a table + Excel
//   /post <текст> (or a photo with caption /post …) — preview, then send via the bot or queue for manual posting
//   /queue — next post to publish by hand from your own account
//   /posts — today's posting report
//   /requests [telegram|facebook|instagram|tiktok] — next community to ask: personal letter + one-tap buttons

type Result = { background?: () => Promise<void> };

export const GROUP_COMMANDS = ["groups", "post", "queue", "posts", "requests"];

function groupsPageUrl() {
  return dashboardUrl().replace(/\/scout$/, "/groups");
}

export function parseGroupsArgs(args: string) {
  const parts = args.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { country: parts[0], city: parts[1], topic: parts.slice(2).join(", ") };
  if (parts.length === 2) return { country: "", city: parts[0], topic: parts[1] };
  return { country: "", city: "", topic: parts[0] || "" };
}

export async function handleGroupCommand(chatId: string, cmd: string, args: string, by: string, photo?: string): Promise<Result> {
  if (cmd === "groups") {
    const input = parseGroupsArgs(args);
    if (!input.topic) {
      await sendMessage(chatId, "Укажите страну, город и любую тему через запятую.\nНапример: <code>/groups Испания, Валенсия, ремонт автомобилей</code>");
      return {};
    }
    await sendMessage(chatId, "🔎 Ищу группы Telegram и Facebook, публичные профили Instagram и TikTok: <b>" + escapeHtml([input.topic, input.city, input.country].filter(Boolean).join(" · ")) + "</b>. Любая тема или «все тематики».");
    return {
      background: async () => {
        const result = await findGroups(input, Date.now() + 200_000);
        await recordGroupSearch({ query: [input.topic, input.city, input.country].filter(Boolean).join(" · "), origin: "telegram", found: result.found, added: result.added, notes: result.notes }).catch(() => undefined);
        const top = result.found.slice(0, 15).map((g, i) => (i + 1) + ". " + ({ telegram: "✈️ ", facebook: "📘 ", instagram: "📸 ", tiktok: "🎵 " } as Record<string, string>)[g.platform] + "<a href=\"" + escapeHtml(g.url) + "\">" + escapeHtml(g.name.slice(0, 60)) + "</a>" +
          (g.members ? " · " + g.members.toLocaleString("ru-RU") : "") + " · реклама: " + ADS_LABEL[g.ads] + (g.adminContact ? " · " + escapeHtml(g.adminContact) : ""));
        const head = "<b>Найдено публичных площадок: " + result.found.length + "</b> (новых " + result.added + ")" + (result.notes.length ? "\n⚠️ " + escapeHtml(result.notes.join(" ")) : "");
        await sendLong(chatId, head + (top.length ? "\n\n" + top.join("\n") : ""), [[{ text: "🖥 Открыть таблицу групп", url: groupsPageUrl() }]]);
        if (result.found.length) await sendDocument(chatId, "groups-" + new Date().toISOString().slice(0, 10) + ".xlsx", await groupsXlsx(result.found), "Таблица групп (Excel)");
      },
    };
  }

  if (cmd === "post") {
    const text = args.trim();
    if (!text) {
      await sendMessage(chatId, "Напишите текст объявления после команды: <code>/post Продаётся квартира…</code>\nМожно отправить фото с подписью, которая начинается с /post.");
      return {};
    }
    const id = randomId("gpd").slice(-12);
    await setValue("gp-draft:" + id, { text, photo }, 6 * 3600);
    const targets = await postingTargets();
    const keyboard: Keyboard = [
      ...(targets.length ? [[{ text: "📣 Отправить ботом в " + targets.length + " групп", callback_data: "gp:send:" + id }]] : []),
      [{ text: "📝 В очередь для ручной публикации", callback_data: "gp:queue:" + id }],
      [{ text: "✖️ Отмена", callback_data: "gp:cancel:" + id }],
    ];
    await sendMessage(chatId, "<b>Предпросмотр поста</b>" + (photo ? " (с фото)" : "") + "\n\n" + escapeHtml(text.slice(0, 3000)) +
      "\n\nБот публикует только в группах, куда его добавили админы и где включён постинг: <b>" + targets.length + "</b>." +
      "\nОстальные группы (и все Facebook) — через очередь: вы публикуете сами, по одному нажатию.", keyboard);
    return {};
  }

  if (cmd === "requests") {
    await showNextRequest(chatId, platformArg(args));
    return {};
  }

  if (cmd === "queue") {
    await showNextQueued(chatId);
    return {};
  }

  if (cmd === "posts") {
    const s = await postingSummary();
    await sendMessage(chatId, "<b>Публикации сегодня</b>\nБотом: <b>" + s.today.bot + "</b>\nВручную: <b>" + s.today.manual + "</b>\nОшибок: " + s.today.failed +
      "\nВ очереди: " + s.queuePending +
      "\n\n<b>База групп</b>: " + s.groups.total + " (Telegram " + s.groups.telegram + ", Facebook " + s.groups.facebook + ")\nБот публикует в: " + s.groups.botReady + "\nПлатных размещений: " + s.groups.paid,
      [[{ text: "🖥 Журнал и таблица", url: groupsPageUrl() }]]);
    return {};
  }
  return {};
}

function queueText(item: QueueItem, left: number) {
  return "<b>Опубликуйте в:</b> " + escapeHtml(item.groupName) + " (" + PLATFORM_LABEL[item.platform] + ")" +
    "\nОсталось в очереди: " + left + "\n\nСкопируйте текст ниже, откройте группу и опубликуйте со своего аккаунта:\n\n<code>" + escapeHtml(item.text.slice(0, 3000)) + "</code>" +
    (item.photoUrl ? "\n\nФото: " + escapeHtml(item.photoUrl) : "");
}

async function showNextQueued(chatId: string) {
  const pending = (await listQueue()).filter((q) => q.status === "pending");
  const item = pending[0];
  if (!item) { await sendMessage(chatId, "Очередь пуста ✅"); return; }
  await sendMessage(chatId, queueText(item, pending.length), [
    ...(item.url ? [[{ text: "🔗 Открыть группу", url: item.url }]] : []),
    [{ text: "✅ Опубликовал", callback_data: "gp:done:" + item.id }, { text: "⏭ Пропустить", callback_data: "gp:skip:" + item.id }],
  ]);
}

const PLATFORMS: Platform[] = ["telegram", "facebook", "instagram", "tiktok"];
const RQ_STATUS: Record<string, [GroupStatus, string]> = { rqsent: ["contacted", "📨 Запрос отправлен"], rqreply: ["replied", "💬 Админ ответил"], rqok: ["free", "✅ Разрешил — кампании будут публиковать сюда"], rqno: ["declined", "✖️ Отказ"] };

function platformArg(args: string): Platform | "" {
  const a = args.trim().toLowerCase();
  if (/^(tg|tele|телег)/.test(a)) return "telegram";
  if (/^(fb|face|фейс)/.test(a)) return "facebook";
  if (/^(ig|insta|инст)/.test(a)) return "instagram";
  if (/^(tt|tik|тик)/.test(a)) return "tiktok";
  return "";
}

// Communities nobody has written to yet, biggest first (bot-connected ones need no request).
async function pendingRequests(platform: Platform | "") {
  return (await listGroups()).filter((g) => g.status === "new" && !g.botConnected && g.ads !== "forbidden" && g.activity !== "inactive" && (!platform || g.platform === platform)).sort((a, b) => (b.members || 0) - (a.members || 0));
}

async function showNextRequest(chatId: string, platform: Platform | "", skip = 0) {
  const list = await pendingRequests(platform);
  const g = list[skip];
  if (!g) { await sendMessage(chatId, skip ? "Это был последний запрос в списке ✅ /requests — начать сначала." : "Все запросы отправлены ✅ Новые сообщества появятся после следующего поиска."); return; }
  const letter = adminLetter(g, "free", await loadSettings());
  const pf = String(PLATFORMS.indexOf(platform as Platform) + 1);
  await sendMessage(chatId, "<b>Запрос админу</b> " + (skip + 1) + " из " + list.length + "\n" + PLATFORM_LABEL[g.platform] + " · <a href=\"" + escapeHtml(g.url) + "\">" + escapeHtml(g.name.slice(0, 80)) + "</a>" + (g.members ? " · " + g.members.toLocaleString("ru-RU") : "") + " · язык " + letter.lang +
    "\n\nСкопируйте письмо, откройте чат админа и отправьте со своего аккаунта:\n\n<code>" + escapeHtml(letter.text) + "</code>", [
    [{ text: "✉️ Написать админу", url: letter.contactUrl }, ...(letter.joinUrl ? [{ text: "🚪 Вступить", url: letter.joinUrl }] : [])],
    [{ text: "📨 Отправил", callback_data: "gp:rqsent:" + g.id }, { text: "⏭ Следующий", callback_data: "gp:rqnext:" + pf + "." + (skip + 1) }],
  ]);
}

function requestButtons(g: GroupCard): Keyboard {
  return [[{ text: "💬 Ответил", callback_data: "gp:rqreply:" + g.id }, { text: "✅ Разрешил", callback_data: "gp:rqok:" + g.id }, { text: "✖️ Отказ", callback_data: "gp:rqno:" + g.id }]];
}

export async function handleGroupCallback(query: any, action: string, id: string, by: string): Promise<Result> {
  const chatId = String(query.message?.chat?.id || "");
  const messageId = Number(query.message?.message_id || 0);
  if (action === "rqnext") {
    const [pf, skip] = id.split(".");
    await answerCallback(query.id, "Следующий");
    await showNextRequest(chatId, PLATFORMS[Number(pf) - 1] || "", Math.max(0, Number(skip) || 0));
    return {};
  }
  if (RQ_STATUS[action]) {
    const [status, label] = RQ_STATUS[action];
    const g = await updateGroup(id, { status }, by);
    await answerCallback(query.id, g ? label : "Сообщество не найдено");
    if (!g) return {};
    // The message becomes a status line with the next-step buttons until the admin's answer is recorded.
    if (messageId) await editMessage(chatId, messageId, label + ": " + escapeHtml(g.name) + " — " + escapeHtml(by) + "\nСтатус: " + (STATUS_LABEL[g.status] || g.status), ["contacted", "replied"].includes(status) ? requestButtons(g) : undefined);
    if (action === "rqsent") await showNextRequest(chatId, "");
    return {};
  }
  if (action === "done" || action === "skip") {
    const item = await markQueued(id, action === "done" ? "published" : "skipped", by);
    await answerCallback(query.id, item ? (action === "done" ? "Записал в журнал" : "Пропущено") : "Уже отмечено");
    if (item && messageId) await editMessage(chatId, messageId, (action === "done" ? "✅ Опубликовано: " : "⏭ Пропущено: ") + escapeHtml(item.groupName) + " — " + escapeHtml(by));
    await showNextQueued(chatId);
    return {};
  }
  if (action === "report") {
    await answerCallback(query.id, "✓");
    return handleGroupCommand(chatId, "posts", "", by);
  }
  const draft = await getValue<{ text: string; photo?: string }>("gp-draft:" + id);
  if (!draft) { await answerCallback(query.id, "Предпросмотр устарел, отправьте /post заново"); return {}; }
  await deleteValue("gp-draft:" + id);
  if (action === "cancel") {
    await answerCallback(query.id, "Отменено");
    if (messageId) await editMessage(chatId, messageId, "✖️ Пост отменён.");
    return {};
  }
  if (action === "queue") {
    const result = await queueManual(draft.text, "all");
    await answerCallback(query.id, "Готово");
    if (messageId) await editMessage(chatId, messageId, "📝 " + escapeHtml(result.message));
    if (result.added) await showNextQueued(chatId);
    return {};
  }
  if (action === "send") {
    await answerCallback(query.id, "Публикую…");
    if (messageId) await editMessage(chatId, messageId, "📣 Публикую через бота… Отчёт придёт сюда.");
    return {
      background: async () => {
        const result = await postViaBot(draft.text, draft.photo, by);
        await sendMessage(chatId, "📣 " + escapeHtml(result.message), [[{ text: "📊 Отчёт за сегодня", callback_data: "gp:report:x" }]]);
      },
    };
  }
  return {};
}
