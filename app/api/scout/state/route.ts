import { adapterStatus } from "@/lib/scout/adapters";
import { adminKeyConfigured, isAuthorized, unauthorized } from "@/lib/scout/auth";
import { loadSettings } from "@/lib/scout/config";
import { collectReport, renderReport } from "@/lib/scout/report";
import { listRecentResearchTasks } from "@/lib/scout/research-bot";
import { getValue, listAll, readLog, storeIsPersistent } from "@/lib/scout/store";
import { botToken, reportChatId } from "@/lib/scout/telegram";
import type { AgencyCard, Draft, InvestorCard, Lead, Match, Meeting, ObjectCard, ScanStats, ScoutSource, WatchItem } from "@/lib/scout/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const byScore = <T extends { score: number }>(a: T, b: T) => b.score - a.score;

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const [objects, investors, agencies, sources, watch, drafts, leads, matches, meetings, settings, lastScan, log, report, researchTasks] = await Promise.all([
    listAll<ObjectCard>("objects"), listAll<InvestorCard>("investors"), listAll<AgencyCard>("agencies"), listAll<ScoutSource>("sources"),
    listAll<WatchItem>("watch"), listAll<Draft>("drafts"), listAll<Lead>("leads"), listAll<Match>("matches"), listAll<Meeting>("meetings"),
    loadSettings(), getValue<ScanStats>("last-scan"), readLog(80), collectReport(), listRecentResearchTasks(50),
  ]);
  return Response.json({
    ok: true,
    persistent: storeIsPersistent(),
    protected: adminKeyConfigured(),
    telegram: { token: Boolean(botToken()), chatId: await reportChatId() },
    adapters: adapterStatus(),
    settings,
    lastScan,
    report: { data: report, html: renderReport(report).html },
    objects: [...objects].sort(byScore).slice(0, 300),
    investors: [...investors].sort(byScore).slice(0, 300),
    agencies: [...agencies].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt)).slice(0, 300),
    sources: [...sources].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt)).slice(0, 200),
    watch,
    drafts: [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
    leads: [...leads].sort((a, b) => b.lastContactAt.localeCompare(a.lastContactAt)).slice(0, 200),
    matches: [...matches].sort(byScore).slice(0, 200),
    meetings: [...meetings].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    researchTasks,
    log,
  });
}
