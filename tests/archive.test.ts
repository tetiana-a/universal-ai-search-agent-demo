import { beforeEach, describe, expect, it, vi } from "vitest";
import { json, mockFetch } from "./helpers";
import { archiveSheets, readArchive, recordDay, syncArchive } from "@/lib/archive";
import { logAction, putOne, resetMemoryStore } from "@/lib/scout/store";

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co/");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

describe("Supabase archive", () => {
  it("takes the record's own day", () => {
    expect(recordDay({ day: "2026-11-20", createdAt: "2026-11-01T00:00:00Z" })).toBe("2026-11-20");
    expect(recordDay({ foundAt: "2026-10-05T10:00:00Z" })).toBe("2026-10-05");
    expect(recordDay({})).toBeNull();
  });

  it("upserts every collection, the journal and searches by key, with the server key only", async () => {
    await putOne("groups", { id: "g1", name: "A", foundAt: "2026-11-20T00:00:00Z" });
    await putOne("campaign_tasks", { id: "t1", day: "2026-11-24" });
    await logAction({ actor: "agent", action: "x", detail: "y" });
    const bodies: any[] = [];
    const calls = mockFetch([{ match: (u) => u.startsWith("https://proj.supabase.co/rest/v1/aurelius_archive"), respond: (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return new Response(null, { status: 201 }); } }]);
    const r = await syncArchive();
    expect(r).toMatchObject({ ok: true, total: 3, byCollection: { groups: 1, campaign_tasks: 1, journal: 1 } });
    expect(calls[0].url).toBe("https://proj.supabase.co/rest/v1/aurelius_archive?on_conflict=collection,id");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Prefer).toContain("merge-duplicates");
    expect(headers.Authorization).toBe("Bearer service-key");
    expect(bodies[0].find((x: any) => x.collection === "campaign_tasks")).toMatchObject({ id: "t1", day: "2026-11-24" });
  });

  it("reports a failure instead of throwing", async () => {
    mockFetch([{ match: () => true, respond: () => json({ message: "relation does not exist" }, 404) }]);
    await putOne("groups", { id: "g1" });
    const r = await syncArchive();
    expect(r.ok).toBe(false);
    expect(r.error).toContain("404");
  });

  it("reads a period page by page and groups sheets in Russian", async () => {
    const page = (n: number, offset: number) => Array.from({ length: n }, (_, i) => ({ collection: i % 2 ? "groups" : "campaign_tasks", id: String(offset + i), day: "2026-11-20", data: { id: String(offset + i) } }));
    const calls = mockFetch([{ match: () => true, respond: (_u, init) => { const offset = Number(String((init?.headers as any).Range).split("-")[0]); return json(page(offset ? 10 : 1000, offset)); } }]);
    const rows = await readArchive({ from: "2026-11-01", to: "2026-11-30", collections: ["groups", "campaign_tasks", "bad;drop"] });
    expect(rows).toHaveLength(1010);
    expect(calls[0].url).toContain("day=gte.2026-11-01");
    expect(calls[0].url).toContain("collection=in.(groups,campaign_tasks)");
    expect(Object.keys(archiveSheets(rows)).sort()).toEqual(["Размещения", "Сообщества"]);
  });
});
