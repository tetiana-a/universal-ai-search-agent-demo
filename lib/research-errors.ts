// Typed research errors. Every failure that used to collapse into an empty
// result set is surfaced with a stable code, an HTTP status and a message the
// UI can show as-is.

export type ResearchErrorCode =
  | "INVALID_REQUEST"
  | "JINA_API_KEY_MISSING"
  | "SEARCH_PROVIDER_NOT_CONFIGURED"
  | "SEARCH_PROVIDERS_FAILED"
  | "AI_PROVIDER_NOT_CONFIGURED"
  | "UPSTREAM_TIMEOUT"
  | "PLAN_LIMIT_REACHED"
  | "PLAN_FEATURE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type ProviderDiagnostic = {
  provider: string;
  status: "ok" | "empty" | "error" | "not_configured" | "skipped";
  httpStatus?: number;
  hits?: number;
  message?: string;
};

export class ResearchError extends Error {
  readonly code: ResearchErrorCode;
  readonly httpStatus: number;
  readonly diagnostics?: unknown;

  constructor(code: ResearchErrorCode, message: string, httpStatus: number, diagnostics?: unknown) {
    super(message);
    this.name = "ResearchError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.diagnostics = diagnostics;
  }
}

export function errorBody(error: unknown, fallbackMessage = "Research failed.") {
  if (error instanceof ResearchError) {
    return {
      status: error.httpStatus,
      body: { error: error.message, code: error.code, diagnostics: error.diagnostics ?? null },
    };
  }
  const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  if (timeout) {
    return {
      status: 504,
      body: { error: "An upstream provider did not respond in time. Try again or reduce the search depth.", code: "UPSTREAM_TIMEOUT" as const, diagnostics: null },
    };
  }
  return {
    status: 500,
    body: { error: error instanceof Error && error.message ? error.message : fallbackMessage, code: "INTERNAL_ERROR" as const, diagnostics: null },
  };
}
