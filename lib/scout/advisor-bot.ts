import { askAdvisor, resetAdvisor, speak } from "@/lib/advisor";
import { transcribeTelegramVoice } from "@/lib/scout/campaigns";
import { CLIENT_PROFILE, runProfileBatch } from "@/lib/scout/client-profile";
import { deleteValue, getValue, setValue } from "@/lib/scout/store";
import { escapeHtml } from "@/lib/scout/text";
import { sendLong, sendMessage, sendVoice, tgCall, type Keyboard } from "@/lib/scout/telegram";

// Telegram side of the advisor: /advisor turns on a conversation mode for the chat. In that
// mode every text is a question; every voice message gets a text answer and a voice answer.

type Result = { background?: () => Promise<void> };
export const ADVISOR_COMMANDS = ["advisor", "sovet", "ask", "client"];
const MODE_TTL = 7 * 86_400;
const keyboard: Keyboard = [[{ text: "🧹 Новая тема", callback_data: "adv:reset" }, { text: "✖️ Выйти", callback_data: "adv:off" }]];

export async function advisorMode(chatId: string) {
  return Boolean(await getValue<string>("adv-mode:" + chatId));
}

async function reply(chatId: string, question: string, voice: boolean) {
  await tgCall("sendChatAction", { chat_id: chatId, action: voice ? "record_voice" : "typing" });
  const answer = await askAdvisor("tg:" + chatId, question, { voice, deadlineAt: Date.now() + 200_000 });
  await sendLong(chatId, escapeHtml(answer.reply), keyboard);
  if (voice && answer.ok) {
    const mp3 = await speak(answer.reply);
    if (mp3) await sendVoice(chatId, mp3);
  }
}

export async function handleAdvisorCommand(chatId: string, cmd: string, args: string): Promise<Result> {
  if (cmd === "client") {
    await sendMessage(chatId, "🔎 <b>Подбор сообществ под клиента</b>\n" + escapeHtml(CLIENT_PROFILE.summary) + "\n\nИщу в Telegram, Facebook, Instagram, TikTok: недвижимость, ретриты и практики, партнёры и инвесторы, плюс смежные аудитории. Это займёт 3–4 минуты; дальше база пополняется сама каждый день.");
    return { background: async () => {
      const r = await runProfileBatch(Date.now() + 230_000);
      await sendMessage(chatId, "✅ Готово: " + r.runs + " запросов, новых сообществ " + r.added + ". Всего в базе " + r.total + ".\nПройдено " + r.cursor + " из " + r.planSize + " тем × регионов; остальные пройдут по расписанию. Ещё порцию: /client");
    } };
  }
  if (/^(off|выход|стоп)$/i.test(args.trim())) {
    await deleteValue("adv-mode:" + chatId);
    await sendMessage(chatId, "Режим советника выключен. Вернуться: /advisor");
    return {};
  }
  await setValue("adv-mode:" + chatId, "1", MODE_TTL);
  if (args.trim()) return { background: () => reply(chatId, args.trim(), false) };
  await sendMessage(chatId, "🧭 <b>Советник AURELIUS</b>\nНедвижимость и инвестиции · ретриты и духовный бизнес · маркетинг и продвижение в сообществах · партнёрства.\n\nСпросите текстом или <b>голосовым</b>: на голос отвечу и текстом, и голосом. Я помню нашу беседу.", keyboard);
  return {};
}

export async function handleAdvisorText(chatId: string, text: string): Promise<Result> {
  return { background: () => reply(chatId, text, false) };
}

export async function handleAdvisorVoice(chatId: string, fileId: string): Promise<Result> {
  return { background: async () => {
    const voice = await transcribeTelegramVoice(fileId);
    if (!voice.ok) { await sendMessage(chatId, "⚠️ " + escapeHtml(voice.message)); return; }
    await sendMessage(chatId, "🎙 <i>" + escapeHtml(voice.text.slice(0, 1500)) + "</i>");
    await reply(chatId, voice.text, true);
  } };
}

export async function handleAdvisorCallback(chatId: string, action: string) {
  if (action === "off") { await deleteValue("adv-mode:" + chatId); await sendMessage(chatId, "Режим советника выключен. Вернуться: /advisor"); }
  if (action === "reset") { await resetAdvisor("tg:" + chatId); await sendMessage(chatId, "🧹 Начали с чистого листа. О чём поговорим?"); }
}

