import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/scout/instagram/route";
import { cancelInstagramJob, listInstagramJobs, scheduleInstagram, validateInstagramRequest } from "@/lib/scout/instagram-posts";
import { resetMemoryStore } from "@/lib/scout/store";
import { json, mockFetch, postJson } from "./helpers";

const HEADERS={"x-scout-key":"only-owner"};
const ROOT="https://api.postiz.com/public/v1";
const account={id:"sofia-instagram-standalone",name:"Sofia",identifier:"instagram-standalone",disabled:false};
const future=()=>new Date(Date.now()+60*60_000).toISOString();
const params=()=>({requestId:"owner-ig-20261122-001",ownerId:"tg-owner",caption:"AURELIUS trial photo for Sofia: approved original content.",mediaUrl:"https://images.example.com/photo.jpg",scheduledAt:future()});

beforeEach(()=>{
  resetMemoryStore();
  vi.unstubAllGlobals();
  vi.stubEnv("UPSTASH_REDIS_REST_URL","");
  vi.stubEnv("KV_REST_API_URL","");
  vi.stubEnv("SCOUT_ADMIN_KEY","only-owner");
  vi.stubEnv("SCOUT_PUBLIC_DASHBOARD","off");
  vi.stubEnv("POSTIZ_API_KEY","fake");
  vi.stubEnv("POSTIZ_ENABLE_SCHEDULE","on");
  vi.stubEnv("INSTAGRAM_AUTOPOST","off");
  vi.stubEnv("INSTAGRAM_ALLOWED_CHANNEL_IDS","");
});
describe("Instagram automatic owner-approved publication",()=>{
  it("denies unauthenticated requests and keeps publishing off by default",async()=>{
    expect((await GET(new Request("https://x/api/scout/instagram"))).status).toBe(401);
    expect((await POST(postJson("https://x/api/scout/instagram",{action:"schedule"}))).status).toBe(401);
    expect(await scheduleInstagram(params())).toMatchObject({ok:false,error:"INSTAGRAM_AUTOPOST_DISABLED"});
  });

  it("requires a public photo/video URL and timezone-aware future date",()=>{
    expect(validateInstagramRequest({...params(),mediaUrl:undefined})).toBe("ONE_MEDIA_REQUIRED");
    expect(validateInstagramRequest({...params(),mediaUrl:"http://example.com/photo.jpg"})).toBe("INVALID_PUBLIC_MEDIA_URL");
    expect(validateInstagramRequest({...params(),mediaUrl:"https://localhost/file.jpg"})).toBe("INVALID_PUBLIC_MEDIA_URL");
    expect(validateInstagramRequest({...params(),mediaUrl:"https://example.com/photo.pdf"})).toBe("INVALID_PUBLIC_MEDIA_URL");
    expect(validateInstagramRequest({...params(),scheduledAt:"2026-11-27T12:00"})).not.toBeNull();
    expect(validateInstagramRequest({...params(),scheduledAt:future()})).toBeNull();
  });

  it("cannot auto-publish without an approved row, even with a valid administrator key",async()=>{
    vi.stubEnv("INSTAGRAM_AUTOPOST","on");
    const body={action:"schedule",requestId:params().requestId,caption:params().caption,mediaUrl:params().mediaUrl,scheduledAt:future(),approved:false,confirm:"I_APPROVE_INSTAGRAM_SCHEDULE"};
    expect((await POST(postJson("https://x/api/scout/instagram",body,HEADERS))).status).toBe(403);
    expect((await POST(postJson("https://x/api/scout/instagram",{...body,approved:true,confirm:""},HEADERS))).status).toBe(403);
  });

  it("uploads media, schedules Sofia exactly once, records proof and allows cancellation",async()=>{
    vi.stubEnv("INSTAGRAM_AUTOPOST","on");
    const calls:any[]=[];
    mockFetch([{
      match:url=>url.startsWith(ROOT),
      respond:(url,init)=>{
        const method=String(init?.method||"GET");
        calls.push({url,method,body:typeof init?.body==="string"?JSON.parse(init.body):undefined});
        if(url.endsWith("/integrations"))return json([account]);
        if(url.endsWith("/upload-from-url"))return json({id:"media-1",path:"https://uploads.postiz.com/photo.jpg"});
        if(url.endsWith("/posts")&&method==="POST")return json([{postId:"post-ig-2026",integration:account.id}]);
        if(url.includes("/posts?"))return json({posts:[{id:"post-ig-2026",releaseURL:"https://www.instagram.com/p/test-post/",integration:{name:"Sofia",providerIdentifier:"instagram-standalone"},publishDate:new Date().toISOString()}]});
        if(url.endsWith("/posts/post-ig-2026")&&method==="DELETE")return json({id:"post-ig-2026"});
        throw new Error("Unexpected "+method+" "+url);
      },
    }]);
    const req={...params(),integrationId:account.id};
    const result=await scheduleInstagram(req);
    expect(result).toMatchObject({ok:true,job:{postId:"post-ig-2026",status:"scheduled",channelName:"Sofia"}});
    expect(calls.find(x=>x.url.endsWith("/posts")&&x.method==="POST").body).toMatchObject({
      type:"schedule",posts:[{integration:{id:account.id},settings:{__type:"instagram-standalone",post_type:"post"},value:[{image:[{id:"media-1"}]}]}],
    });
    expect((await scheduleInstagram(req)).job?.postId).toBe("post-ig-2026");
    expect(calls.filter(x=>x.url.endsWith("/posts")&&x.method==="POST")).toHaveLength(1);
    const reporting=await GET(new Request("https://x/api/scout/instagram?refresh=1",{headers:HEADERS}));
    expect(reporting.status).toBe(200);
    const recorded=await reporting.json();
    expect(recorded.jobs[0]).toMatchObject({status:"published",releaseURL:"https://www.instagram.com/p/test-post/"});
    expect(await cancelInstagramJob("ig-"+req.requestId)).toMatchObject({ok:false,error:"NOT_CANCELLABLE"});
  });

  it("rejects a channel not explicitly allowed and never sends media to Postiz",async()=>{
    vi.stubEnv("INSTAGRAM_AUTOPOST","on");
    vi.stubEnv("INSTAGRAM_ALLOWED_CHANNEL_IDS","other-account-id");
    const calls=mockFetch([{match:url=>url.endsWith("/integrations"),respond:()=>json([account])}]);
    expect(await scheduleInstagram({...params(),integrationId:account.id})).toMatchObject({ok:false,error:"ACCOUNT_NOT_ALLOWLISTED"});
    expect(calls).toHaveLength(1);
  });

  it("never retries an uncertain scheduling operation and logs the unconfirmed state",async()=>{
    vi.stubEnv("INSTAGRAM_AUTOPOST","on");
    const calls=mockFetch([{match:url=>url.startsWith(ROOT),respond:url=>{
      if(url.endsWith("/integrations"))return json([account]);
      if(url.endsWith("/upload-from-url"))return json({id:"media-id",path:"https://uploads.postiz.com/photo.jpg"});
      return json({error:"timeout"},504);
    }}]);
    const first=await scheduleInstagram(params());
    expect(first.ok).toBe(false);
    expect(first.job?.status).toBe("unknown");
    expect((await listInstagramJobs()).length).toBe(1);
    const second=await scheduleInstagram(params());
    expect(second.job?.status).toBe("unknown");
    expect(calls.filter(c=>c.url.endsWith("/posts"))).toHaveLength(1);
  });
});
