"use client";

export type ExportResult = {
  id?: number; title?: string; location?: string; area?: string; price?: string;
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
  stats?: Record<string, number | string>; billing?: Record<string, unknown>;
  results: ExportResult[]; sourceRegistry?: ExportSource[];
};

function safePart(value: string) {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const result = normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return result || "research";
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pct(value: unknown) {
  const numeric = Number(value || 0);
  return `${Math.max(0, Math.min(100, numeric))}%`;
}
function sourceStatus(source: ExportSource) { return source.accessStatus !== undefined ? source.accessStatus : source.access_status || ""; }
function sourceMethod(source: ExportSource) { return source.accessMethod !== undefined ? source.accessMethod : source.access_method || ""; }
function sourceEvidence(source: ExportSource) { return source.evidenceAvailable !== undefined ? source.evidenceAvailable : Boolean(source.evidence_available); }
function gateColor(gate: string) {
  if (gate === "PASS") return "FF15803D";
  if (gate === "REVIEW") return "FFB45309";
  return "FFDC2626";
}
function rowFillColor(row: number) {
  if (row === 0) return "#374151";
  return row % 2 === 0 ? "#F3F4F6" : null;
}
function compact(value: unknown, limit = 170) {
  let text = "";
  if (value === null || value === undefined) text = "";
  else if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else { try { text = JSON.stringify(value); } catch { text = ""; } }
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? normalized.slice(0, limit - 1) + "…" : normalized;
}

const resultHeaders = ["#","Title","Location","Area / Profile","Price / Round","Match","Confidence","Status","Quality Gate","Source","Domain","URL","Evidence","Evidence Quote","Why it matches","Retrieved At","Freshness (days)","Independent Verification"];

function resultRow(item: ExportResult, index: number) {
  return [index + 1, item.title || "", item.location || "", item.area || "", item.price || "", pct(item.match), pct(item.confidence), item.status || "", item.qualityGate?.gate || "", item.source || "", item.sourceDomain || "", item.url || "", item.evidence || "", item.evidenceQuote || "", item.why || "", item.retrievedAt || "", item.freshnessDays ?? "", item.independentVerification ? "Yes" : "No"];
}

export function exportCsvFile(payload: ResearchExportPayload) {
  const rows = [resultHeaders, ...payload.results.map((item, index) => resultRow(item, index))];
  const csvEscape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return '"' + text.replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  };
  const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `aurelius-${safePart(payload.query || "research")}.csv`);
}

export async function exportExcelFile(payload: ResearchExportPayload) {
  const mod: any = await import("exceljs");
  const ExcelJS: any = mod.default || mod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AURELIUS Universal AI Research Engine";
  workbook.created = new Date(); workbook.modified = new Date();
  const ws = workbook.addWorksheet("Results", { views: [{ state: "frozen", ySplit: 6 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.mergeCells("A1:R1"); ws.getCell("A1").value = "AURELIUS • RESEARCH RESULTS";
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  ws.getCell("A1").alignment = { horizontal: "center" }; ws.getRow(1).height = 26;
  ws.mergeCells("A2:R2"); ws.getCell("A2").value = `Query: ${payload.query || "—"}`; ws.getCell("A2").alignment = { wrapText: true };
  ws.mergeCells("A3:R3"); ws.getCell("A3").value = `Generated: ${payload.generatedAt || new Date().toISOString()}`;
  const statEntries = Object.entries(payload.stats || {});
  let statColumn = 1;
  for (const [key, value] of statEntries.slice(0, 8)) {
    ws.getCell(4, statColumn).value = key; ws.getCell(4, statColumn).font = { bold: true, size: 9 };
    ws.getCell(4, statColumn + 1).value = value; statColumn += 2;
  }
  resultHeaders.forEach((header, index) => {
    const cell = ws.getCell(6, index + 1); cell.value = header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 9 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(6).height = 32;
  payload.results.forEach((item, index) => {
    const row = ws.addRow(resultRow(item, index)); row.height = 70;
    row.eachCell((cell: any, column: number) => {
      cell.alignment = { vertical: "top", wrapText: true }; cell.font = { size: 9 };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
      if (column === 6 || column === 7) cell.alignment = { horizontal: "center", vertical: "top" };
    });
    const gate = String(item.qualityGate?.gate || "");
    row.getCell(9).font = { bold: true, size: 9, color: { argb: gateColor(gate) } };
    if (item.url) { row.getCell(12).value = { text: item.url, hyperlink: item.url }; row.getCell(12).font = { color: { argb: "FF2563EB" }, underline: true, size: 9 }; }
  });
  [6,34,24,18,18,11,12,16,14,26,22,48,44,50,42,22,16,22].forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  ws.autoFilter = { from: "A6", to: `R${Math.max(6, ws.rowCount)}` };
  if (ws.rowCount >= 6) ws.addTable({ name: "AureliusResults", ref: `A6:R${Math.max(6, ws.rowCount)}`, headerRow: true, style: { theme: "TableStyleMedium2", showRowStripes: true } });
  const summary = workbook.addWorksheet("Search Summary");
  summary.columns = [{ header: "Field", key: "field", width: 32 }, { header: "Value", key: "value", width: 120 }];
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  summary.addRow({ field: "Query", value: payload.query || "" }); summary.addRow({ field: "Generated", value: payload.generatedAt || new Date().toISOString() });
  summary.addRow({ field: "Search plan", value: payload.searchPlan || "" }); summary.addRow({ field: "Search summary", value: payload.searchSummary || "" });
  for (const [key, value] of Object.entries(payload.stats || {})) summary.addRow({ field: key, value: String(value) });
  for (const [key, value] of Object.entries(payload.billing || {})) {
    let billingValue = "";
    if (value !== null && typeof value === "object") billingValue = JSON.stringify(value); else billingValue = String(value);
    summary.addRow({ field: `billing.${key}`, value: billingValue });
  }
  summary.eachRow((row: any) => { row.alignment = { vertical: "top", wrapText: true }; });
  const source = workbook.addWorksheet("Source Registry");
  source.columns = [{header:"Source",key:"name",width:34},{header:"Domain",key:"domain",width:28},{header:"Category",key:"category",width:24},{header:"Access",key:"access",width:18},{header:"Method",key:"method",width:22},{header:"Quality",key:"quality",width:10},{header:"Evidence",key:"evidence",width:12},{header:"URL",key:"url",width:60},{header:"Reason",key:"reason",width:65}];
  source.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; source.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
  for (const item of payload.sourceRegistry || []) {
    const row = source.addRow({ name: item.name || "", domain: item.domain || "", category: item.category || "", access: sourceStatus(item), method: sourceMethod(item), quality: Number(item.quality ?? 0), evidence: sourceEvidence(item) ? "Yes" : "No", url: item.url || "", reason: item.reason || "" });
    row.alignment = { vertical: "top", wrapText: true };
    if (item.url) { row.getCell(8).value = { text: item.url, hyperlink: item.url }; row.getCell(8).font = { color: { argb: "FF2563EB" }, underline: true }; }
  }
  source.autoFilter = { from: "A1", to: `I${Math.max(1, source.rowCount)}` };
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `aurelius-${safePart(payload.query || "research")}.xlsx`);
}

export async function exportPdfFile(payload: ResearchExportPayload) {
  const pdfmakeModule: any = await import("pdfmake/build/pdfmake");
  const fontsModule: any = await import("pdfmake/build/vfs_fonts");
  const pdf: any = pdfmakeModule.default || pdfmakeModule;
  const fonts: any = fontsModule.default || fontsModule;
  const vfs = fonts?.pdfMake?.vfs || fonts?.vfs;
  if (!vfs) throw new Error("PDF fonts are unavailable.");
  pdf.vfs = vfs;
  const body = [resultHeaders.slice(0, 12).map(text => ({ text, bold: true, color: "#FFFFFF" })), ...payload.results.map((item, index) => resultRow(item, index).slice(0, 12).map(value => compact(value, 90)))];
  const sourceBody = [[{ text: "Source", bold: true, color: "#FFFFFF" }, { text: "Domain", bold: true, color: "#FFFFFF" }, { text: "Access", bold: true, color: "#FFFFFF" }, { text: "Quality", bold: true, color: "#FFFFFF" }, { text: "URL", bold: true, color: "#FFFFFF" }]];
  for (const item of payload.sourceRegistry || []) sourceBody.push([compact(item.name || item.domain, 35), compact(item.domain, 28), sourceStatus(item), String(item.quality ?? ""), item.url || ""] as any);
  const statBody = Object.entries(payload.stats || {}).map(([key, value]) => [{ text: key, bold: true }, String(value)]);
  const content: any[] = [
    { text: "AURELIUS • RESEARCH EXPORT", fontSize: 16, bold: true, margin: [0,0,0,5] },
    { text: `Query: ${payload.query || "—"}`, fontSize: 9, margin: [0,0,0,3] },
    { text: `Generated: ${payload.generatedAt || new Date().toISOString()}`, fontSize: 8, color: "#666666", margin: [0,0,0,8] },
  ];
  if (payload.searchSummary) content.push({ text: compact(payload.searchSummary, 600), fontSize: 8, margin: [0,0,0,8] });
  if (statBody.length > 0) content.push({ table: { widths: [90,70], body: statBody }, layout: "lightHorizontalLines", margin: [0,0,0,8] });
  content.push({ table: { headerRows: 1, widths: [16,70,55,40,48,30,34,45,28,60,58,130], body }, layout: { fillColor: rowFillColor, hLineColor: () => "#D1D5DB", vLineColor: () => "#D1D5DB", paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2 } });
  if (sourceBody.length > 1) {
    content.push({ text: "Source Registry", pageBreak: "before", fontSize: 12, bold: true, margin: [0,0,0,7] });
    content.push({ table: { headerRows: 1, widths: [125,85,60,45,330], body: sourceBody }, layout: { fillColor: (row: number) => row === 0 ? "#374151" : null, hLineColor: () => "#D1D5DB", vLineColor: () => "#D1D5DB", fontSize: 7 } });
  }
  const docDefinition: any = { pageSize: "A4", pageOrientation: "landscape", pageMargins: [18,24,18,24], defaultStyle: { font: "Roboto", fontSize: 7 }, footer: (page: number, count: number) => ({ text: `AURELIUS • ${page}/${count}`, alignment: "right", fontSize: 7, margin: [18,6,18,0] }), content };
  pdf.createPdf(docDefinition).download(`aurelius-${safePart(payload.query || "research")}.pdf`);
}

export const exportXlsxFile = exportExcelFile;
export const exportJsonFile = (payload: ResearchExportPayload) => downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `aurelius-${safePart(payload.query || "research")}.json`);
