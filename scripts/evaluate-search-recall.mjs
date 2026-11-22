#!/usr/bin/env node
// Compare a human-reviewed list of LIVE community URLs with AURELIUS export.
// Usage: node scripts/evaluate-search-recall.mjs baseline.csv aurelius.csv
// CSV must include a url/link/ссылка column or be a list of one URL per line.
// The 90% threshold applies only to the specific topic/region/language sample.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function csvRows(raw) {
  const s = raw.replace(/^\uFEFF/, "");
  const first = s.split(/\r?\n/, 1)[0] || "";
  const delimiter = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); if (row.some(x => x.trim())) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

export function normalize(raw) {
  let value = String(raw || "").trim().replace(/^<|>$/g, "").replace(/^["']|["']$/g, "");
  if (/^(t\.me|telegram\.me|www\.facebook\.com|facebook\.com|instagram\.com|tiktok\.com)\//i.test(value)) value = "https://" + value;
  let url; try { url = new URL(value); } catch { return ""; }
  if (!["http:", "https:"].includes(url.protocol)) return "";
  let host = url.hostname.toLowerCase().replace(/^(www|m|web)\./, "");
  if (host === "telegram.me") host = "t.me";
  if (!["t.me", "facebook.com", "instagram.com", "tiktok.com"].includes(host)) return "";
  let path = decodeURIComponent(url.pathname).replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
  if (host === "t.me") path = path.replace(/^\/s\//, "/");
  if (host === "facebook.com") {
    // A Facebook group URL identifies the community; remove post paths.
    path = path.replace(/^(\/groups\/[^/]+)\/.*/, "$1");
  }
  if (host === "instagram.com" && /^(\/p\/|\/reel\/|\/stories\/)/.test(path)) return "";
  if (host === "tiktok.com" && path.startsWith("/@")) path = path.split("/").slice(0, 2).join("/");
  if (!path || path === "/") return "";
  return host + path;
}

export function readUrls(raw) {
  const rows = csvRows(raw);
  if (!rows.length) return [];
  const headers = rows[0].map(x => x.trim().toLowerCase());
  let index = headers.findIndex(x => ["url", "link", "ссылка", "посилання", "community url", "group url"].includes(x));
  let start = 1;
  if (index < 0) { index = 0; start = 0; }
  return rows.slice(start).map(r => normalize(r[index])).filter(Boolean);
}

export function evaluate(human, agent) {
  const humanSet = new Set(human), agentSet = new Set(agent);
  const found = [...humanSet].filter(x => agentSet.has(x));
  const missing = [...humanSet].filter(x => !agentSet.has(x));
  const ratio = humanSet.size ? found.length / humanSet.size : 0;
  return {
    baseline_live_groups: humanSet.size,
    bot_unique_groups: agentSet.size,
    matched: found.length,
    missing_count: missing.length,
    duplicate_baseline: human.length - humanSet.size,
    duplicate_agent: agent.length - agentSet.size,
    recall: Number((ratio * 100).toFixed(2)),
    required_recall: 90,
    passed: humanSet.size > 0 && ratio >= .9,
    missing_links: missing.slice(0, 50),
  };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  if (process.argv.length !== 4) {
    console.error("Usage: node scripts/evaluate-search-recall.mjs manual-live-baseline.csv aurelius-export.csv");
    process.exit(1);
  }
  try {
    const result = evaluate(...process.argv.slice(2).map(file => readUrls(readFileSync(file, "utf8"))));
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
