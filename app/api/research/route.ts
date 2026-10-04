import { NextResponse } from "next/server";
import { UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN, UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU } from "@/lib/research-prompts";
import type { ResearchQueryUnderstanding, LiveSourceRecord, AccessEvent } from "@/lib/research-contract";
import { getSearchProviderCatalog, runProviderDiscovery } from "@/lib/provider-search";
import { buildSearchMatrix } from "@/lib/search-matrix";
import { accessEscalationSummary, buildAccessEscalationPlan, type AccessEscalationPlan } from "@/lib/access-escalation";
import { runFreeResearch } from "@/lib/free-research";
import { filterResearchResults } from "@/lib/relevance-gate";
import { getResearchMemoryContext, recordResearchLearning } from "@/lib/memory";
import { applyQualityGate, dedupeResults } from "@/lib/result-quality";
import { errorBody } from "@/lib/research-errors";
import { checkResearchQuota, resolvePlan, clampToPlan } from "@/lib/plans";
import { taskSpecificRules } from "@/lib/research-prompts";
import { editionFor, pipelineFor } from "@/lib/editions";

export const runtime = "nodejs";
export const maxDuration = 240;

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

export async function POST(request:Request){
 let body:ResearchRequest; try{body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON request body."},{status:400});}
 const query=String(body.query||"").trim(); if(!query)return NextResponse.json({error:"Query is required."},{status:400});
 const plan=resolvePlan(request);
 const quota=await checkResearchQuota(request,plan);
 if(!quota.allowed){const e=errorBody(quota.error);return NextResponse.json({...e.body,plan:plan.id,usage:quota.usage},{status:e.status});}
 const limits=clampToPlan(plan,{depth:body.depth,maxResults:body.maxResults,maxSources:body.maxSources,maxPages:body.maxPages});
 if(pipelineFor(plan)==="free"){
   try{
     const memoryContext=await getResearchMemoryContext(query,40);
     const result=await runFreeResearch({
       query,
       language:body.language==="en"?"en":"ru",
       depth:limits.depth,
       maxResults:limits.maxResults,
       maxSources:limits.maxSources,
       maxPages:limits.maxPages,
       multilingual:body.multilingual!==false,
       followRelatedLinks:body.followRelatedLinks!==false,
       testMode:limits.depth==="Quick",
       deadlineAt:Date.now()+52_000,
       sourceMemory:memoryContext.sources,
       edition:editionFor(plan),
       knownSourceCount:memoryContext.sources.length,
     });
     await Promise.race([
       recordResearchLearning({
         taskId:String(result?.task?.responseId || result?.task?.id || ""),
         query,
         sourceRegistry:result?.sourceRegistry||[],
         results:result?.results||[],
         stats:result?.stats||{},
       }),
       new Promise(resolve=>setTimeout(resolve,1800)),
     ]);
     return NextResponse.json({...result,memory:{persistent:memoryContext.persistent},plan:{id:plan.id,usage:quota.usage}},{status:200,headers:{"Cache-Control":"no-store"}});
   }catch(error){
     const e=errorBody(error,"Free research failed.");
     return NextResponse.json(e.body,{status:e.status});
   }
 }
 const apiKey=process.env.OPENAI_API_KEY; const model=process.env.OPENAI_MODEL||"gpt-5.5";
 if(!apiKey)return NextResponse.json({error:"OPENAI_API_KEY is not configured.",code:"AI_PROVIDER_NOT_CONFIGURED"},{status:503});
 const language = body.language === "en" ? "en" : "ru"; const depth = limits.depth; const maxResults = limits.maxResults; const maxSources=limits.maxSources; const maxPages=limits.maxPages; const multilingual=body.multilingual!==false; const followRelatedLinks=body.followRelatedLinks!==false;
 const supplementalEnabled = process.env.SUPPLEMENTAL_SEARCH_ENABLED !== "false";
 const multilingualLabelRu = multilingual ? "включена" : "выключена";
 const relatedLinksLabelRu = followRelatedLinks ? "включены" : "выключены";
 const multilingualLabelEn = multilingual ? "on" : "off";
 const relatedLinksLabelEn = followRelatedLinks ? "on" : "off"; const searchMatrix=buildSearchMatrix(query,language); let providerHints:any[]=[]; if(supplementalEnabled){try{providerHints=await Promise.race([runProviderDiscovery(query,language),new Promise<any[]>(resolve=>setTimeout(()=>resolve([]),Number(process.env.SUPPLEMENTAL_SEARCH_TIMEOUT_MS||7000)))])}catch{providerHints=[];}} const providerCatalog=getSearchProviderCatalog();
 const providerHintBlock = providerHints.slice(0, 40).map((h: any) => ({ provider: h.provider, engine: h.engine, query: h.query, title: h.title, url: h.url, domain: h.domain, snippet: String(h.snippet || "").slice(0, 700) }));
 const readerHints:any[] = [];
 const systemPrompt=(language==="ru"?UNIVERSAL_RESEARCH_SYSTEM_PROMPT_RU:UNIVERSAL_RESEARCH_SYSTEM_PROMPT_EN)+taskSpecificRules(query,language);
 const userPrompt=language==="ru"?`Исходный запрос пользователя:\n${query}\n\nРежим: ${depth}. Лимиты: ${maxSources} источников, ${maxPages} URL, ${maxResults} результатов. Мультиязычность: ${multilingualLabelRu}. Связанные страницы: ${relatedLinksLabelRu}.\n\nКАТАЛОГ ПОИСКА:\n${JSON.stringify(providerCatalog)}\n\nМАТРИЦА ВЕТОК:\n${JSON.stringify(searchMatrix)}\n\nДОПОЛНИТЕЛЬНЫЕ КАНДИДАТЫ:\n${JSON.stringify(providerHintBlock)}\n\nВыполни реальный глубокий web search несколькими независимыми ветками; используй локальные языки, официальные/государственные источники, каталоги, компании, документы, новости и публичные сообщества. Не используй закрытые аккаунты и обход авторизации. Для каждого результата нужны реальный URL и evidence_quote. Не выдумывай данные. Дубли удаляй.`:`User request:\n${query}\n\nMode: ${depth}. Limits: ${maxSources} sources, ${maxPages} URLs, ${maxResults} results. Multilingual: ${multilingualLabelEn}. Related pages: ${relatedLinksLabelEn}.\n\nSEARCH PROVIDER CATALOG:\n${JSON.stringify(providerCatalog)}\n\nSEARCH MATRIX:\n${JSON.stringify(searchMatrix)}\n\nSUPPLEMENTAL CANDIDATES:\n${JSON.stringify(providerHintBlock)}\n\nPUBLIC READER EXTRACTS (only from configured public-reader services):\n${JSON.stringify(readerHints)}\n\nPerform real deep web search across independent branches; use regional languages, official/government sources, directories, companies, documents, news and public communities. Do not use closed accounts or auth bypass. Every result needs a real URL and evidence_quote. Never invent data. Remove duplicates.

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
 const searchContextSize = depth === "Deep" ? "medium" : "low";
 const reasoningEffort = depth === "Deep" ? "medium" : "low";
 const maxOutputTokens = depth === "Deep" ? 8000 : 6000;
 const call = async (retry: boolean, timeoutMs: number) => { const res = await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({model,input:[{role:"system",content:systemPrompt},{role:"user",content:userPrompt+(retry?"\nReturn concise schema-valid JSON only.":"")}],tools:[{type:"web_search",search_context_size:searchContextSize}],tool_choice:"required",include:["web_search_call.action.sources"],reasoning:{effort:reasoningEffort},text:{format:{type:"json_schema",name:"aurelius_research_result",strict:true,schema}},max_output_tokens:maxOutputTokens})});return {res,body:await res.json()};};
 let r; const primaryTimeout=Number(process.env.OPENAI_RESEARCH_TIMEOUT_MS||120000); try{r=await call(false,primaryTimeout);}catch(e){const timeout=e instanceof Error&&(e.name==="TimeoutError"||e.name==="AbortError");return NextResponse.json({error:timeout?"OpenAI did not respond within "+Math.round(primaryTimeout/1000)+"s.":(e instanceof Error?e.message:"OpenAI request failed."),code:timeout?"UPSTREAM_TIMEOUT":"SEARCH_PROVIDERS_FAILED",diagnostics:{timeoutMs:primaryTimeout}},{status:timeout?504:502});}
 if(!r.res.ok)return NextResponse.json({error:r.body?.error?.message||"OpenAI live research request failed.",code:"SEARCH_PROVIDERS_FAILED",diagnostics:{upstreamStatus:r.res.status}},{status:r.res.status===429?429:502});
 let parsed:any=null;try{parsed=JSON.parse(outputText(r.body));}catch{const retryMs=Number(process.env.OPENAI_RETRY_TIMEOUT_MS||25000);try{r=await call(true,retryMs);if(r.res.ok)parsed=JSON.parse(outputText(r.body));}catch{parsed=null;}}
 if(!parsed)return NextResponse.json({live:true,partial:true,code:"AI_OUTPUT_INVALID",error:"The live web search completed, but the structured research payload could not be validated within the bounded request window.",stats:{sourcesFound:0,sourcesChecked:0,pagesProcessed:0,recordsExtracted:0,duplicatesRemoved:0,qualified:0,evidenceCoverage:0},results:[],sourceRegistry:[],accessEvents:[],billing:{provider:"openai",model,billable:true,usage:r.body?.usage??null}},{status:200});
 const retrievedSources:Array<{url:string;title:string;domain:string}>=[]; const seen=new Set<string>(); const collect=(s:any)=>{const url=normalizeUrl(String(s?.url||""));if(!url||seen.has(url))return;seen.add(url);retrievedSources.push({url,title:String(s?.title||""),domain:getDomain(url)});};
 const outputItems = Array.isArray(r.body?.output) ? r.body.output : [];
 for (const item of outputItems) {
   if (item?.type === "web_search_call") {
     const sources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
     for (const source of sources) collect(source);
   }
   if (item?.type === "message") {
     const parts = Array.isArray(item?.content) ? item.content : [];
     for (const part of parts) {
       const annotations = Array.isArray(part?.annotations) ? part.annotations : [];
       for (const annotation of annotations) collect(annotation);
     }
   }
 }
 const sourceSet=new Set(retrievedSources.map(s=>s.url)); const raw=Array.isArray(parsed.results)?parsed.results:[]; const filtered=raw.filter((item:any)=>{const u=normalizeUrl(String(item?.url||"")); return u&&(sourceSet.size===0||sourceSet.has(u)||retrievedSources.some(s=>s.domain===getDomain(u)));}); const relevance=filterResearchResults(filtered,query,{geography:Array.isArray(parsed.query_understanding?.geography)?parsed.query_understanding.geography.map(String):[]}); const deduped=dedupeResults(relevance.kept,query); const now=new Date().toISOString();
 const results:ResearchResult[]=deduped.out.slice(0,maxResults).map((item:any,i:number)=>({id:i+1,title:String(item?.title||"Untitled result"),location:String(item?.location||"not specified"),area:String(item?.area||"not specified"),price:String(item?.price||"not specified"),match:Number(item?.match||0),confidence:Number(item?.confidence||0),evidence:String(item?.evidence||""),evidenceQuote:String(item?.evidence_quote||""),status:["Verified","Reviewed","Manual review"].includes(item?.status)?item.status:"Reviewed",relevanceTier:String(item?.relevanceTier||"accept"),relevanceScore:Number(item?.relevanceScore??60),relevanceReason:String(item?.relevanceReason||""),source:String(item?.source||"Web source"),sourceType:String(item?.source_type||"web"),sourceDomain:getDomain(String(item?.url||"")),url:normalizeUrl(String(item?.url||"")),why:String(item?.why||""),retrievedAt:String(item?.retrieved_at||now),freshnessDays:Math.max(0,Number(item?.freshness_days||0)),independentVerification:Boolean(item?.independent_verification)}));
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
 for (const event of accessEvents) {
   const plan = buildAccessEscalationPlan({
     url: event.url,
     status: event.status,
     reason: event.reason,
   });
   sourcePlans.push(plan);
 }
 const escalation=accessEscalationSummary(sourcePlans);
 const accessCheckpoints=sourcePlans.flatMap((plan)=>plan.checkpoint?.required ? [plan.checkpoint] : []);
 const sourceDomains=new Set<string>(); for(const s of sourceRegistry)if(s.domain)sourceDomains.add(s.domain);for(const x of results)if(x.sourceDomain)sourceDomains.add(x.sourceDomain);
 const gate=applyQualityGate(results,{query,knownUrls:new Set([...sourceSet,...sourceRegistry.map(x=>x.url)]),knownDomains:new Set([...retrievedSources.map(x=>x.domain),...sourceRegistry.map(x=>x.domain)].filter(Boolean))});
 const gated=gate.results; const pass=gate.summary.pass,review=gate.summary.review,fail=gate.summary.fail,evidence=gate.summary.evidenceCount;
 const queryUnderstanding:ResearchQueryUnderstanding={intent:String(parsed.query_understanding?.intent||"research"),entityType:String(parsed.query_understanding?.entity_type||"unknown"),geography:Array.isArray(parsed.query_understanding?.geography)?parsed.query_understanding.geography.map(String):[],languages:Array.isArray(parsed.query_understanding?.languages)?parsed.query_understanding.languages.map(String):[],criteria:Array.isArray(parsed.query_understanding?.criteria)?parsed.query_understanding.criteria.map(String):[],exclusions:Array.isArray(parsed.query_understanding?.exclusions)?parsed.query_understanding.exclusions.map(String):[],requiredFields:Array.isArray(parsed.query_understanding?.required_fields)?parsed.query_understanding.required_fields.map(String):[],sourceClasses:Array.isArray(parsed.query_understanding?.source_classes)?parsed.query_understanding.source_classes.map(String):[]};
 const billing={provider:"openai",model,billable:true,webSearchCalls:(Array.isArray(r.body?.output)?r.body.output:[]).filter((x:any)=>x?.type==="web_search_call").length,usage:r.body?.usage??null};
 return NextResponse.json({live:true,partial:false,model,query,generatedAt:now,elapsedMs:Date.now()-startedAt,searchPlan:String(parsed.search_plan||""),summary:String(parsed.search_summary||""),queryUnderstanding,searchBranches:Array.isArray(parsed.search_branches)?parsed.search_branches.map(String).slice(0,30):[],sourceRegistry,accessEvents,results:gated,sourceUrls:Array.from(new Set([...retrievedSources.map(s=>s.url),...sourceRegistry.map(s=>s.url),...results.map(x=>x.url)]).values()).filter(Boolean),sourceDomains:Array.from(sourceDomains),stats:{sourcesFound:sourceDomains.size,sourcesChecked:sourceRegistry.filter(s=>s.accessStatus==="checked").length,sourcesBlocked:sourceRegistry.filter(s=>s.accessStatus==="blocked"||s.accessStatus==="policy_restricted"||s.accessStatus==="captcha_required").length,sourcesManualReview:sourceRegistry.filter(s=>s.accessStatus==="auth_required"||s.accessStatus==="partial"||s.accessStatus==="captcha_required"||s.accessStatus==="rate_limited").length,pagesProcessed:new Set(results.map(x=>x.url).filter(Boolean)).size,recordsExtracted:raw.length,duplicatesRemoved:Math.max(Number(parsed.duplicates_removed||0),deduped.removed),relevanceRejected:relevance.rejected.length,qualified:pass+review,verified:gated.filter(x=>x.status==="Verified").length,evidenceCoverage:gated.length?Math.round(evidence/gated.length*100):0,averageConfidence:gated.length?Math.round(gated.reduce((sum,x)=>sum+x.confidence,0)/gated.length):0,supplementalProviderHits:providerHints.length},accessEscalation:escalation,accessCheckpoints,qualityGate:{total:gated.length,pass,review,fail,independentVerification:gate.summary.independentVerification,ruleSet:gate.summary.ruleSet},rejectedCandidates:relevance.rejected,plan:{id:plan.id,usage:quota.usage},billing},{status:200,headers:{"Cache-Control":"no-store,max-age=0"}});
}
