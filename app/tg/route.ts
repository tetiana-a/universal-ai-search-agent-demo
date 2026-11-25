import { NextResponse } from "next/server";
import { reportChatId, tgCall } from "@/lib/scout/telegram";
import { getValue, setValue } from "@/lib/scout/store";

// The site's Telegram button opens the AURELIUS group. TELEGRAM_GROUP_URL in Vercel wins;
// otherwise the bot makes one invite link for the group and it is reused. The link asks for
// admin approval, so a visitor never lands in the control group without the owner's OK.

export const dynamic = "force-dynamic";

const CACHE_KEY = "tg-group-invite";
const FALLBACK = "https://t.me/AURELIUS8_bot";

async function groupLink(): Promise<string> {
  const configured = String(process.env.TELEGRAM_GROUP_URL || "").trim();
  if (/^https:\/\/t\.me\/\S+$/i.test(configured)) return configured;
  const cached = await getValue<string>(CACHE_KEY).catch(() => null);
  if (cached) return cached;
  const chatId = await reportChatId();
  if (!chatId) return FALLBACK;
  const chat = await tgCall("getChat", { chat_id: chatId });
  const username = String(chat?.result?.username || "");
  const link = username
    ? "https://t.me/" + username
    : String((await tgCall("createChatInviteLink", { chat_id: chatId, name: "Сайт AURELIUS", creates_join_request: true }))?.result?.invite_link || "");
  if (!link) return FALLBACK;
  await setValue(CACHE_KEY, link, 30 * 24 * 3600).catch(() => {});
  return link;
}

export async function GET() {
  return NextResponse.redirect(await groupLink(), 302);
}
