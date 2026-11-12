import { after } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { findGroups, listGroups, listPosts, listQueue, markQueued, outreachDrafts, postViaBot, postingSummary, postingTargets, queueManual, updateGroup, type GroupCard } from "@/lib/scout/groups";
import { getOne, removeMany } from "@/lib/scout/store";
import { botHandle } from "@/lib/scout/config";
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
  const [groups, queue, posts, summary] = await Promise.all([listGroups(), listQueue(), listPosts(200), postingSummary()]);
  return Response.json({ ok: true, groups, queue: queue.filter((q) => q.status === "pending"), posts, summary, bot: botHandle() });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const body: any = await request.json().catch(() => ({}));
  switch (str(body.action, 40)) {
    case "find": {
      const topic = str(body.topic, 120);
      if (!topic) return Response.json({ ok: false, error: "Укажите тему, например «недвижимость»." }, { status: 400 });
      const result = await findGroups({ topic, country: str(body.country, 60), city: str(body.city, 60) }, Date.now() + 240_000);
      return Response.json({ ok: true, added: result.added, total: result.found.length, message: "Найдено групп: " + result.found.length + " (новых " + result.added + ")" + (result.notes.length ? ". " + result.notes.join(" ") : "") });
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
