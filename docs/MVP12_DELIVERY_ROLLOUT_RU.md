# AURELIUS — MVP 1.2: deployment, acceptance and remaining external connections
Version: 2026-11-22. Existing project: `tetiana-a/universal-ai-search-agent-demo`.

## 0. Honest scope and current state

Vercel production is online. The existing bot, Telegram webhook and Upstash Redis have been observed responding. The old `/api/groups` and `/api/campaigns` were **open to unauthenticated reads** while `SCOUT_PUBLIC_DASHBOARD=on`: that is a release blocker.

The owner-supplied 22 November report recorded 82 groups, 0 published, 2 planned, 23 *reported* permissioned and 1 inappropriate manual-queue item (Polish wine task routed to Valencia real-estate group). Counts can change between screenshots and database refresh. `published` or `sent` must not be used for a placement lacking an actual platform link or authorized proof.

This consolidated branch includes:
- security patch #41 (fail-closed admin and cron, no key in Excel URL);
- Telegram guided ad wizard #42;
- Gemini 404 / opt-in DataForSEO / Polish wine compliance #43;
- `/connect` for already-administered owner Telegram supergroup;
- per-campaign eligible group list: prevents automatic routing of a Kraków-flower campaign to a Valencia-real-estate group;
- test suite and tooling for measurement of the contractual 90% search recall;
- optional n8n report-only workflow.

**None of this proves 300 real placements/day or universal monitoring.**

## 1. External account secrets / Vercel Production

Open Vercel Project → Settings → Environment Variables. Before merging:
- `SCOUT_ADMIN_KEY` = random long secret, unique to this project; used as `x-scout-key` in admin/API requests.
- `CRON_SECRET` = different random long secret; Vercel uses `Authorization: Bearer <CRON_SECRET>` for scheduled jobs.
- `SCOUT_PUBLIC_DASHBOARD=off` (existing public mode must be disabled).
- `TELEGRAM_OPEN_GROUP_ACCESS=off` unless every member of a designated group is deliberately authorized.
- `CAMPAIGN_AUTOPOST=off` until a real owned Telegram channel is registered and approved.
- Existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: **already present**, do not buy another Redis database.
- Existing `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`: present; confirm real availability and quotas without exposing values.
- `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`: not present. Obtain from DataForSEO if opting into paid search.
- `DATAFORSEO_GROUP_SEARCH=on` only after setting a provider billing cap, otherwise off.
- `GEMINI_SEARCH_MODEL` and optionally `GEMINI_SEARCH_FALLBACK_MODEL`: choose models actually accessible to the user's Google API project; avoid blindly switching to paid grounding.

**All secret values must be entered in Vercel/n8n credential vaults. Do not commit them to GitHub or paste them into chat.**

### Release sequence
1. Review this PR, run GitHub CI and Vercel Preview, inspect changes for merge conflicts.
2. Save security environment variables in Production *before* release. Confirm Preview environment isolation: do not run test preview against real Redis when changing campaigns.
3. Merge **the consolidated PR only**, not #41/#42/#43 separately; redeploy production on Pro/commercial-eligible hosting.
4. Confirm `GET /api/groups` returns 401 without x-scout-key; authenticated access works. Same for campaigns and health. Check cron auth and Redis persistence.
5. Telegram owner in the already-created `AURELIUS` group sends `/connect`. Bot checks Telegram administrator rights before creating the group record. Dashboard `Bot publishes in` should become 1.
6. Only after verifying 1 test channel and no other targets, send a harmless test message and inspect its actual URL, log and response. Keep `CAMPAIGN_AUTOPOST=off` until human approval.
7. Enable paid search carefully and run test searches in a scoped topic/region/language.
8. Enable daily automated campaigns only after recipient permission evidence, queue idempotency, full testing and client approval.

Do not enable automatic publication for wine to public groups in Poland. Industry B2B contact research is a separate use-case and still needs legal review.

## 2. Services: what is truly required?

| Part | For MVP | Status / recommendation |
|---|---|---|
| Interface, HTTP API, Telegram webhook | Vercel Next.js | Existing; commercial work needs Vercel Pro or compliant commercial host |
| Speech/structured task parsing | Gemini/OpenAI/OpenRouter | Already have tokens; verify actual voice and model access |
| Public search discovery | Indexed/public search + DataForSEO | Keyless/Gemini alone unreliable; add opt-in DataForSEO credentials |
| Persistence | Upstash Redis REST | Already connected; appropriate for a small MVP |
| Background schedule | Vercel Cron | Already configured twice daily; use signed CRON_SECRET |
| Telegram publishing | Telegram Bot API | Already connected; specific groups need bot admin/permission and /connect |
| Facebook Groups public automation | No general official Groups API | Manual or approved group admin publishing/proofs; n8n cannot change this |
| Facebook Pages / IG Professional / TikTok creator profiles | Platform APIs or Postiz | Optional phase 2; owner OAuth and app permissions required |
| Paid ad/partner outreach | Direct agreements, approvals | Needed to approach 300/day; not solved by code |
| n8n Cloud | Optional | Not required for basic Telegram MVP; workflow for read-only reporting included |
| Google Sheets / CSV | Existing exports; Sheets via n8n | No extra account necessary if CSV acceptable |
| Long-term 14-day audit / media | Postgres + object storage later | Add only when real scale, retention and multi-tenant reporting justify it |

## 3. Acceptance matrix for Alexey, MVP on 1–2 platforms

| Case | Evidence of acceptance |
|---|---|
| Telegram text/voice | Stored transcription, extracted topic/region/language/format, human confirmation |
| Clarifications | Missing data -> question -> answer -> changed campaign -> explicit approval |
| Multilingual keyword discovery | Inspect 40 words including synonyms, region and geo, owner edits and approves |
| Profile + adjacent search | Two-way query catalog; each group has URL, provenance, category, confidence |
| 90% search completeness | Manual list of **living** groups in same topic/region/date/languages; use `scripts/evaluate-search-recall.mjs baseline.csv aurelius.csv`; threshold ≥90%, rerun after improvements |
| Deduplication | Canonical group URLs, no same platform group twice; inactive has an explicit flag |
| Authorization | Owners prove admin grant; manual partner status alone is not proof; no bans from duplicate posts |
| One Telegram real post | Group has rights, Telegram returns message ID + URL, persisted and checked manually |
| Facebook Group | Owner/admin-approved manual placement with URL evidence; never falsely label as API autopost |
| Monitoring | Known authorized sources only; post URL, origin, time and public reactions when available |
| Daily report | Found, sent/verified, failed, stopped, feedback, owner receives report |
| Stop | /cstop campaign and /cstop all prevent subsequent scheduled sends |
| Persistence | Reload Vercel, ensure data survive redeploy/cold start |
| Security | Unauthenticated CRM 401, secret Cron, no credentials in URLs/logs |
| 14-day pilot | Daily archive of metrics, URLs, approvals, errors; measure actual post count and blocked calls |

**No project can guarantee zero platform bans, 90% of unobserved/private groups, or 300/day before partner and platform rights exist.** The acceptance benchmark must be defined against a reproducible, dated manual list.

## 4. Capacity — what 300/day really costs

`authorized_daily_capacity = sum(min(group.daily_limit, allowed_posts_today))`.

- At 1 approved placement **per day** in a group: roughly **300 authorized communities** needed.
- At 1 approved placement **per week** in a group: roughly **2,100 communities** needed to sustain 300/day.
- At 3 allowed posts/day per group: theoretical 100 communities, but most real administrators will not approve such frequency and repeated ads may be rejected.
- 300 published ≠ 300 queued or 300 drafts. A verified external link or Telegram success record is required for each.

A separate budget is needed for partner placements and advertising fees, client accounts, API subscriptions, hosting, support and 14-day testing. The development budget of $500 cannot reasonably guarantee 300 verified posts/day across external groups without an existing partner network.

## 5. Storage upgrade only after pilot

Keep Upstash Redis for MVP because it is already integrated. Its current Hash/HGETALL design is acceptable for dozens/hundreds of records but inefficient at scale, and the audit log is capped (500 items). For robust commercial operation, migrate to PostgreSQL (Supabase, Neon or managed Postgres) with indexed campaign/placement/proof records and backups, Redis for short-lived locks/rate limits, S3/R2/Supabase Storage for user media. Use data minimization and documented retention under GDPR; do not scrape private posts or personal profiles.

## 6. n8n

Import `n8n/aurelius-readonly-daily-report.json` only if you need external workflow reporting. Use HTTP Header Auth with x-scout-key and a Telegram sender credential. **Do not create a second Telegram webhook/Telegram Trigger** with the same token; that would interrupt the existing Vercel webhook. Do not duplicate daily publishing Cron triggers.

## 7. What cannot be completed without customer access

- Owner must set secrets in Vercel and authorize a commercial hosting plan.
- DataForSEO account/billing and model quotas require external account owner action.
- OAuth for Meta/TikTok/Postiz requires permissions and user consent.
- Partner admin agreements and legal/commercial review are inherently external.
- The manual 90% benchmark requires a validated human reference list.
- Real published links and 14-day performance cannot be fabricated by a local/preview test.

Do not declare this MVP accepted until the 14-day pilot and the evidence above are satisfied.
