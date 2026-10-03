# Plans and billing

The app has two usage tiers. Limits are enforced on the server (`lib/plans.ts`); the UI only shows them.

| | Free | Pro |
|---|---|---|
| Research tasks per day | 5 (`FREE_DAILY_TASKS`) | 100 (`PRO_DAILY_TASKS`) |
| Depth | Quick, Balanced | Quick, Balanced, Deep |
| Sources / pages / results per task | 12 / 40 / 8 | 120 / 1500 / 30 (free AI engine caps at 30 / 200 / 15) |
| Exports | CSV, JSON | CSV, JSON, XLSX, PDF |
| Telegram, e-mail delivery | — | yes |

## How a request gets its plan

1. `PLAN_ENFORCEMENT=off` → everything is Pro, no quota (internal demos).
2. Header `x-aurelius-plan-key` matches one of `PRO_ACCESS_KEYS` → Pro. The UI sends it automatically after the user pastes the key in **Settings → General → Plan**.
3. Otherwise `DEFAULT_PLAN` (default `free`).

Quota is counted per day: per access key for Pro, per hashed client IP for Free. Counters live in Upstash/Vercel KV when `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set; otherwise in process memory (best effort, resets on cold start). A task that fails because of configuration or a provider outage (HTTP 5xx) is refunded.

Responses: `429 PLAN_LIMIT_REACHED` when the daily limit is used up, `403 PLAN_FEATURE_UNAVAILABLE` for a Pro-only export/delivery. `GET /api/plan` returns the current plan and today's usage without consuming quota.

## Payments (not connected yet)

`POST /api/billing/checkout` returns `501 BILLING_NOT_ENABLED`. Nothing is charged. To sell Pro online later:

1. Create a Stripe product + recurring price; add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO`, `STRIPE_WEBHOOK_SECRET` in Vercel.
2. Replace the stub with a Checkout Session (`mode=subscription`) and return its URL.
3. Add `/api/billing/webhook`: on `checkout.session.completed` / `customer.subscription.updated` issue or revoke a Pro key in KV (instead of the static `PRO_ACCESS_KEYS` list) and e-mail it to the customer.
4. Track per-task cost (search calls, AI tokens) against the plan to keep Pro margins positive — see Technical Plan v10, section 32.11.

## Do we need n8n?

No, not for the research pipeline. Search → reading → extraction → evidence → Quality Gate → exports run inside the Next.js API routes on Vercel, and Telegram/e-mail delivery is already direct (Bot API, Resend). Adding n8n would add a second deployment, another point of failure and latency without new capability.

n8n (or Make/Zapier) is reasonable only as an optional outer layer later: pushing finished results into a client's CRM, Google Sheets or Slack, or scheduling recurring searches. That needs one outgoing webhook from this app and no change to the research architecture.
