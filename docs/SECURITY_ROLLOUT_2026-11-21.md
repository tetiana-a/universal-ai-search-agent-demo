# AURELIUS Security Rollout — 2026-11-21

## Scope
This branch **does not change production** until a reviewed PR is merged. It closes an observed production exposure: `/api/groups` and `/api/campaigns` returned CRM/campaign data without authentication while `SCOUT_PUBLIC_DASHBOARD=on`.

## Before merging

1. In the Vercel project `universal-ai-search-agent-demo`, set `SCOUT_ADMIN_KEY` as a long, unique **Secret** for Production (separate Preview secret recommended). Store it in a password manager; the dashboard login asks for it.
2. Set `SCOUT_PUBLIC_DASHBOARD=off`. The flag is ignored for API authorization by this patch, but turning it off avoids misleading configuration.
3. Set `CRON_SECRET` as a random, long **Secret**. Vercel automatically uses this value to sign Cron requests. Both `/api/scout/cron` and `/api/campaigns/cron` require it after merge.
4. Assess `TELEGRAM_OPEN_GROUP_ACCESS=on`: every human member of the designated group can invoke shared bot commands. Switch to `off` for owner-only controls unless shared access is deliberately intended.
5. Check `TELEGRAM_ALLOWED_CHAT_IDS`, `SCOUT_ADMIN_TELEGRAM_IDS`, Redis permissions, and production vs Preview data separation.
6. Ensure `CAMPAIGN_AUTOPOST=off` during validation. Do not enable until authorized groups are verified.
7. Merge only after CI tests and production configuration review. Redeploy so the new environment settings are included.

## Post-merge verification (safe GET checks)
- `GET /groups` should return the page, then prompt for the admin key when loading data.
- `GET /api/groups` without `x-scout-key` must return **401**.
- `GET /api/campaigns` without `x-scout-key` must return **401**.
- `GET /api/scout/health` without `x-scout-key` must return **401**.
- With `x-scout-key`, `GET /api/scout/health` should report Redis/Telegram and `adminProtected: true`.
- `GET /api/groups/export` with header should return XLSX; `?key=...` without a header must return **401**.
- Fake `User-Agent: vercel-cron` without the Bearer secret must return **401** from Cron endpoints.
- Do not send actual posts as part of security validation.

## Placement authorization
An externally visible statement such as “ads allowed” is **not** a grant of permission to this customer. The planner now needs an explicitly agreed group status (free/exchange/paid) or authorized Telegram bot rights. Manual discovery results remain visible but do not count toward authorized capacity. Admin agreements should be documented with permission evidence.

## Caveats
Current production deployment may be public until secrets + code are updated. The PR does **not** guarantee 300/day publication or full coverage of private Facebook/Instagram/TikTok content. Those require separately authorized placements and supported data providers.
