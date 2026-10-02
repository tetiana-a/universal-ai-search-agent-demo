"use client";

export type ExportResult = {
  id?: number;
  title?: string; location?: string; area?: string; price?: string;
  match?: number; confidence?: number; evidence?: string; evidenceQuote?: string;
  source?: string; sourceType?: string; sourceDomain?: string; url?: string;
  status?: string; why?: string; retrievedAt?: string; freshnessDays?: number;
  independentVerification?: boolean;
  qualityGate?: { gate?: string; passed?: number; total?: number };
};

export type ExportSource = {
  name?: string; url?: string; domain?: string; category?: string;
  accessStatus?: string; access_status?: string; accessMethod?: string;
  access_method?: string; reason?: string; evidenceAvailable?: boolean;
  evidence_available?: boolean; quality?: number;
};

export type ResearchExportPayload = {
  query?: string; generatedAt?: string; searchPlan?: string; searchSummary?: string;
  stats?: Record<string, number|string>; billing?: Record<string, unknown>;
  results: ExportResult[]; sourceRegistry?: ExportSource[];
};

function safePart(v:string){return (v.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70)||"research");}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
function pct(v:any){return `${Math.max(0,Math.min(100,Number(v||0)))}%`;}
function sourceStatus(s:ExportSource){return s.accessStatus||s.access_status||"";}
function sourceMethod(s:ExportSource){return s.accessMethod||s.access_method||"";}
function sourceEvidence(s:ExportSource){return s.evidenceAvailable??s.evidence_available??false;}

const resultHeaders=["#","Title","Location","Area / Profile","Price / Round","Match","Confidence","Status","Quality Gate","Source","Domain","URL","Evidence","Evidence Quote","Why it matches","Retrieved At","Freshness (days)","Independent Verification"];

function resultRow(item:ExportResult,i:number){
 return [i+1,item.title||"",item.location||"",item.area||"",item.price||"",pct(item.match),pct(item.confidence),item.status||"",item.qualityGate?.gate||"",item.source||"",item.sourceDomain||"",item.url||"",item.evidence||"",item.evidenceQuote||"",item.why||"",item.retrievedAt||"",item.freshnessDays??"",item.independentVerification?"Yes":"No"];
}

export function exportCsvFile(payload:ResearchExportPayload){
 const rows=[resultHeaders,...payload.results.map(resultRow)];
 const csv="\uFEFF"+rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""').replace(/\r?\n/g," ")}"`).join(";")).join("\r\n");
 downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),`aurelius-${safePart(payload.query||"research")}.csv`);
}

export async function exportExcelFile(payload:ResearchExportPayload){
 const mod:any=await import("exceljs"); const ExcelJS:any=mod.default??mod;
 const wb=new ExcelJS.Workbook(); wb.creator="AURELIUS Universal AI Research Engine"; wb.created=new Date(); wb.modified=new Date();
 const ws=wb.addWorksheet("Results",{views:[{state:"frozen",ySplit:6}],pageSetup:{orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:0}});
 ws.mergeCells("A1:R1");ws.getCell("A1").value="AURELIUS • RESEARCH RESULTS";ws.getCell("A1").font={bold:true,size:16,color:{argb:"FFFFFFFF"}};ws.getCell("A1").fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1F2937"}};ws.getCell("A1").alignment={horizontal:"center"};ws.getRow(1).height=26;
 ws.mergeCells("A2:R2");ws.getCell("A2").value=`Query: ${payload.query||"—"}`;ws.getCell("A2").alignment={wrapText:true};
 ws.mergeCells("A3:R3");ws.getCell("A3").value=`Generated: ${payload.generatedAt||new Date().toISOString()}`;
 const stats=Object.entries(payload.stats||{}); let sc=1; for(const [k,v] of stats.slice(0,8)){ws.getCell(4,sc).value=k;ws.getCell(4,sc).font={bold:true,size:9};ws.getCell(4,sc+1).value=v;sc+=2;}
 resultHeaders.forEach((h,i)=>{const c=ws.getCell(6,i+1);c.value=h;c.font={bold:true,color:{argb:"FFFFFFFF"},size:9};c.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF374151"}};c.alignment={horizontal:"center",vertical:"middle",wrapText:true};});ws.getRow(6).height=32;
 payload.results.forEach((item,i)=>{const row=ws.addRow(resultRow(item,i));row.height=70;row.eachCell((c,n)=>{c.alignment={vertical:"top",wrapText:true};c.font={size:9};c.border={bottom:{style:"thin",color:{argb:"FFE5E7EB"}}};if(n===6||n===7)c.alignment={horizontal:"center",vertical:"top"};});const gate=String(item.qualityGate?.gate||"");row.getCell(9).font={bold:true,size:9,color:{argb:gate==="PASS"?"FF15803D":gate==="REVIEW"?"FFB45309":"FFDC2626"}};if(item.url){row.getCell(12).value={text:item.url,hyperlink:item.url};row.getCell(12).font={color:{argb:"FF2563EB"},underline:true,size:9};}});
 [6,34,24,18,18,11,12,16,14,26,22,48,44,50,42,22,16,22].forEach((w,i)=>ws.getColumn(i+1).width=w);
 ws.autoFilter={from:"A6",to:`R${Math.max(6,ws.rowCount)}`}; if(ws.rowCount>=6)ws.addTable({name:"AureliusResults",ref:`A6:R${Math.max(6,ws.rowCount)}`,headerRow:true,style:{theme:"TableStyleMedium2",showRowStripes:true}});
 const ss=wb.addWorksheet("Search Summary");ss.columns=[{header:"Field",key:"field",width:32},{header:"Value",key:"value",width:120}];ss.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};ss.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF374151"}};ss.addRow({field:"Query",value:payload.query||""});ss.addRow({field:"Generated",value:payload.generatedAt||new Date().toISOString()});ss.addRow({field:"Search plan",value:payload.searchPlan||""});ss.addRow({field:"Search summary",value:payload.searchSummary||""});for(const [k,v] of Object.entries(payload.stats||{}))ss.addRow({field:k,value:String(v)});for(const [k,v] of Object.entries(payload.billing||{}))ss.addRow({field:`billing.${k}`,value:typeof v==="object"?JSON.stringify(v):String(v)});ss.eachRow(r=>r.alignment={vertical:"top",wrapText:true});
 const src=wb.addWorksheet("Source Registry");src.columns=[{header:"Source",key:"name",width:34},{header:"Domain",key:"domain",width:28},{header:"Category",key:"category",width:24},{header:"Access",key:"access",width:18},{header:"Method",key:"method",width:22},{header:"Quality",key:"quality",width:10},{header:"Evidence",key:"evidence",width:12},{header:"URL",key:"url",width:60},{header:"Reason",key:"reason",width:65}];src.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};src.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF374151"}};(payload.sourceRegistry||[]).forEach(s=>{const r=src.addRow({name:s.name||"",domain:s.domain||"",category:s.category||"",access:sourceStatus(s),method:sourceMethod(s),quality:Number(s.quality??0),evidence:sourceEvidence(s)?"Yes":"No",url:s.url||"",reason:s.reason||""});r.alignment={vertical:"top",wrapText:true};if(s.url){r.getCell(8).value={text:s.url,hyperlink:s.url};r.getCell(8).font={color:{argb:"FF2563EB"},underline:true}}});src.autoFilter={from:"A1",to:`I${Math.max(1,src.rowCount)}`};
 const buf=await wb.xlsx.writeBuffer();downloadBlob(new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),`aurelius-${safePart(payload.query||"research")}.xlsx`);
}

function compact(v:any,n=170){const s=String(v??"").replace(/\s+/g," ").trim();return s.length>n?s.slice(0,n-1)+"…":s;}
export async function exportPdfFile(payload:ResearchExportPayload){
 const pm:any=(await import("pdfmake/build/pdfmake")).default??await import("pdfmake/build/pdfmake");
 const pf:any=(await import("pdfmake/build/vfs_fonts")).default??await import("pdfmake/build/vfs_fonts");
 const pdf:any=pm;const vfs=pf?.pdfMake?.vfs??pf?.vfs;if(!vfs)throw new Error("PDF fonts are unavailable.");pdf.vfs=vfs;
 const body=[resultHeaders.slice(0,12).map(text=>({text,bold:true,color:"#FFFFFF"})),...payload.results.map((x,i)=>resultRow(x,i).slice(0,12).map(v=>compact(v,90)))];
 const sourceBody=[[{text:"Source",bold:true,color:"#FFFFFF"},{text:"Domain",bold:true,color:"#FFFFFF"},{text:"Access",bold:true,color:"#FFFFFF"},{text:"Quality",bold:true,color:"#FFFFFF"},{text:"URL",bold:true,color:"#FFFFFF"}],...(payload.sourceRegistry||[]).map(s=>[compact(s.name||s.domain,35),compact(s.domain,28),sourceStatus(s),String(s.quality??""),s.url||""])];
 const statBody=Object.entries(payload.stats||{}).map(([k,v])=>[{text:k,bold:true},String(v)]);
 const doc:any={pageSize:"A4",pageOrientation:"landscape",pageMargins:[18,24,18,24],defaultStyle:{font:"Roboto",fontSize:7},footer:(p:number,n:number)=>({text:`AURELIUS • ${p}/${n}`,alignment:"right",fontSize:7,margin:[18,6,18,0]}),content:[
 {text:"AURELIUS • RESEARCH EXPORT",fontSize:16,bold:true,margin:[0,0,0,5]},
 {text:`Query: ${payload.query||"—"}`,fontSize:9,margin:[0,0,0,3]},
 {text:`Generated: ${payload.generatedAt||new Date().toISOString()}`,fontSize:8,color:"#666666",margin:[0,0,0,8]},
 ...(payload.searchSummary?[{text:compact(payload.searchSummary,600),fontSize:8,margin:[0,0,0,8]}]:[]),
 ...(statBody.length?[{table:{widths:[90,70],body:statBody},layout:"lightHorizontalLines",margin:[0,0,0,8]}]:[]),
 {table:{headerRows:1,widths:[16,70,55,40,48,30,34,45,28,60,58,130],body},layout:{fillColor:(r:number)=>r===0?"#374151":r%2===0?"#F3F4F6":null,hLineColor:()=>"#D1D5DB",vLineColor:()=>"#D1D5DB",paddingLeft:()=>2,paddingRight:()=>2,paddingTop:()=>2,paddingBottom:()=>2}},
 ...(sourceBody.length>1?[{text:"Source Registry",pageBreak:"before",fontSize:12,bold:true,margin:[0,0,0,7]},{table:{headerRows:1,widths:[125,85,60,45,330],body:sourceBody},layout:{fillColor:(r:number)=>r===0?"#374151":null,hLineColor:()=>"#D1D5DB",vLineColor:()=>"#D1D5DB",fontSize:7}}]:[])
 ],};
 pdf.createPdf(doc).download(`aurelius-${safePart(payload.query||"research")}.pdf`);
}
export const exportXlsxFile=exportExcelFile;
export const exportJsonFile=(payload:ResearchExportPayload)=>downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),`aurelius-${safePart(payload.query||"research")}.json`);
