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
    | "policy_restricted";
  accessMethod: string;
  reason: string;
  evidenceAvailable: boolean;
  quality: number;
};

export type AccessEvent = {
  url: string;
  status: string;
  method: string;
  reason: string;
  fallback?: string;
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
};
