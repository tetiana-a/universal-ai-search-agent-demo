import { upsertGroups } from "@/lib/scout/groups";
import { archiveConfigured, archiveSheets, lastSync, readArchive, syncArchive, ARCHIVE_LABEL } from "@/lib/archive";
import { isAuthorized, isCronRequest, unauthorized } from "@/lib/scout/auth";
import { logAction } from "@/lib/scout/store";
import { neutralizeFormula } from "@/lib/server-exporters";
import { recordsWorkbook } from "@/lib/xlsx-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// GET            → status: connected?, last sync
// GET ?format=xlsx|csv&from=YYYY-MM-DD&to=YYYY-MM-DD&collections=groups,campaign_tasks → download from Supabase
// POST           → sync now (button); also the signed cron
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (!format) return Response.json({ ok: true, configured: archiveConfigured(), last: await lastSync(), collections: ARCHIVE_LABEL }, { headers: noStore });
  try {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const rows = await readArchive({ from, to, collections: (url.searchParams.get("collections") || "").split(",").filter(Boolean) });
    const sheets = archiveSheets(rows);
    const period = (from || "начало") + " — " + (to || "сегодня");
    const name = "aurelius-archive-" + (from || "all") + "-" + (to || new Date().toISOString().slice(0, 10));
    await logAction({ actor: "human", action: "archive.export." + format, detail: period + " · " + rows.length + " записей" });
    if (format === "csv") {
      const cell = (v: unknown) => '"' + neutralizeFormula(typeof v === "object" && v !== null ? JSON.stringify(v) : v ?? "").replace(/"/g, '""') + '"';
      const body = "﻿" + ["Раздел,ID,День,Данные", ...rows.map((r) => [ARCHIVE_LABEL[r.collection] || r.collection, r.id, r.day || "", r.data].map(cell).join(","))].join("\r\n");
      return new Response(body, { headers: { ...noStore, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"" + name + ".csv\"" } });
    }
    const summary = [{ раздел: "Период", записей: period }, ...Object.entries(sheets).map(([k, v]) => ({ раздел: k, записей: v.length })), { раздел: "Всего", записей: rows.length }];
    const buffer = await recordsWorkbook({ Сводка: summary, ...sheets });
    return new Response(new Uint8Array(buffer), { headers: { ...noStore, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"" + name + ".xlsx\"" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Ошибка архива" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request) && !isCronRequest(request)) return unauthorized();
  if (!archiveConfigured()) return Response.json({ ok: false, error: "Supabase не подключён: добавьте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в Vercel." }, { status: 400 });
  await upsertGroups([]).catch(() => null); // merge duplicate communities before they reach the archive
  const result = await syncArchive();
  await logAction({ actor: "human", action: "archive.sync", detail: result.ok ? result.total + " записей" : "ошибка: " + result.error });
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
