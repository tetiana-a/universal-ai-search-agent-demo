
export type SettingsTab =
  | "general"
  | "research"
  | "models"
  | "search"
  | "acquisition"
  | "quality"
  | "budget"
  | "security"
  | "exports";

export type AppSettings = {
  language: "ru" | "en";
  theme: "dark" | "light";
  confirmBeforeSearch: boolean;
  autoOpenResults: boolean;

  defaultDepth: "Quick" | "Balanced" | "Deep";
  maxSources: number;
  maxPages: number;
  concurrentWorkers: number;
  reuseSourceRegistry: boolean;
  multilingualSearch: boolean;
  followRelatedLinks: boolean;

  planningModel: string;
  extractionModel: string;
  hardMatchModel: string;
  qualityCheckModel: string;
  visionModel: string;
  deepResearchProvider: string;
  maxCostPerTask: number;
  maxTokens: number;
  timeoutSeconds: number;
  retryLimit: number;
  fallbackProvider: string;
  auditTrail: boolean;

  braveEnabled: boolean;
  exaEnabled: boolean;
  tavilyEnabled: boolean;
  serperEnabled: boolean;
  searchLanguage: "Auto" | "Russian" | "English" | "Spanish" | "Italian";
  maxSearchRequests: number;

  httpxEnabled: boolean;
  jinaEnabled: boolean;
  firecrawlEnabled: boolean;
  playwrightEnabled: boolean;
  licensedProviderEnabled: boolean;
  manualReviewEnabled: boolean;
  maxPageRuntimeSeconds: number;
  respectRobots: boolean;
  captchaPolicy: "stop" | "manual";
  authPolicy: "stop" | "manual";

  minConfidence: number;
  requireEvidence: boolean;
  dedupeEnabled: boolean;
  duplicateThreshold: number;
  freshnessDays: number;
  requireLocationConsistency: boolean;

  taskBudget: number;
  dailyBudget: number;
  monthlyBudget: number;
  hardBudgetStop: boolean;
  requireBudgetApproval: boolean;

  promptInjectionPolicy: "block" | "flag";
  ssrfPolicy: "block" | "flag";
  secretsPolicy: "server-only";
  fileSandbox: boolean;
  auditLogs: boolean;
  tenantIsolation: boolean;

  csvExport: boolean;
  xlsxExport: boolean;
  includeEvidence: boolean;
  includeSourceMetadata: boolean;
};

export const defaultSettings: AppSettings = {
  language: "ru",
  theme: "dark",
  confirmBeforeSearch: true,
  autoOpenResults: true,

  defaultDepth: "Deep",
  maxSources: 50,
  maxPages: 3000,
  concurrentWorkers: 4,
  reuseSourceRegistry: true,
  multilingualSearch: true,
  followRelatedLinks: true,

  planningModel: "OpenRouter Free",
  extractionModel: "OpenRouter Free",
  hardMatchModel: "OpenRouter Free",
  qualityCheckModel: "OpenRouter Free",
  visionModel: "Free vision model when available",
  deepResearchProvider: "Jina Search + OpenRouter Free",
  maxCostPerTask: 25,
  maxTokens: 120000,
  timeoutSeconds: 45,
  retryLimit: 3,
  fallbackProvider: "Jina Search / Manual review",
  auditTrail: true,

  braveEnabled: true,
  exaEnabled: true,
  tavilyEnabled: true,
  serperEnabled: false,
  searchLanguage: "Auto",
  maxSearchRequests: 300,

  httpxEnabled: true,
  jinaEnabled: true,
  firecrawlEnabled: true,
  playwrightEnabled: true,
  licensedProviderEnabled: true,
  manualReviewEnabled: true,
  maxPageRuntimeSeconds: 30,
  respectRobots: true,
  captchaPolicy: "manual",
  authPolicy: "manual",

  minConfidence: 0.78,
  requireEvidence: true,
  dedupeEnabled: true,
  duplicateThreshold: 0.86,
  freshnessDays: 30,
  requireLocationConsistency: true,

  taskBudget: 25,
  dailyBudget: 75,
  monthlyBudget: 300,
  hardBudgetStop: true,
  requireBudgetApproval: true,

  promptInjectionPolicy: "block",
  ssrfPolicy: "block",
  secretsPolicy: "server-only",
  fileSandbox: true,
  auditLogs: true,
  tenantIsolation: true,

  csvExport: true,
  xlsxExport: true,
  includeEvidence: true,
  includeSourceMetadata: true,
};
