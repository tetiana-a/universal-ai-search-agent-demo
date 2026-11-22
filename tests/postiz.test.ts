import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/scout/postiz/route";
import { createPostizDraft, makePostizDraftPayload } from "@/lib/scout/postiz";
import { putOne, resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch } from "./helpers";

const auth = { "x-scout-key": "owner-admin" };
const integration = { id: "connected-facebook-page-1", name: "AURELIUS Demo Page", identifier: "facebook", disabled: false };

beforeEach(() => {
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("POSTIZ_API_KEY", "");
  vi.stubEnv("SCOUT_ADMIN_KEY", "owner-admin");
  vi.stubEnv("SCOUT_PUBLIC_DASHBOARD", "off");
});
describe("Postiz integration: safe drafts", () => {
  it("denies anonymous CRM access and shows missing Postiz key without leaking secrets", async () => {
    const denied = await GET(new Request("https://x/api/scout/postiz"));
    expect(denied.status).toBe(401);
    const unavailable = await GET(new Request("https://x/api/scout/postiz", { headers: auth }));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error).toBe("POSTIZ_NOT_CONFIGURED");
  });

  it("lists connected channels and creates only a non-published draft", async () => {
    vi.stubEnv("POSTIZ_API_KEY", "not-a-real-secret");
    const requests: Array<{ url: string; body?: any; authorization?: string }> = [];
    mockFetch([{
      match: (url) => url.startsWith("https://api.postiz.com/public/v1/"),
      respond: (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ url, body, authorization: String((init?.headers as any)?.Authorization || "") });
        return url.endsWith("/integrations") ? json([integration]) : json([{ postId: "post-draft-123", integration: integration.id }]);
      },
    }]);
    const list = await GET(new Request("https://x/api/scout/postiz", { headers: auth }));
    expect(list.status).toBe(200);
    expect((await list.json()).channels).toMatchObject([integration]);
    const created = await POST(new Request("https://x/api/scout/postiz", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ action: "draft", integrationId: integration.id, requestId: "user-approved-test-001", content: "Test floral delivery in Krakow" }),
    }));
    expect(created.status).toBe(201);
    expect((await created.json()).postId).toBe("post-draft-123");
    expect(requests.find((r) => r.url.endsWith("/posts"))?.body).toMatchObject({
      type: "draft",
      posts: [{ integration: { id: integration.id }, settings: { __type: "facebook" } }],
    });
    expect(requests.every((x) => x.authorization === "not-a-real-secret")).toBe(true);
    const again = await createPostizDraft({ integrationId: integration.id, requestId: "user-approved-test-001", content: "Test floral delivery in Krakow" });
    expect(again).toMatchObject({ ok: false, error: "DUPLICATE_REQUEST" });
    expect(requests.filter((x) => x.url.endsWith("/posts"))).toHaveLength(1);
  });

  it("never accepts immediate publishing or automatic scheduling", async () => {
    vi.stubEnv("POSTIZ_API_KEY", "not-a-real-secret");
    const response = await POST(new Request("https://x/api/scout/postiz", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ action: "schedule", integrationId: integration.id, requestId: "a-test", content: "Test floral delivery in Krakow" }),
    }));
    expect(response.status).toBe(403);
  });

  it("blocks a public Polish wine ad", async () => {
    vi.stubEnv("POSTIZ_API_KEY", "not-a-real-secret");
    const res = await POST(new Request("https://x/api/scout/postiz", {
      method: "POST", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ action: "draft", integrationId: integration.id, requestId: "polish-wine-001", region: "Польша", content: "Объявление о продаже вина в Польше для публичного размещения" }),
    }));
    expect(res.status).toBe(403);
  });

  it("schedules only after explicit owner approval and on a connected Postiz Page", async () => {
    vi.stubEnv("POSTIZ_API_KEY", "not-a-real-secret");
    vi.stubEnv("POSTIZ_ENABLE_SCHEDULE", "on");
    const approved = { id:"c-owned", title:"Flowers", adText:"Fresh flowers and bouquets in Krakow.",
      region:"Krakow, Poland", topic:"flowers", platforms:["facebook"], status:"approved", approvedAt:new Date().toISOString() };
    await putOne("campaigns", approved);
    const at = new Date(Date.now()+3600000).toISOString();
    const body={action:"schedule",campaignId:approved.id,integrationId:integration.id,
      scheduledAt:at,requestId:"owner-schedule-001",confirm:"I_APPROVE_SCHEDULE"};
    const denied=await POST(new Request("https://x/api/scout/postiz",{
      method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify({...body,confirm:""}),
    }));
    expect(denied.status).toBe(403);
    const created:any[]=[];
    mockFetch([{match:u=>u.startsWith("https://api.postiz.com/public/v1/"),respond:(u,i)=>{
      if(u.endsWith("/integrations"))return json([integration]);
      created.push(JSON.parse(String(i?.body||"{}")));
      return json([{postId:"scheduled-123",integration:integration.id}]);
    }}]);
    const response=await POST(new Request("https://x/api/scout/postiz",{
      method:"POST",headers:{...auth,"content-type":"application/json"},body:JSON.stringify(body),
    }));
    expect(response.status).toBe(202);
    expect((await response.json()).statusLabel).toBe("SCHEDULED_NOT_VERIFIED_PUBLISHED");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({type:"schedule",date:at,
      posts:[{integration:{id:integration.id},value:[{content:approved.adText}],settings:{__type:"facebook"}}]});
  });

  it("requires Postiz's format and does not allow unsupported integrations", () => {
    expect(makePostizDraftPayload(integration, "A tested content for Facebook")).toMatchObject({ type: "draft" });
    expect(() => makePostizDraftPayload({ ...integration, identifier: "unsupported" }, "A tested content for Facebook")).toThrow("POSTIZ_UNSUPPORTED_CHANNEL");
  });
});
