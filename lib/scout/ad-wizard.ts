import { campaignCard } from "@/lib/scout/campaigns-bot";
import { createCampaign, type Campaign } from "@/lib/scout/campaigns";
import { deleteValue, getValue, putOne, setValue } from "@/lib/scout/store";
import { answerCallback, sendLong, sendMessage, type Keyboard } from "@/lib/scout/telegram";
import { escapeHtml, nowIso } from "@/lib/scout/text";
import type { Platform } from "@/lib/scout/groups";

// An owner-only advertising intake. Nothing is published until the owner
// explicitly approves the campaign and a permitted placement is available.
type Stage = "region" | "adText" | "platforms";
type Draft = {
  stage: Stage;
  ownerId: string;
  region?: string;
  adText?: string;
  photo?: string;
};
type Result = { background?: () => Promise<void> };

const TTL = 24 * 60 * 60;
const KEY = (chatId: string, userId: string) => "advert-wizard:" + chatId + ":" + userId;
const CANCEL: Keyboard = [[{ text: "✖️ Отменить", callback_data: "aw:cancel:x" }]];
const PLATFORM_BUTTONS: Keyboard = [
  [
    { text: "✈️ Telegram", callback_data: "aw:platforms:tg" },
    { text: "📘 Facebook", callback_data: "aw:platforms:fb" },
  ],
  [
    { text: "✈️ Telegram + 📘 Facebook", callback_data: "aw:platforms:tgfb" },
  ],
  [{ text: "🌐 Все 4 платформы", callback_data: "aw:platforms:all" }],
  ...CANCEL,
];
const LABELS: Record<Platform, string> = {
  telegram: "Telegram", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok",
};

export function isAdPostingIntent(text: string) {
  const t = text.toLowerCase();
  const action = /размест|размещ|опублику|публику|розміст|опубліку|пошир|(?:^|\s)(?:publish|post|publicar)\b/iu.test(t);
  const advert = /объявлен|оголошен|реклам|анонс|(?:^|\s)пост(?:\s|[.,!?:]|$)|\badvert(?:isement)?\b|\bad\b|\banuncio\b/iu.test(t);
  return action && advert;
}

export function platformChoice(value: string): Platform[] {
  const t = value.trim().toLowerCase();
  if (/^(all|все|всі|всё|todos)$/.test(t)) return ["telegram", "facebook", "instagram", "tiktok"];
  const platforms: Platform[] = [];
  if (/telegram|телеграм|телегр|тг\b|tg\b/i.test(t)) platforms.push("telegram");
  if (/facebook|фейсбук|фейсб|фб\b|fb\b/i.test(t)) platforms.push("facebook");
  if (/instagram|інстаграм|инстаграм|инст\b|\big\b/i.test(t)) platforms.push("instagram");
  if (/tiktok|tik tok|тикток|тікто|тик-ток/i.test(t)) platforms.push("tiktok");
  return platforms;
}

export async function startAdWizard(chatId: string, ownerId: string): Promise<Result> {
  await setValue(KEY(chatId, ownerId), { stage: "region", ownerId } satisfies Draft, TTL);
  await sendMessage(chatId, "📣 <b>Размещение объявления · 1/3</b>\n\nГде искать подходящие сообщества? Напишите город и страну.\n\nНапример: <code>Валенсия, Испания</code>\n\nОбъявление пока никуда не отправляется.", CANCEL);
  return {};
}

export async function cancelAdWizard(chatId: string, ownerId: string): Promise<boolean> {
  const draft = await getValue<Draft>(KEY(chatId, ownerId));
  if (!draft) return false;
  await deleteValue(KEY(chatId, ownerId));
  await sendMessage(chatId, "✖️ Подготовка объявления отменена. Никаких публикаций не было.");
  return true;
}

function platformQuestion(chatId: string): Promise<unknown> {
  return sendMessage(chatId, "📣 <b>Размещение объявления · 3/3</b>\n\nНа каких площадках искать сообщества?\n\nВыберите кнопку или напишите: Telegram, Facebook, Instagram, TikTok.\n\nПубликации возможны только с разрешения владельцев площадок.", PLATFORM_BUTTONS);
}

async function finish(chatId: string, ownerId: string, draft: Draft, platforms: Platform[]): Promise<Result> {
  await deleteValue(KEY(chatId, ownerId));
  await sendMessage(chatId, "🧠 Формирую черновик рекламной кампании. Публикация не запущена.");
  return {
    background: async () => {
      try {
        const prompt = "Разместить рекламное объявление. Регион: " + draft.region
          + ". Площадки: " + platforms.map((p) => LABELS[p]).join(", ")
          + ".\nТочный текст объявления:\n" + draft.adText;
        const { campaign } = await createCampaign(prompt, "text", ownerId, draft.photo);
        // Never let an AI paraphrase or alter the owner's ad, price, contacts,
        // target geography, selected platforms or omit the preview gate.
        const reviewed: Campaign = {
          ...campaign,
          region: draft.region || "",
          adText: draft.adText || "",
          platforms,
          photo: draft.photo,
          questions: [],
          updatedAt: nowIso(),
        };
        await putOne("campaigns", reviewed);
        await sendLong(chatId, "✅ <b>Черновик готов — НИЧЕГО НЕ ОПУБЛИКОВАНО</b>\n\n"
          + "География: <b>" + escapeHtml(reviewed.region) + "</b>\n"
          + "Площадки: " + platforms.map((p) => LABELS[p]).join(", ") + "\n"
          + (reviewed.photo ? "Фото прикреплено.\n" : "")
          + "\n<b>Точный текст для размещения:</b>\n" + escapeHtml(reviewed.adText)
          + "\n\n" + campaignCard(reviewed)
          + "\n\nСначала подтвердите поиск сообществ. Публикация запускается только отдельным подтверждением на следующем этапе.", [
          [{ text: "🔎 Найти площадки для объявления", callback_data: "cp:search:" + reviewed.id }],
          [{ text: "✖️ Удалить черновик", callback_data: "cp:del:" + reviewed.id }],
        ]);
      } catch {
        // Preserve the owner's draft for retry after an AI/provider outage.
        await setValue(KEY(chatId, ownerId), { ...draft, stage: "platforms" }, TTL);
        await sendMessage(chatId, "⚠️ Не удалось сохранить кампанию. Попробуйте выбрать площадки ещё раз. Публикаций не было.", PLATFORM_BUTTONS);
      }
    },
  };
}

export async function advanceAdWizard(chatId: string, ownerId: string, text: string, photo?: string): Promise<Result | null> {
  const draft = await getValue<Draft>(KEY(chatId, ownerId));
  if (!draft) return null;
  const value = text.trim();
  if (/^(отмена|скасувати|cancel)$/iu.test(value)) {
    await cancelAdWizard(chatId, ownerId);
    return {};
  }
  if (draft.stage === "region") {
    if (value.length < 2 || value.length > 120) {
      await sendMessage(chatId, "Напишите конкретный город и страну, например: <code>Валенсия, Испания</code>.", CANCEL);
      return {};
    }
    await setValue(KEY(chatId, ownerId), { ...draft, stage: "adText", region: value } satisfies Draft, TTL);
    await sendMessage(chatId, "📣 <b>Размещение объявления · 2/3</b>\n\nПришлите <b>точный текст объявления</b> (не менее 15 символов).\n\nМожно прислать фото с подписью — оно войдёт в черновик. Цены и контакты не меняю.", CANCEL);
    return {};
  }
  if (draft.stage === "adText") {
    if (value.length < 15 || value.length > 3500) {
      if (photo) await setValue(KEY(chatId, ownerId), { ...draft, photo }, TTL);
      await sendMessage(chatId, photo && !value ? "Фото сохранено. Теперь пришлите текст объявления." : "Текст объявления должен содержать от 15 до 3500 символов.", CANCEL);
      return {};
    }
    await setValue(KEY(chatId, ownerId), { ...draft, stage: "platforms", adText: value, photo: photo || draft.photo } satisfies Draft, TTL);
    await platformQuestion(chatId);
    return {};
  }
  const choice = platformChoice(value);
  if (!choice.length) {
    await platformQuestion(chatId);
    return {};
  }
  return finish(chatId, ownerId, draft, choice);
}

export async function adWizardButton(chatId: string, ownerId: string, callbackId: string, action: string, choice: string): Promise<Result> {
  if (action === "cancel") {
    await answerCallback(callbackId, "Отменено");
    await cancelAdWizard(chatId, ownerId);
    return {};
  }
  if (action !== "platforms") {
    await answerCallback(callbackId, "Неизвестная кнопка");
    return {};
  }
  const draft = await getValue<Draft>(KEY(chatId, ownerId));
  if (!draft || draft.stage !== "platforms" || !draft.adText || !draft.region) {
    await answerCallback(callbackId, "Сначала заполните объявление");
    return {};
  }
  const selected = ({ tg: ["telegram"], fb: ["facebook"], tgfb: ["telegram", "facebook"], all: ["telegram", "facebook", "instagram", "tiktok"] } as Record<string, Platform[]>)[choice];
  if (!selected) {
    await answerCallback(callbackId, "Неизвестная платформа");
    return {};
  }
  await answerCallback(callbackId, "Готовлю черновик");
  return finish(chatId, ownerId, draft, selected);
}
