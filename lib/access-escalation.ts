export type AccessEscalationStatus =
  | "checked"
  | "partial"
  | "unavailable"
  | "blocked"
  | "auth_required"
  | "policy_restricted"
  | "captcha_required"
  | "rate_limited"
  | "not_automatable";

export type AccessEscalationStep =
  | "official_api"
  | "public_web_html_json"
  | "sitemap_rss_feed"
  | "licensed_provider"
  | "permitted_browser"
  | "authorized_customer_session"
  | "manual_review"
  | "alternate_source";

export type ManualAccessCheckpoint = {
  required: boolean;
  kind: "captcha" | "auth" | "policy" | "rate_limit" | "blocked";
  url: string;
  instructions: string;
  safeAction: "open_normal_browser" | "sign_in_as_customer" | "wait_and_retry" | "use_alternate_source";
  expiresInMinutes: number;
};

export type AccessEscalationPlan = {
  status: AccessEscalationStatus;
  nextStep: AccessEscalationStep;
  steps: AccessEscalationStep[];
  checkpoint?: ManualAccessCheckpoint;
  reason: string;
};

const ORDER: AccessEscalationStep[] = [
  "official_api",
  "public_web_html_json",
  "sitemap_rss_feed",
  "licensed_provider",
  "permitted_browser",
  "authorized_customer_session",
  "manual_review",
  "alternate_source",
];

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase();
}

export function buildAccessEscalationPlan(input: {
  url: string;
  status?: string;
  httpStatus?: number;
  captcha?: boolean;
  requiresAuth?: boolean;
  rateLimited?: boolean;
  policyRestricted?: boolean;
  reason?: string;
}): AccessEscalationPlan {
  const reason = String(input.reason ?? "").trim();
  const text = normalizeText(input.status + " " + reason);

  if (input.captcha || /captcha|challenge|turnstile|human verification|verify you are human/.test(text)) {
    return {
      status: "captcha_required",
      nextStep: "manual_review",
      steps: ORDER,
      checkpoint: {
        required: true,
        kind: "captcha",
        url: input.url,
        instructions: "Open the source in a normal browser and complete the site's own verification manually. Do not automate, bypass, spoof or defeat the challenge.",
        safeAction: "open_normal_browser",
        expiresInMinutes: 30,
      },
      reason: reason || "The source requires a human verification challenge.",
    };
  }

  if (input.rateLimited || input.httpStatus === 429 || /rate limit|too many requests|429/.test(text)) {
    return {
      status: "rate_limited",
      nextStep: "sitemap_rss_feed",
      steps: ORDER,
      reason: reason || "The source is rate limited; use Retry-After/backoff and alternate public sources.",
    };
  }

  if (input.requiresAuth || /login required|sign in|authentication|auth required|member-only/.test(text)) {
    return {
      status: "auth_required",
      nextStep: "authorized_customer_session",
      steps: ORDER,
      checkpoint: {
        required: true,
        kind: "auth",
        url: input.url,
        instructions: "Use only an account owned or explicitly authorized by the customer. Do not use third-party credentials or imported cookies.",
        safeAction: "sign_in_as_customer",
        expiresInMinutes: 30,
      },
      reason: reason || "The source requires authorization.",
    };
  }

  if (input.policyRestricted || /robots|terms of service|policy restricted|automation prohibited/.test(text)) {
    return {
      status: "policy_restricted",
      nextStep: "alternate_source",
      steps: ORDER,
      checkpoint: {
        required: true,
        kind: "policy",
        url: input.url,
        instructions: "Do not automate this source. Use an allowed API, licensed provider, public copy, or another source with equivalent evidence.",
        safeAction: "use_alternate_source",
        expiresInMinutes: 60,
      },
      reason: reason || "Automated access is restricted by source policy.",
    };
  }

  if (input.httpStatus === 403 || /cloudflare|access denied|forbidden|bot protection/.test(text)) {
    return {
      status: "blocked",
      nextStep: "permitted_browser",
      steps: ORDER,
      checkpoint: {
        required: true,
        kind: "blocked",
        url: input.url,
        instructions: "Open the source normally if you are authorized to access it. Do not spoof fingerprints, use anti-detect farms, bypass access controls, or use stolen sessions.",
        safeAction: "open_normal_browser",
        expiresInMinutes: 30,
      },
      reason: reason || "Automated retrieval was blocked.",
    };
  }

  if (input.httpStatus && input.httpStatus >= 400) {
    return {
      status: "unavailable",
      nextStep: "alternate_source",
      steps: ORDER,
      reason: reason || ("HTTP " + input.httpStatus + ". Use an alternate allowed source."),
    };
  }

  return {
    status: "checked",
    nextStep: "official_api",
    steps: ORDER,
    reason: reason || "No access escalation required.",
  };
}

export function accessEscalationSummary(plans: AccessEscalationPlan[]) {
  return {
    total: plans.length,
    checked: plans.filter((p) => p.status === "checked").length,
    captchaRequired: plans.filter((p) => p.status === "captcha_required").length,
    authRequired: plans.filter((p) => p.status === "auth_required").length,
    rateLimited: plans.filter((p) => p.status === "rate_limited").length,
    blocked: plans.filter((p) => p.status === "blocked").length,
    policyRestricted: plans.filter((p) => p.status === "policy_restricted").length,
    alternateSource: plans.filter((p) => p.nextStep === "alternate_source").length,
    manualCheckpoints: plans.filter((p) => Boolean(p.checkpoint?.required)).length,
  };
}
