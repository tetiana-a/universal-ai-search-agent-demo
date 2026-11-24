import { after } from "next/server";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { parseSchedule, parseWatch, recallCheck, capacity, createCampaign, dispatchBotTasks, findForCampaign, listCampaigns, monitorCampaign, notifyPartners, planDay, setCampaignStatus, today, updateCampaign, verifyProof, type CampaignTask, type Mention } from "@/lib/scout/campaigns";
import { partnerInviteLink } from "@/lib/scout/campaigns-bot";
import { addGroupManually } from "@/lib/scout/groups";
import { listAll, removeMany } from "@/lib/scout/store";
import { asText } from "@/lib/scout/text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const str = (v: unknown, max = 4000) => asText(v).trim().slice(0, max);
const list = (v: unknown) => (Array.isArray(v) ? v : str(v).split(/[,;\n]/)).map((x) => str(x, 80)).filter(Boolean);

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const day = today();
  const [campaigns, tasks, mentions, cap] = await Promise.all([listCampaigns(), listAll<CampaignTask>("campaign_tasks"), listAll<Mention>("mentions"), capacity(day)]);
  return Response.json({
    ok: true, campaigns, capacity: cap, partnerLink: partnerInviteLink(),
    tasks: tasks.filter((t) => t.day === day).sort((a, b) => a.groupName.localeCompare(b.groupName)),
    mentions: mentions.sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 60),
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const body: any = await request.json().catch(() => ({}));
  const id = str(body.id, 40);
  switch (str(body.action, 30)) {
    case "create": {
      const text = str(body.text);
      if (text.length < 10) return Response.json({ ok: false, error: "Опишите задачу: что рекламируем, где, на каких площадках, текст." }, { status: 400 });
      const { campaign, ai } = await createCampaign(text, "web", "dashboard", /^https:\/\/\S+$/.test(str(body.photoUrl, 500)) ? str(body.photoUrl, 500) : undefined);
      return Response.json({ ok: true, campaign, message: ai ? "Задача разобрана. Проверьте ключевые слова и вопросы." : "ИИ недоступен — задача разобрана по правилам, проверьте поля." });
    }
    case "update": {
      const c = await updateCampaign(id, { title: str(body.title, 80) || undefined, adText: str(body.adText) || undefined, region: body.region === undefined ? undefined : str(body.region, 80), dailyTarget: body.dailyTarget, keywords: body.keywords === undefined ? undefined : list(body.keywords), adjacent: body.adjacent === undefined ? undefined : list(body.adjacent), queries: body.queries === undefined ? undefined : list(body.queries), exclusions: body.exclusions === undefined ? undefined : list(body.exclusions) });
      return c ? Response.json({ ok: true, message: "Сохранено" }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "schedule": {
      const c = await updateCampaign(id, { schedule: parseSchedule(str(body.schedule, 200)) });
      return c ? Response.json({ ok: true, schedule: c.schedule || null }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "watch": {
      const c = await updateCampaign(id, { watch: parseWatch(str(body.watch, 300)) });
      return c ? Response.json({ ok: true, watch: c.watch || null }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "recall": {
      const links = (Array.isArray(body.links) ? body.links : str(body.links, 30000).split(/[\s,;]+/)).map((x: unknown) => str(x, 300)).filter(Boolean);
      const r = await recallCheck(id, links);
      return r ? Response.json({ ok: true, recall: r }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "search":
      after(async () => { await findForCampaign(id); });
      return Response.json({ ok: true, message: "Поиск сообществ запущен (3–5 минут). Обновите страницу позже." });
    case "start": {
      const c = await setCampaignStatus(id, "approved");
      if (!c) return Response.json({ ok: false, error: "not found" }, { status: 404 });
      const plan = await planDay();
      after(async () => { await notifyPartners(); await dispatchBotTasks(undefined, Date.now() + 250_000); });
      return Response.json({ ok: true, message: "Размещение запущено. На сегодня: " + plan.created + " (бот " + plan.byMode.bot + ", партнёры " + plan.byMode.partner + ", вручную " + plan.byMode.manual + ")." });
    }
    case "stop": {
      const c = await setCampaignStatus(id, "stopped");
      return c ? Response.json({ ok: true, message: "Кампания остановлена, неопубликованное отменено." }) : Response.json({ ok: false, error: "not found" }, { status: 404 });
    }
    case "stopAll": {
      const open = (await listCampaigns()).filter((c) => c.status !== "stopped");
      for (const c of open) await setCampaignStatus(c.id, "stopped");
      return Response.json({ ok: true, message: "Остановлено кампаний: " + open.length });
    }
    case "remove":
      await removeMany("campaigns", [id]);
      return Response.json({ ok: true });
    case "monitor": {
      const r = await monitorCampaign(id);
      return Response.json({ ok: r.ok, message: r.message });
    }
    case "verify": {
      const t = await verifyProof(id, Boolean(body.accept), "dashboard");
      return t ? Response.json({ ok: true, message: body.accept ? "Засчитано" : "Не засчитано" }) : Response.json({ ok: false, error: "Уже обработано" }, { status: 409 });
    }
    case "addPlace": {
      const g = await addGroupManually({ url: str(body.url, 300), name: str(body.name, 120) || undefined, partnerTelegramId: str(body.partnerTelegramId, 24) || undefined, dailyLimit: body.dailyLimit === undefined || body.dailyLimit === "" ? undefined : Number(body.dailyLimit), minDaysBetween: body.minDaysBetween === undefined || body.minDaysBetween === "" ? undefined : Number(body.minDaysBetween), permissionNote: str(body.permissionNote, 300) || undefined });
      return g ? Response.json({ ok: true, message: "Площадка добавлена: " + g.name + (g.permissionConfirmedAt ? "" : ". Размещений не будет, пока не записано согласие админа: укажите его в поле «Чем подтверждено согласие» или поставьте статус «бесплатно/обмен/платно» в карточке.") }) : Response.json({ ok: false, error: "Нужна ссылка на Telegram, Facebook, Instagram или TikTok." }, { status: 400 });
    }
    default:
      return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
