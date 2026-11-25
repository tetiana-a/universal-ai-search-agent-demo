import * as Sentry from "@sentry/nextjs";

// Browser errors on the site. Off until NEXT_PUBLIC_SENTRY_DSN is set in Vercel (the same DSN).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init({ dsn, environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development", tracesSampleRate: 0, sendDefaultPii: false });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
