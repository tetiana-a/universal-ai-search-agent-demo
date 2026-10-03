import { createHash, timingSafeEqual } from "node:crypto";
import { persistentMemoryConfigured, redisPipeline } from "@/lib/memory";
import { ResearchError } from "@/lib/research-errors";

// Free and Pro usage tiers. Limits are enforced on the server; the UI only displays them.
// Pro access is granted by an access key (PRO_ACCESS_KEYS) until a payment provider is
// connected — see docs/PLANS_AND_BILLING.md.

export type PlanId = "free" | "pro";
export type Depth = "Quick" | "Balanced" | "Deep";
export type ExportFormat = "csv" | "json" | "xlsx" | "pdf";
export type PlanFeature = "telegram" | "email" | `export:${ExportFormat}`;

export type Plan = {
  id: PlanId;
  label: string;
  dailyTasks: number;
  maxResults: number;
  maxSources: number;
  maxPages: number;
  depths: Depth[];
  exports: ExportFormat[];
  telegram: boolean;
  email: boolean;
};

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getPlans(): Record<PlanId, Plan> {
  return {
    free: {
      id: "free",
      label: "Free",
      dailyTasks: envInt("FREE_DAILY_TASKS", 5),
      maxResults: 8,
      maxSources: 12,
      maxPages: 40,
      depths: ["Quick", "Balanced"],
      exports: ["csv", "json"],
      telegram: false,
      email: false,
    },
    pro: {
      id: "pro",
      label: "Pro",
      dailyTasks: envInt("PRO_DAILY_TASKS", 100),
      maxResults: 30,
      maxSources: 120,
      maxPages: 1500,
      depths: ["Quick", "Balanced", "Deep"],
      exports: ["csv", "json", "xlsx", "pdf"],
      telegram: true,
      email: true,
    },
  };
}

export const PLAN_KEY_HEADER = "x-aurelius-plan-key";

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function keyMatches(candidate: string, expected: string) {
  const a = Buffer.from(sha(candidate));
  const b = Buffer.from(sha(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

function proKeys() {
  return String(process.env.PRO_ACCESS_KEYS || "").split(",").map((k) => k.trim()).filter((k) => k.length >= 12);
}

export function resolvePlan(request: Request): Plan {
  const plans = getPlans();
  if (process.env.PLAN_ENFORCEMENT === "off") return plans.pro;
  const key = String(request.headers.get(PLAN_KEY_HEADER) || "").trim();
  if (key && proKeys().some((expected) => keyMatches(key, expected))) return plans.pro;
  return process.env.DEFAULT_PLAN === "pro" ? plans.pro : plans.free;
}

function clientIdentity(request: Request, plan: Plan) {
  const key = String(request.headers.get(PLAN_KEY_HEADER) || "").trim();
  if (plan.id === "pro" && key) return "k_" + sha(key).slice(0, 24);
  const forwarded = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = forwarded || String(request.headers.get("x-real-ip") || "") || "anonymous";
  return "ip_" + sha(ip + "|" + (process.env.QUOTA_SALT || "aurelius")).slice(0, 24);
}

// Process-local fallback when Redis/KV is not configured (per warm instance, best effort).
const localCounters = new Map<string, number>();

export function resetLocalQuotaCounters() { localCounters.clear(); }

function dayKey(identity: string) {
  return "aurelius:quota:v1:" + new Date().toISOString().slice(0, 10) + ":" + identity;
}

export type QuotaUsage = { used: number; limit: number; remaining: number; persistent: boolean };

async function readOrIncrement(key: string, increment: boolean): Promise<number> {
  if (persistentMemoryConfigured()) {
    const rows = await redisPipeline(increment ? [["INCR", key], ["EXPIRE", key, 172800]] : [["GET", key]]);
    const value = Number(rows[0] ?? 0);
    if (Number.isFinite(value) && rows.length) return value;
  }
  const next = (localCounters.get(key) || 0) + (increment ? 1 : 0);
  localCounters.set(key, next);
  return next;
}

export async function getQuotaUsage(request: Request, plan: Plan): Promise<QuotaUsage> {
  const used = await readOrIncrement(dayKey(clientIdentity(request, plan)), false);
  return { used, limit: plan.dailyTasks, remaining: Math.max(0, plan.dailyTasks - used), persistent: persistentMemoryConfigured() };
}

// Counts one research task against today's quota. Call once per started task.
export async function checkResearchQuota(request: Request, plan: Plan): Promise<{ allowed: boolean; usage: QuotaUsage; error?: ResearchError }> {
  if (process.env.PLAN_ENFORCEMENT === "off") {
    return { allowed: true, usage: { used: 0, limit: plan.dailyTasks, remaining: plan.dailyTasks, persistent: persistentMemoryConfigured() } };
  }
  const used = await readOrIncrement(dayKey(clientIdentity(request, plan)), true);
  const usage = { used: Math.min(used, plan.dailyTasks), limit: plan.dailyTasks, remaining: Math.max(0, plan.dailyTasks - used), persistent: persistentMemoryConfigured() };
  if (used > plan.dailyTasks) {
    return {
      allowed: false,
      usage,
      error: new ResearchError(
        "PLAN_LIMIT_REACHED",
        plan.id === "free"
          ? "Достигнут дневной лимит бесплатного тарифа (" + plan.dailyTasks + " задач). Лимит обновится завтра, или подключите Pro. / Free plan daily limit reached."
          : "Достигнут дневной лимит тарифа Pro (" + plan.dailyTasks + " задач). / Pro plan daily limit reached.",
        429,
        { plan: plan.id, usage },
      ),
    };
  }
  return { allowed: true, usage };
}

// Gives back a task that never ran (configuration or provider failure) so it does not burn quota.
export async function refundResearchQuota(request: Request, plan: Plan) {
  if (process.env.PLAN_ENFORCEMENT === "off") return;
  const key = dayKey(clientIdentity(request, plan));
  if (persistentMemoryConfigured()) {
    const rows = await redisPipeline([["DECR", key]]);
    if (rows.length) return;
  }
  localCounters.set(key, Math.max(0, (localCounters.get(key) || 0) - 1));
}

export function planAllows(plan: Plan, feature: PlanFeature) {
  if (process.env.PLAN_ENFORCEMENT === "off") return true;
  if (feature === "telegram") return plan.telegram;
  if (feature === "email") return plan.email;
  return plan.exports.includes(feature.slice("export:".length) as ExportFormat);
}

export function assertFeature(plan: Plan, feature: PlanFeature) {
  if (planAllows(plan, feature)) return;
  const label = feature.startsWith("export:") ? feature.slice(7).toUpperCase() + " export" : feature === "telegram" ? "Telegram delivery" : "Email delivery";
  throw new ResearchError(
    "PLAN_FEATURE_UNAVAILABLE",
    label + " доступен в тарифе Pro. / " + label + " is available on the Pro plan.",
    403,
    { plan: plan.id, feature },
  );
}

export function clampToPlan(plan: Plan, requested: { depth?: unknown; maxResults?: unknown; maxSources?: unknown; maxPages?: unknown }) {
  const clamp = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback));
  };
  const wanted = (["Quick", "Balanced", "Deep"] as Depth[]).includes(requested.depth as Depth) ? (requested.depth as Depth) : "Balanced";
  const depth = plan.depths.includes(wanted) ? wanted : plan.depths[plan.depths.length - 1];
  return {
    depth,
    maxResults: clamp(requested.maxResults, Math.min(8, plan.maxResults), 3, plan.maxResults),
    maxSources: clamp(requested.maxSources, Math.min(20, plan.maxSources), 5, plan.maxSources),
    maxPages: clamp(requested.maxPages, Math.min(100, plan.maxPages), 20, plan.maxPages),
  };
}

export function publicPlanInfo(plan: Plan) {
  return {
    id: plan.id,
    label: plan.label,
    limits: { dailyTasks: plan.dailyTasks, maxResults: plan.maxResults, maxSources: plan.maxSources, maxPages: plan.maxPages, depths: plan.depths },
    features: { exports: plan.exports, telegram: plan.telegram, email: plan.email },
  };
}
