import { isAuthorized, unauthorized } from "@/lib/scout/auth";
import { cancelInstagramJob, instagramSchedulingEnabled, listInstagramJobs, refreshInstagramJobs, scheduleInstagram } from "@/lib/scout/instagram-posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Owner-only endpoint. Intended for n8n/SHEETS rows explicitly marked
// APPROVED by the owner, never for discovering or spamming Instagram profiles.
export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    const jobs = refresh ? await refreshInstagramJobs() : await listInstagramJobs();
    return Response.json({ok:true, enabled:instagramSchedulingEnabled(), jobs:jobs.slice(0,250)});
  } catch {
    return Response.json({ok:false,error:"INSTAGRAM_REPORT_UNAVAILABLE"}, {status:502});
  }
}
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const body:any = await request.json().catch(()=>null);
  if (!body) return Response.json({ok:false,error:"INVALID_BODY"}, {status:400});
  if (body.action === "cancel" && body.confirm === "I_APPROVE_CANCEL") {
    try {
      const result = await cancelInstagramJob(String(body.jobId||""));
      return Response.json(result,{status:result.ok?200:422});
    } catch {
      return Response.json({ok:false,error:"INSTAGRAM_CANCEL_FAILED"}, {status:502});
    }
  }
  if (body.action !== "schedule" || body.confirm !== "I_APPROVE_INSTAGRAM_SCHEDULE" || body.approved !== true) {
    return Response.json({ok:false,error:"OWNER_APPROVAL_REQUIRED"}, {status:403});
  }
  const requestId=String(body.requestId||"").slice(0,80);
  const content=String(body.caption||"").slice(0,2201);
  const mediaUrl=typeof body.mediaUrl==="string"?body.mediaUrl.trim().slice(0,500):undefined;
  const scheduledAt=String(body.scheduledAt||"").slice(0,40);
  const integrationId=String(body.integrationId||"").slice(0,100);
  // An explicit user-owned source row is required. Avoid one API credential
  // being used to silently post unrelated search engine results.
  if (!/^[\w-]{8,80}$/.test(requestId) || !content.trim() || !mediaUrl || !scheduledAt) {
    return Response.json({ok:false,error:"INVALID_APPROVED_ROW"}, {status:400});
  }
  try {
    const result = await scheduleInstagram({ requestId, caption:content, mediaUrl, scheduledAt,
      integrationId:integrationId||undefined, ownerId:"owner-approved-sheet" });
    return Response.json(result,{status:result.ok?202:422});
  } catch {
    return Response.json({ok:false,error:"INSTAGRAM_SCHEDULE_UNAVAILABLE"}, {status:502});
  }
}
