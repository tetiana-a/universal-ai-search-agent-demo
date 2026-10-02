import { NextResponse } from "next/server";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import type { ResearchQueryUnderstanding, LiveSourceRecord, AccessEvent } from "@/lib/research-contract";
import { getSearchProviderCatalog, runProviderDiscovery } from "@/lib/provider-search";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { accessEscalationSummary, buildAccessEscalationPlan, type AccessEscalationPlan } from "@/lib/access-escalation";

export const runtime = "nodejs";
export const maxDuration = 300;

type ResearchRequest = { query?: string; language?: "ru" | "en"; maxResults?: number; depth?: "Quick" | "Balanced" | "Deep"; maxSources?: number; maxPages?: number; multilingual?: boolean; followRelatedLinks?: boolean };
type ResearchResult = { id:number; title:string; location:string; area:string; price:string; match:number; evidence:string; evidenceQuote:string; status:"Verified"|"Reviewed"|"Manual review"; source:string; sourceType:string; sourceDomain:string; url:string; why:string; retrievedAt:string; freshnessDays:number; confidence:number; independentVerification:boolean };

const schema = { type:"object", additionalProperties:false, properties:{
  query_understanding:{type:"object",additionalProperties:false,properties:{intent:{type:"string"},entity_type:{type:"string"},geography:{type:"array",items:{type:"string"}},languages:{type:"array",items:{type:"string"}},criteria:{type:"array",items:{type:"string"}},exclusions:{type:"array",items:{type:"string"}},required_fields:{type:"array",items:{type:"string"}},source_classes:{type:"array",items:{type:"string"}}},required:["intent","entity_type","geography","languages","criteria","exclusions","required_fields","source_classes"]},
  search_plan:{type:"string"},search_branches:{type:"array",items:{type:"string"},maxItems:30},search_summary:{type:"string"},candidates_seen:{type:"integer",minimum:0},duplicates_removed:{type:"integer",minimum:0},
  access_events:{type:"array",maxItems:80,items:{type:"object",additionalProperties:false,properties:{url:{type:"string"},status:{type:"string"},method:{type:"string"},reason:{type:"string"},fallback:{type:"string"}},required:["url","status","method","reason","fallback"]}},
  source_registry:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,properties:{name:{type:"string"},url:{type:"string"},domain:{type:"string"},category:{type:"string"},access_status:{type:"string",enum:["checked","partial","unavailable","blocked","auth_required","policy_restricted","captcha_required","rate_limited","not_automatable"]},access_method:{type:"string"},reason:{type:"string"},evidence_available:{type:"boolean"},quality:{type:"integer",minimum:0,maximum:100}},required:["name","url","domain","category","access_status","access_method","reason","evidence_available","quality"]}},
  results:{type:"array",maxItems:30,items:{type:"object",additionalProperties:false,properties:{title:{type:"string"},location:{type:"string"},area:{type:"string"},price:{type:"string"},match:{type:"integer",minimum:0,maximum:100},confidence:{type:"integer",minimum:0,maximum:100},evidence:{type:"string"},evidence_quote:{type:"string"},status:{type:"string",enum:["Verified","Reviewed","Manual review"]},source:{type:"string"},source_type:{type:"string"},url:{type:"string"},why:{type:"string"},retrieved_at:{type:"string"},freshness_days:{type:"integer",minimum:0},independent_verification:{type:"boolean"}},required:["title","location","area","price","match","confidence","evidence","evidence_quote","status","source","source_type","url","why","retrieved_at","freshness_days","independent_verification"]}}
},required:["query_understanding","search_plan","search_branches","search_summary","candidates_seen","duplicates_removed","access_events","source_registry","results"]} as const;

function outputText(response:any){return typeof response?.output_text === "string" ? response.output_text.trim() : "";}
function getDomain(url:string){try{return new URL(url).hostname.replace(/^www\./,"").toLowerCase();}catch{return "";}}
function normalize(value:string){return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9а-яёіїєґ]+/gi," ").trim();}
function normalizeUrl(url:string){try{const u=new URL(url);u.hash="";u.searchParams.sort();return u.toString().replace(/\/$/,"");}catch{return url.trim().replace(/\/$/,"");}}
function dedupeResults(items:any[]){const groups=new Map<string,any[]>();for(const item of items){const identity=[normalize(String(item?.title||"")),normalize(String(item?.location||"")),normalize(String(item?.area||""))].join("|");const key=identity.replace(/\|+/g,"|")||normalizeUrl(String(item?.url||""));const b=groups.get(key)||[];b.push(item);groups.set(key,b);}const out:any[]=[];let removed=0;for(const bucket of groups.values()){bucket.sort((a,b)=>Number(b?.confidence||0)-Number(a?.confidence||0));out.push(bucket[0]);removed+=Math.max(0,bucket.length-1);}return {out,removed};}

export async function POST(request:Request){
 const apiKey=process.env.OPENAI_API_KEY; const model=process.env.OPENAI_MODEL||"gpt-5.5";
 if(!apiKey)return NextResponse.json({error:"OPENAI_API_KEY is not configured."},{status:503});
 let body:ResearchRequest; try{body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON request body."},{status:400});}
 const query=String(body.query||"").trim(); if(!query)return NextResponse.json({error:"Query is required."},{status:400});
 const language=body.language==="en"?"en":"ru"; const depth=body.depth||"Deep"; const maxResults=Math.min(Math.max(Number(body.maxResults||12),4),20); const maxSources=Math.min(Math.max(Number(body.maxSources||50),5),150); const maxPages=Math.min(Math.max(Number(body.maxPages||200),20),2500); const multilingual=body.multilingual!==false; const followRelatedLinks=body.followRelatedLinks!==false;
 const supplementalEnabled=process.env.SUPPLEMENTAL_SEARCH_ENABLED!=="false"; const searchMatrix=buildSearchMatrix(query,language); let providerHints:any[]=[]; if(supplementalEnabled){try{providerHints=await Promise.race([runProviderDiscovery(query,language),new Promise<any[]>(resolve=>setTimeout(()=>resolve([]),Number(process.env.SUPPLEMENTAL_SEARCH_TIMEOUT_MS||18000)))])}catch{providerHints=[];}} const providerCatalog=getSearchProviderCatalog();
 const providerHintBlock=providerHints.slice(0,120).map((h:any)=>({provider:h.provider,engine:h.engine,query:h.query,title:h.title,url:h.url,domain:h.domain,snippet:String(h.snippet||"").slice(0,700)}));
 const systemPrompt=language==="ru"?UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU:UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN;
 const userPrompt=language==="ru"?`Исходный запрос пользователя:\n${query}\n\nРежим: ${depth}. Лимиты: ${maxSources} источников, ${maxPages} URL, ${maxResults} результатов. Мультиязычность: ${multilingual?"включена":"выключена"}. Связанные страницы: ${followRelatedLinks?"включены":"выключены"}.\n\nКАТАЛОГ ПОИСКА:\n${JSON.stringify(providerCatalog)}\n\nМАТРИЦА ВЕТОК:\n${JSON.stringify(searchMatrix)}\n\nДОПОЛНИТЕЛЬНЫЕ КАНДИДАТЫ:\n${JSON.stringify(providerHintBlock)}\n\nВыполни реальный глубокий web search несколькими независимыми ветками; используй локальные языки, официальные/государственные источники, каталоги, компании, документы, новости и публичные сообщества. Не используй закрытые аккаунты и обход авторизации. Для каждого результата нужны реальный URL и evidence_quote. Не выдумывай данные. Дубли удаляй.`:`User request:\n${query}\n\nMode: ${depth}. Limits: ${maxSources} sources, ${maxPages} URLs, ${maxResults} results. Multilingual: ${multilingual?"on":"off"}. Related pages: ${followRelatedLinks?"on":"off"}.\n\nSEARCH PROVIDER CATALOG:\n${JSON.stringify(providerCatalog)}\n\nSEARCH MATRIX:\n${JSON.stringify(searchMatrix)}\n\nSUPPLEMENTAL CANDIDATES:\n${JSON.stringify(providerHintBlock)}\n\nPerform real deep web search across independent branches; use regional languages, official/government sources, directories, companies, documents, news and public communities. Do not use closed accounts or auth bypass. Every result needs a real URL and evidence_quote. Never invent data. Remove duplicates.

ACCESS ESCALATION PROTOCOL:
1) official API;
2) public HTML/JSON;
3) sitemap/RSS/feed;
4) licensed provider;
5) permitted normal browser;
6) authorized customer-owned session;
7) manual human checkpoint;
8) alternate source.
If a source presents CAPTCHA, Cloudflare challenge, bot protection or an access challenge, classify it as captcha_required/blocked and create a manual checkpoint. Never claim the challenge was bypassed. Never spoof fingerprint, anti-detect browser, stolen cookies, borrowed accounts or other access-control circumvention. If a source is rate-limited, respect Retry-After/backoff and try another allowed source. If terms/robots forbid automation, mark policy_restricted and use an alternate source. Only count a source as checked when actual source evidence was obtained.`;
 const startedAt=Date.now();
 const call=async(retry:boolean)=>{const res=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,input:[{role:"system",content:systemPrompt},{role:"user",content:userPrompt+(retry?"\nReturn concise schema-valid JSON only.":"")}],tools:[{type:"web_search",search_context_size:depth==="Deep"?"high":"medium",external_web_access:true,return_token_budget:depth==="Deep"?"unlimited":"default"}],tool_choice:"required",include:["web_search_call.action.sources"],reasoning:{effort:depth==="Deep"?"high":depth==="Balanced"?"medium":"low"},text:{format:{type:"json_schema",name:"aurelius_research_result",strict:true,schema}},max_output_tokens:depth==="Deep"?16000:10000})});return {res,body:await res.json()};};
 let r;try{r=await call(false);}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"OpenAI request failed."},{status:502});}
 if(!r.res.ok)return NextResponse.json({error:r.body?.error?.message||"OpenAI live research request failed.",diagnostics:{upstreamStatus:r.res.status}},{status:r.res.status});
 let parsed:any=null;try{parsed=JSON.parse(outputText(r.body));}catch{try{r=await call(true);if(r.res.ok)parsed=JSON.parse(outputText(r.body));}catch{parsed=null;}}
 if(!parsed)return NextResponse.json({live:true,partial:true,error:"The live web search completed, but the structured research payload could not be validated after one retry.",stats:{sourcesFound:0,sourcesChecked:0,pagesProcessed:0,recordsExtracted:0,duplicatesRemoved:0,qualified:0,evidenceCoverage:0},results:[],sourceRegistry:[],accessEvents:[],billing:{provider:"openai",model,billable:true,usage:r.body?.usage??null}},{status:200});
 const retrievedSources:Array<{url:string;title:string;domain:string}>=[]; const seen=new Set<string>(); const collect=(s:any)=>{const url=normalizeUrl(String(s?.url||""));if(!url||seen.has(url))return;seen.add(url);retrievedSources.push({url,title:String(s?.title||""),domain:getDomain(url)});};
 for(const item of Array.isArray(r.body?.output)?r.body.output:[]){if(item?.type==="web_search_call"){for(const s of Array.isArray(item?.action?.sources)?item.action.sources:[])collect(s);} if(item?.type==="message"){for(const part of Array.isArray(item?.content)?item.content:[]){for(const a of Array.isArray(part?.annotations)?part.annotations:[])collect(a);}}}
 const sourceSet=new Set(retrievedSources.map(s=>s.url)); const raw=Array.isArray(parsed.results)?parsed.results:[]; const filtered=raw.filter((item:any)=>{const u=normalizeUrl(String(item?.url||"")); return u&&(sourceSet.size===0||sourceSet.has(u)||retrievedSources.some(s=>s.domain===getDomain(u)));}); const deduped=dedupeResults(filtered); const now=new Date().toISOString();
 const results:ResearchResult[]=deduped.out.slice(0,maxResults).map((item:any,i:number)=>({id:i+1,title:String(item?.title||"Untitled result"),location:String(item?.location||"not specified"),area:String(item?.area||"not specified"),price:String(item?.price||"not specified"),match:Number(item?.match||0),confidence:Number(item?.confidence||0),evidence:String(item?.evidence||""),evidenceQuote:String(item?.evidence_quote||""),status:["Verified","Reviewed","Manual review"].includes(item?.status)?item.status:"Reviewed",source:String(item?.source||"Web source"),sourceType:String(item?.source_type||"web"),sourceDomain:getDomain(String(item?.url||"")),url:normalizeUrl(String(item?.url||"")),why:String(item?.why||""),retrievedAt:String(item?.retrieved_at||now),freshnessDays:Math.max(0,Number(item?.freshness_days||0)),independentVerification:Boolean(item?.independent_verification)}));
 const sourcePlans: AccessEscalationPlan[] = [];
 const sourceRegistry:LiveSourceRecord[]=(Array.isArray(parsed.source_registry)?parsed.source_registry:[]).slice(0,maxSources).map((s:any)=>{
   const url=normalizeUrl(String(s?.url||""));
   const plan=buildAccessEscalationPlan({
     url,
     status:String(s?.access_status||"partial"),
     requiresAuth:String(s?.access_status||"").toLowerCase()==="auth_required",
     reason:String(s?.reason||""),
   });
   sourcePlans.push(plan);
   return {
     name:String(s?.name||"Unknown source"),
     url,
     domain:String(s?.domain||getDomain(url)),
     category:String(s?.category||"web"),
     accessStatus:plan.status as LiveSourceRecord["accessStatus"],
     accessMethod:String(s?.access_method||"web_search"),
     reason:plan.reason,
     evidenceAvailable:Boolean(s?.evidence_available),
     quality:Math.max(0,Math.min(100,Number(s?.quality||0))),
   };
 });
 for(const h of providerHints){if(!sourceRegistry.some(s=>normalizeUrl(s.url)===normalizeUrl(h.url)))sourceRegistry.push({name:h.title||h.domain||h.url,url:normalizeUrl(h.url),domain:h.domain||getDomain(h.url),category:`provider:${h.provider}`,accessStatus:"partial",accessMethod:h.provider,reason:"Discovery hint; page verification is separate.",evidenceAvailable:Boolean(h.snippet),quality:Math.max(45,Math.min(90,Math.round((h.score||0.6)*100)))});}
 const accessEvents:AccessEvent[]=(Array.isArray(parsed.access_events)?parsed.access_events:[]).slice(0,80).map((e:any)=>{
   const url=normalizeUrl(String(e?.url||""));
   const plan=buildAccessEscalationPlan({
     url,
     status:String(e?.status||"partial"),
     reason:String(e?.reason||""),
     captcha:String(e?.status||"").toLowerCase().includes("captcha"),
     requiresAuth:String(e?.status||"").toLowerCase().includes("auth"),
     rateLimited:String(e?.status||"").toLowerCase().includes("rate"),
     policyRestricted:String(e?.status||"").toLowerCase().includes("policy"),
   });
   return {
     url,
     status:plan.status,
     method:String(e?.method||"web_search"),
     reason:plan.reason,
     fallback:String(e?.fallback||plan.nextStep),
     nextStep:plan.nextStep,
     checkpointRequired:Boolean(plan.checkpoint?.required),
   };
 });
 const checkpointPlans = sourcePlans.filter((plan)=>Boolean(plan.checkpoint?.required));
 const checkpointByUrl = new Map(checkpointPlans.map((plan)=>[plan.checkpoint?.url || "", plan] as const));
 for (const event of accessEvents) {
   const plan=buildAccessEscalationPlan({url:event.url,status:event.status,reason:event.reason});
   sourcePlans.push(plan);
 }
 const escalation=accessEscalationSummary(sourcePlans);
 const accessCheckpoints=sourcePlans.flatMap((plan)=>plan.checkpoint?.required ? [plan.checkpoint] : []);
 const sourceDomains=new Set<string>(); for(const s of sourceRegistry)if(s.domain)sourceDomains.add(s.domain);for(const x of results)if(x.sourceDomain)sourceDomains.add(x.sourceDomain);
 const gated=results.map(item=>{const checks={sourceUrl:Boolean(item.url),sourceName:Boolean(item.source),evidence:Boolean(item.evidence),evidenceQuote:Boolean(item.evidenceQuote),title:Boolean(item.title&&item.title!=="Untitled result"),location:Boolean(item.location&&item.location!=="not specified"),structuredValue:Boolean((item.area&&item.area!=="not specified")||(item.price&&item.price!=="not specified")),confidence:item.confidence>=70,sourceCaptured:sourceSet.size===0||sourceSet.has(item.url)||sourceRegistry.some(s=>s.url===item.url||s.domain===item.sourceDomain),statusAllowed:["Verified","Reviewed","Manual review"].includes(item.status)};const passed=Object.values(checks).filter(Boolean).length,total=Object.keys(checks).length,gate=passed===total?"PASS":passed>=Math.ceil(total*.75)?"REVIEW":"FAIL";return {...item,qualityGate:{gate,passed,total,checks,independentVerification:item.independentVerification,note:gate==="PASS"?"Deterministic evidence/source checks passed.":"Manual review required."}};});
 const pass=gated.filter(x=>x.qualityGate.gate==="PASS").length,review=gated.filter(x=>x.qualityGate.gate==="REVIEW").length,fail=gated.filter(x=>x.qualityGate.gate==="FAIL").length,evidence=gated.filter(x=>x.qualityGate.checks.evidence&&x.qualityGate.checks.evidenceQuote).length;
 const queryUnderstanding:ResearchQueryUnderstanding={intent:String(parsed.query_understanding?.intent||"research"),entityType:String(parsed.query_understanding?.entity_type||"unknown"),geography:Array.isArray(parsed.query_understanding?.geography)?parsed.query_understanding.geography.map(String):[],languages:Array.isArray(parsed.query_understanding?.languages)?parsed.query_understanding.languages.map(String):[],criteria:Array.isArray(parsed.query_understanding?.criteria)?parsed.query_understanding.criteria.map(String):[],exclusions:Array.isArray(parsed.query_understanding?.exclusions)?parsed.query_understanding.exclusions.map(String):[],requiredFields:Array.isArray(parsed.query_understanding?.required_fields)?parsed.query_understanding.required_fields.map(String):[],sourceClasses:Array.isArray(parsed.query_understanding?.source_classes)?parsed.query_understanding.source_classes.map(String):[]};
 const billing={provider:"openai",model,billable:true,webSearchCalls:(Array.isArray(r.body?.output)?r.body.output:[]).filter((x:any)=>x?.type==="web_search_call").length,usage:r.body?.usage??null};
 return NextResponse.json({live:true,partial:false,model,query,generatedAt:now,elapsedMs:Date.now()-startedAt,searchPlan:String(parsed.search_plan||""),summary:String(parsed.search_summary||""),queryUnderstanding,searchBranches:Array.isArray(parsed.search_branches)?parsed.search_branches.map(String).slice(0,30):[],sourceRegistry,accessEvents,results:gated,sourceUrls:Array.from(new Set([...retrievedSources.map(s=>s.url),...sourceRegistry.map(s=>s.url),...results.map(x=>x.url)]).values()).filter(Boolean),sourceDomains:Array.from(sourceDomains),stats:{sourcesFound:sourceDomains.size,sourcesChecked:sourceRegistry.filter(s=>s.accessStatus==="checked").length,sourcesBlocked:sourceRegistry.filter(s=>s.accessStatus==="blocked"||s.accessStatus==="policy_restricted").length,sourcesManualReview:sourceRegistry.filter(s=>s.accessStatus==="auth_required"||s.accessStatus==="partial").length,pagesProcessed:new Set(results.map(x=>x.url).filter(Boolean)).size,recordsExtracted:raw.length,duplicatesRemoved:Math.max(Number(parsed.duplicates_removed||0),deduped.removed),qualified:pass+review,evidenceCoverage:gated.length?Math.round(evidence/gated.length*100):0,averageConfidence:gated.length?Math.round(gated.reduce((sum,x)=>sum+x.confidence,0)/gated.length):0,supplementalProviderHits:providerHints.length},accessEscalation:escalation,accessCheckpoints,qualityGate:{total:gated.length,pass,review,fail,independentVerification:gated.some(x=>x.independentVerification),ruleSet:["source URL present","source name present","evidence summary present","evidence quote present","title present","location present","area or price present","confidence >= 70","source captured","allowed verification status"]},billing},{status:200,headers:{"Cache-Control":"no-store,max-age=0"}});
}
