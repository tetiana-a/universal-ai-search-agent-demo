import { NextResponse } from "next/server";
import { clarifyingQuestions, fieldSchemaFor } from "@/lib/task-profile";

export const runtime = "nodejs";

// Questions for criteria the query leaves open, plus the result columns for this
// task type. Does not run a search and does not use quota.
export async function POST(request: Request) {
  let body: any = null;
  try { body = await request.json(); } catch {}
  const query = String(body?.query || "").trim().slice(0, 2000);
  if (!query) return NextResponse.json({ error: "Query is required.", code: "INVALID_REQUEST" }, { status: 400 });
  const analysis = clarifyingQuestions(query);
  return NextResponse.json(
    { ...analysis, fieldSchema: fieldSchemaFor(analysis.kind) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
