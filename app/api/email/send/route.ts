import { NextResponse } from "next/server";
import { buildEmailHtml, buildPlainTextReport, safeFilenamePart, type ResearchExportPayload } from "@/lib/research-report";
import { createPdfBuffer, createXlsxBuffer } from "@/lib/server-exporters";
import { assertFeature, resolvePlan } from "@/lib/plans";
import { errorBody } from "@/lib/research-errors";

export const runtime = "nodejs";
export const maxDuration = 35;

function allowedRecipients() {
  return String(process.env.EMAIL_ALLOWED_RECIPIENTS || "")
    .split(",")
    .map(function(value) { return value.trim().toLowerCase(); })
    .filter(Boolean);
}

function isAllowedRecipient(email: string) {
  const allowlist = allowedRecipients();
  if (!allowlist.length) return false;
  return allowlist.includes(email.trim().toLowerCase());
}

function isPayload(value: unknown): value is ResearchExportPayload {
  const body = value as any;
  return Boolean(body && typeof body === "object" && Array.isArray(body.results));
}

export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    allowlistedRecipients: allowedRecipients().length,
  });
}

export async function POST(request: Request) {
  try {
    assertFeature(resolvePlan(request), "email");
  } catch (error) {
    const e = errorBody(error);
    return NextResponse.json(e.body, { status: e.status });
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return NextResponse.json(
      { error: "Email delivery is not configured. Add RESEND_API_KEY and EMAIL_FROM in Vercel." },
      { status: 503 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const to = String(body?.to || "").trim().toLowerCase();
  const subject = String(body?.subject || "AURELIUS Research Report").trim().slice(0, 180);
  const payload = body?.payload;

  if (!isPayload(payload)) {
    return NextResponse.json({ error: "A research export payload is required." }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "Enter a valid recipient email address." }, { status: 400 });
  }
  if (!isAllowedRecipient(to)) {
    return NextResponse.json(
      { error: "This recipient is not on the configured email allowlist. Add it to EMAIL_ALLOWED_RECIPIENTS in Vercel." },
      { status: 403 },
    );
  }

  try {
    const base = "aurelius-" + safeFilenamePart(payload.query || "research");
    const [xlsx, pdf] = await Promise.all([createXlsxBuffer(payload), createPdfBuffer(payload)]);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        reply_to: process.env.EMAIL_REPLY_TO || undefined,
        subject,
        html: buildEmailHtml(payload),
        text: buildPlainTextReport(payload),
        attachments: [
          {
            filename: base + ".xlsx",
            content: Buffer.from(xlsx).toString("base64"),
          },
          {
            filename: base + ".pdf",
            content: Buffer.from(pdf).toString("base64"),
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json().catch(function() { return null; });
    if (!response.ok) {
      return NextResponse.json(
        { error: data?.message || data?.error || "Resend rejected the email." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, id: data?.id || null, to });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Email delivery failed." },
      { status: 502 },
    );
  }
}
