import { buildIcs } from "@/lib/scout/calendar";
import { getOne } from "@/lib/scout/store";
import type { Meeting } from "@/lib/scout/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  const meeting = /^mt_[a-z0-9]+$/i.test(id) ? await getOne<Meeting>("meetings", id) : null;
  if (!meeting) return new Response("Meeting not found", { status: 404 });
  return new Response(buildIcs(meeting), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="aurelius-meeting.ics"' } });
}
