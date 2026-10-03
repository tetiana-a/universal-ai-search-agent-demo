"use client";

import type { ResearchExportPayload } from "@/lib/research-report";

export type { ResearchExportPayload } from "@/lib/research-report";

function fallbackDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(function() { URL.revokeObjectURL(url); }, 1500);
}

function safePart(value: string) {
  const normalized = String(value || "research").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const result = normalized.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return result || "research";
}

async function downloadRemote(format: "csv" | "xlsx" | "pdf" | "json", payload: ResearchExportPayload) {
  let planKey = "";
  try { planKey = window.localStorage.getItem("aurelius-plan-key-v1") || ""; } catch {}
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (planKey) headers["x-aurelius-plan-key"] = planKey;
  const response = await fetch("/api/export", {
    method: "POST",
    headers,
    body: JSON.stringify({ format, payload }),
  });

  if (!response.ok) {
    let message = "Export failed.";
    try {
      const data = await response.json();
      message = String(data?.error || message);
    } catch {}
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("The export service returned an empty file.");

  const extension = format === "xlsx" ? "xlsx" : format;
  fallbackDownload(blob, "aurelius-" + safePart(payload.query || "research") + "." + extension);
}

export function exportCsvFile(payload: ResearchExportPayload) {
  return downloadRemote("csv", payload);
}

export function exportExcelFile(payload: ResearchExportPayload) {
  return downloadRemote("xlsx", payload);
}

export function exportPdfFile(payload: ResearchExportPayload) {
  return downloadRemote("pdf", payload);
}

export function exportJsonFile(payload: ResearchExportPayload) {
  return downloadRemote("json", payload);
}

export const exportXlsxFile = exportExcelFile;
