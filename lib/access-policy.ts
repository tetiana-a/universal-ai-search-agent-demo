export const ACCESS_LADDER = [
  "official_api",
  "public_web_html_json",
  "sitemap_rss_feed",
  "licensed_provider",
  "permitted_browser",
  "authorized_customer_session",
  "manual_review",
  "blocked_or_not_automatable",
] as const;

export type AccessPolicyStatus =
  | "checked"
  | "partial"
  | "unavailable"
  | "blocked"
  | "auth_required"
  | "policy_restricted";

export function classifyAccessPolicy(input: {
  robots?: boolean;
  httpStatus?: number;
  captcha?: boolean;
  requiresAuth?: boolean;
  policyRestricted?: boolean;
}) {
  if (input.policyRestricted || input.robots === false) {
    return { status: "policy_restricted" as const, action: "fallback_or_manual_review" };
  }
  if (input.captcha) {
    return { status: "blocked" as const, action: "manual_review" };
  }
  if (input.requiresAuth) {
    return { status: "auth_required" as const, action: "authorized_customer_session_or_manual_review" };
  }
  if (input.httpStatus && input.httpStatus === 403) {
    return { status: "blocked" as const, action: "licensed_provider_or_manual_review" };
  }
  if (input.httpStatus && input.httpStatus === 429) {
    return { status: "partial" as const, action: "retry_after_backoff_or_next_provider" };
  }
  if (input.httpStatus && input.httpStatus >= 400) {
    return { status: "unavailable" as const, action: "fallback" };
  }
  return { status: "checked" as const, action: "continue" };
}
