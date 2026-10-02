export type ResearchQueryUnderstanding = {
  intent: string;
  entityType: string;
  geography: string[];
  languages: string[];
  criteria: string[];
  exclusions: string[];
  requiredFields: string[];
  sourceClasses: string[];
};

export type LiveSourceRecord = {
  name: string;
  url: string;
  domain: string;
  category: string;
  accessStatus:
    | "checked"
    | "partial"
    | "unavailable"
    | "blocked"
    | "auth_required"
    | "policy_restricted"
    | "captcha_required"
    | "rate_limited"
    | "not_automatable";
  accessMethod: string;
  reason: string;
  evidenceAvailable: boolean;
  quality: number;
  lastChecked?: string;
};

export type AccessEvent = {
  url: string;
  status: string;
  method: string;
  reason: string;
  fallback?: string;
  nextStep?: string;
  checkpointRequired?: boolean;
};

export type ResearchResultEnvelope = {
  live: true;
  model: string;
  query: string;
  generatedAt: string;
  elapsedMs: number;
  searchPlan: string;
  summary: string;
  queryUnderstanding: ResearchQueryUnderstanding;
  searchBranches: string[];
  sourceRegistry: LiveSourceRecord[];
  accessEvents: AccessEvent[];
  results: any[];
  sourceUrls: string[];
  sourceDomains: string[];
  stats: {
    sourcesFound: number;
    sourcesChecked: number;
    sourcesBlocked: number;
    sourcesManualReview: number;
    pagesProcessed: number;
    recordsExtracted: number;
    duplicatesRemoved: number;
    qualified: number;
    evidenceCoverage: number;
    averageConfidence: number;
  };
  qualityGate: {
    total: number;
    pass: number;
    review: number;
    fail: number;
    independentVerification: boolean;
    ruleSet: string[];
  };
  accessEscalation?: {
    total: number;
    checked: number;
    captchaRequired: number;
    authRequired: number;
    rateLimited: number;
    blocked: number;
    policyRestricted: number;
    alternateSource: number;
    manualCheckpoints: number;
  };
  accessCheckpoints?: Array<{
    required: boolean;
    kind: "captcha" | "auth" | "policy" | "rate_limit" | "blocked";
    url: string;
    instructions: string;
    safeAction: "open_normal_browser" | "sign_in_as_customer" | "wait_and_retry" | "use_alternate_source";
    expiresInMinutes: number;
  }>;
};
