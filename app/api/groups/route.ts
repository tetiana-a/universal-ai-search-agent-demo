import { after } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { adultHiddenCount, findGroups, listGroups, listPosts, listQueue, markQueued, outreachDrafts, postViaBot, postingSummary, postingTargets, queueManual, updateGroup, type GroupCard } from "@/lib/scout/groups";
import { runProfileBatch } from "@/lib/scout/client-profile";
import { getOne, removeMany } from "@/lib/scout/store";
import { botHandle } from "@/lib/scout/config";
import { recordGroupSearch } from "@/lib/memory";
import { asText } from "@/lib/scout/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function str(value: unknown, max = 2000) {
  return asText(value).trim().slice(0, max);
}

function photoUrl(value: unknown) {
  const url = str(value, 500);
  return /^https:\/\/\S+$/i.test(url) ? url : undefined;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const [groups, queue, posts, summary, hiddenAdult] = await Promise.all([listGroups(), listQueue(), listPosts(200), postingSummary(), adultHiddenCount()]);
  return Response.json({ ok: true, groups, hiddenAdult, queue: queue.filter((q) => q.status === "pending"), posts, summary, bot: botHandle() });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const body: any = await request.json().catch(() => ({}));
  switch (str(body.action, 40)) {
    case "find": {
      const topic = str(body.topic, 120);
      const country = str(body.country, 60);
      const city = str(body.city, 60);
      if (!topic && !country && !city) return Response.json({ ok: false, error: "Для широкого поиска укажите хотя бы страну или город либо конкретную тему." }, { status: 400 });
      const broadPage = Math.max(0, Math.min(7, Math.trunc(Number(body.broadPage) || 0)));
      const requested = Array.isArray(body.platforms) ? body.platforms.filter((p: unknown) => ["telegram", "facebook", "instagram", "tiktok"].includes(String(p))).slice(0, 4) : undefined;
      const result = await findGroups({ topic, country, city, broadPage, platforms: requested?.length ? requested : undefined }, Date.now() + 240_000);
      await recordGroupSearch({ query: [topic || "все тематики", city, country].filter(Boolean).join(" · "), origin: "web", found: result.found, added: result.added, notes: result.notes }).catch(() => undefined);
      const byPlatform = Object.fromEntries(["telegram", "facebook", "instagram", "tiktok"].map((p) => [p, result.found.filter((g) => g.platform === p).length]));
      return Response.json({ ok: true, added: result.added, total: result.found.length, byPlatform, ids: result.found.map((g) => g.id), message: "Найдено публичных площадок: " + result.found.length + " (новых " + result.added + "). Telegram: " + byPlatform.telegram + ", Facebook: " + byPlatform.facebook + ", Instagram: " + byPlatform.instagram + ", TikTok: " + byPlatform.tiktok + "." + (result.notes.length ? " " + result.notes.join(" ") : "") });
    }
    case "profile": {
      // Next portion of the client-profile search (themes × regions); the daily cron continues it.
      const r = await runProfileBatch(Date.now() + 240_000);
      return Response.json({ ok: true, ...r, message: "Подбор под клиента: " + r.runs + " запросов, новых сообществ " + r.added + ", всего в базе " + r.total + ". Пройдено " + r.cursor + " из " + r.planSize + " тем × регионов." });
    }
    case "update": {
      const card = await updateGroup(str(body.id, 80), body.patch || {});
      return card ? Response.json({ ok: true, group: card }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "remove":
      await removeMany("groups", [str(body.id, 80)]);
      return Response.json({ ok: true });
    case "outreach": {
      const card = await getOne<GroupCard>("groups", str(body.id, 80));
      if (!card) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      const lang = ["ru", "en", "es"].includes(body.lang) ? body.lang : "ru";
      return Response.json({ ok: true, drafts: await outreachDrafts(card, lang) });
    }
    case "post.bot": {
      const text = str(body.text, 4000);
      if (!text) return Response.json({ ok: false, error: "Пустой текст." }, { status: 400 });
      const targets = await postingTargets();
      if (!targets.length) return Response.json({ ok: false, error: "Нет групп, куда бот может публиковать. Попросите админов добавить бота и включите «Постинг»." }, { status: 400 });
      // Runs after the reply: posting is paced (~3 s per chat) to stay within Telegram limits.
      after(async () => { await postViaBot(text, photoUrl(body.photoUrl), "dashboard"); });
      return Response.json({ ok: true, message: "Публикация запущена в " + targets.length + " групп(ы). Результат появится в журнале через " + Math.ceil(targets.length * 3 / 60 + 0.5) + " мин." });
    }
    case "queue.add": {
      const ids = Array.isArray(body.ids) ? body.ids.map((x: unknown) => str(x, 80)).slice(0, 500) : "all";
      return Response.json(await queueManual(str(body.text, 4000), ids, photoUrl(body.photoUrl)));
    }
    case "queue.done":
    case "queue.skip": {
      const item = await markQueued(str(body.id, 80), body.action === "queue.done" ? "published" : "skipped", "dashboard");
      return item ? Response.json({ ok: true }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    default:
      return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
