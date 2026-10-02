import { NextResponse } from "next/server";
import { createCsvBuffer, createJsonBuffer, createPdfBuffer, createXlsxBuffer } from "@/lib/server-exporters";
import type { ResearchExportPayload } from "@/lib/research-report";
import { safeFilenamePart } from "@/lib/research-report";

export const runtime = "nodejs";
export const maxDuration = 30;

function disposition(filename: string) {
  return "attachment; filename=\"" + filename + "\"; filename*=UTF-8''" + encodeURIComponent(filename);
}

function isPayload(value: unknown): value is ResearchExportPayload {
  const body = value as any;
  return Boolean(body && typeof body === "object" && Array.isArray(body.results));
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  const format = String(body?.format || "").toLowerCase();
  const payload = body?.payload;
  if (!["csv", "xlsx", "pdf", "json"].includes(format)) {
    return NextResponse.json({ error: "Unsupported export format." }, { status: 400 });
  }
  if (!isPayload(payload)) {
    return NextResponse.json({ error: "A research export payload with results is required." }, { status: 400 });
  }

  try {
    const base = "aurelius-" + safeFilenamePart(payload.query || "research");
    if (format === "csv") {
      const buffer = createCsvBuffer(payload);
      return new Response(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": disposition(base + ".csv"),
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "json") {
      const buffer = createJsonBuffer(payload);
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": disposition(base + ".json"),
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "xlsx") {
      const buffer = await createXlsxBuffer(payload);
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": disposition(base + ".xlsx"),
          "Cache-Control": "no-store",
        },
      });
    }

    const buffer = await createPdfBuffer(payload);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition(base + ".pdf"),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Export generation failed." },
      { status: 500 },
    );
  }
}
