import * as Sentry from "@sentry/nextjs";

// Sentry for the site's server code and API routes. Off until SENTRY_DSN is set in Vercel.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.VERCEL_ENV || "development", tracesSampleRate: 0, sendDefaultPii: false });
}

export const onRequestError = Sentry.captureRequestError;
