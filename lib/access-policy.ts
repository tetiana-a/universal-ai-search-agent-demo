import { buildAccessEscalationPlan } from "@/lib/access-escalation";

export const ACCESS_LADDER = [
  "official_api",
  "public_web_html_json",
  "sitemap_rss_feed",
  "licensed_provider",
  "permitted_browser",
  "authorized_customer_session",
  "manual_review",
  "alternate_source",
] as const;

export type AccessPolicyStatus =
  | "checked"
  | "partial"
  | "unavailable"
  | "blocked"
  | "auth_required"
  | "policy_restricted"
  | "captcha_required"
  | "rate_limited"
  | "not_automatable";

export function classifyAccessPolicy(input: {
  url?: string;
  robots?: boolean;
  httpStatus?: number;
  captcha?: boolean;
  requiresAuth?: boolean;
  rateLimited?: boolean;
  policyRestricted?: boolean;
  reason?: string;
}) {
  const plan = buildAccessEscalationPlan({
    url: input.url || "",
    status: input.httpStatus ? String(input.httpStatus) : undefined,
    httpStatus: input.httpStatus,
    captcha: input.captcha,
    requiresAuth: input.requiresAuth,
    rateLimited: input.rateLimited,
    policyRestricted: input.policyRestricted || input.robots === false,
    reason: input.reason,
  });

  return {
    status: plan.status as AccessPolicyStatus,
    action: plan.nextStep,
    checkpoint: plan.checkpoint,
    reason: plan.reason,
  };
}
