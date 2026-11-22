import { advisorHistory, askAdvisor, resetAdvisor, speak } from "@/lib/advisor";
import { geminiTranscribe } from "@/lib/gemini-audio";
import { isAuthorized, unauthorized } from "@/lib/scout/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function session(value: unknown) {
  return "web:" + (String(value || "main").replace(/[^\w-]/g, "").slice(0, 40) || "main");
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return Response.json({ ok: true, history: await advisorHistory(session(new URL(request.url).searchParams.get("session"))) });
}

// JSON {text, voice} or multipart {file, session}: a recorded question gets a spoken answer too.
export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  let text = "", voice = false, sid = "", transcript = "";
  if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    sid = String(form.get("session") || "");
    if (!(file instanceof File) || file.size > 15 * 1024 * 1024) return Response.json({ ok: false, error: "Нужна запись до 15 МБ." }, { status: 400 });
    const heard = await geminiTranscribe(Buffer.from(await file.arrayBuffer()).toString("base64"), file.type || "audio/webm");
    if (!heard.ok) return Response.json({ ok: false, error: heard.message }, { status: 502 });
    text = transcript = heard.text;
    voice = true;
  } else {
    const body: any = await request.json().catch(() => ({}));
    sid = String(body.session || "");
    if (body.action === "reset") { await resetAdvisor(session(sid)); return Response.json({ ok: true }); }
    text = String(body.text || "").trim().slice(0, 4000);
    voice = Boolean(body.voice);
  }
  if (!text) return Response.json({ ok: false, error: "Пустой вопрос." }, { status: 400 });
  const answer = await askAdvisor(session(sid), text, { voice, deadlineAt: Date.now() + 60_000 });
  const mp3 = voice && answer.ok ? await speak(answer.reply) : null;
  return Response.json({ ok: answer.ok, reply: answer.reply, transcript, audio: mp3 ? mp3.toString("base64") : "" });
}
