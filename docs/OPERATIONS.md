# AURELIUS Operations Runbook

## Standard production checks

Use Telegram `/health` or the Scout **Health** tab. A healthy deployment should show:

- Telegram API: OK
- Telegram webhook: connected, no last error
- Redis: read/write OK
- Search provider: at least one keyless provider
- AI route: free provider or deterministic fallback
- Admin protection: enabled before real personal data is stored
- Zero-cost mode: ON when running the free edition

## Telegram is silent

1. Send `/id`. If there is no reply, inspect Vercel runtime logs for `POST /api/scout/telegram`.
2. If `/id` replies with `Control access: NO`, add the returned User ID to `TELEGRAM_ALLOWED_CHAT_IDS` or `SCOUT_ADMIN_TELEGRAM_IDS`, then redeploy.
3. Send `/health`.
4. Check Telegram API and webhook status.
5. Inspect the Scout log for `telegram.send_failed`, `bot.error` or `bot.background_error`.
6. Do not paste bot tokens into chat, screenshots, logs or issue comments.

## Search starts but never finishes

1. Open **Tasks** in the dashboard or use `/tasks`.
2. Read the persisted stage and last update time.
3. Use `/status` for the active chat.
4. If necessary stop safely with the Telegram Stop button or the dashboard task action.
5. Review `research.*` log entries and provider diagnostics.
6. If the serverless time budget ended, the task retains its checkpoint/history; do not delete evidence or partial results while debugging.

## Search returns few or zero results

Check the distinction:

- provider failure/rate limit: operational problem
- source access restriction: expected limitation
- providers answered but no candidates: legitimate zero
- candidates exist but evidence is weak: quality/review problem

Never convert a provider failure into a fake “0 results”.

For more stable free search, an approved SearXNG instance can be configured through `SEARXNG_URL`. DuckDuckGo challenges must not be bypassed.

## Redis unavailable

Symptoms:

- Health shows persistence warning/error.
- Tasks may survive only inside one warm process.

Actions:

1. Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
2. Redeploy after environment changes.
3. Run Health again and require a successful read/write probe.
4. Do not treat the in-memory fallback as production persistence.

## Production security checklist

Before storing real leads or contacts:

- set a strong `SCOUT_ADMIN_KEY`
- use an explicit `TELEGRAM_WEBHOOK_SECRET`
- limit Telegram control IDs to known administrators
- keep report group ID separate from personal admin ID
- rotate any token that appeared in screenshots/messages
- keep Preview and Production secrets intentionally scoped
- verify that health/state endpoints never return credential values

## Release gate

A change is not production-ready unless:

- TypeScript typecheck passes
- tests pass
- production build passes
- Sonar quality gate passes
- no new security hotspot is introduced
- Vercel preview deploys
- Telegram control callbacks are covered by tests when changed
- failure behavior is explicit and user-visible
