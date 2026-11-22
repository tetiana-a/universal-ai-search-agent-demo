# AURELIUS — Search Recovery & Poland Wine B2B (21 Nov 2026)

## Why the screenshot showed 0 groups
- Default Gemini grounding uses gemini-2.5-flash. Google can return HTTP 404 if that model is unavailable to the API project; an API key being present does not prove model access.
- Prior code retried the alternate model only after HTTP 429, not HTTP 404. Other fallback search (DuckDuckGo) can issue human checks or return no indexed groups.
- Searching `разместить объявление ... нарушая законов` looks for instructions rather than the actual business audience. The updated Poland/wine search uses Polish B2B trade terms.
- `0` after a provider failure means **not verified**, not that no groups or buyers exist.

## Optional, explicitly paid search provider: DataForSEO
Configure these variables directly in Vercel (do NOT put credentials in GitHub):
- `DATAFORSEO_LOGIN` — API login (Vercel secret)
- `DATAFORSEO_PASSWORD` — API password (Vercel secret)
- `DATAFORSEO_GROUP_SEARCH=on` — **explicitly opt in to billable searches**; default off
- `DATAFORSEO_LOCATION_NAME=Poland` — optional fallback region for non-recognized countries
- `CAMPAIGN_SEARCH_RUNS=8` — number of professional search phrases in a campaign

For each phrase, group search makes up to **2 DataForSEO Organic Live Advanced requests** (10 Google results each). At 8 phrases this is up to **16 requests per search run**, plus provider pricing; check current account pricing first. Search requests remove `site:` operators because those incur a 5× surcharge under the provider's documentation. The connector does not crawl private groups or grant posting access.

Use a compatible supported Gemini model only if Google Search grounding is available for this API project and its billing plan:
- `GEMINI_SEARCH_MODEL` — choose a model *verified for the project*, with grounding enabled as supported.
- `GEMINI_SEARCH_FALLBACK_MODEL` — **optional**, tried on 404 and 429; no automatic switch to billable models.
- Gemini 3+ grounding may require a paid tier. Do not assume ChatGPT, Google AI subscription or free API credits include it.

## Poland alcohol law — public advertising disabled
Polish law generally prohibits public wine advertising and promotion. The production bot must **not** publish wine advertisements publicly in Poland, even if a Telegram group has permitted ordinary commercial posts. In this branch, this applies to campaign approval, daily planning, auto-dispatch, partner notification and the Telegram start button.

Business-to-business information exchanged among operators in alcohol production, wholesale and trade is distinguished from public ads. This does NOT authorize unrestricted public posts or mass unsolicited private messages. Obtain Polish counsel approval for the exact B2B materials, recipients and channels; take consent, privacy and other applicable requirements into account.

Professional search terms now include:
- importerzy wina Polska
- hurtownie wina Polska
- dystrybutorzy wina Polska
- import wina włoskiego Polska
- dostawcy wina HoReCa Polska
- wine importers distributors Poland

## Safe verification
1. Review the changes in the GitHub PR. Do not merge until the separate security PR #41 is live and `SCOUT_ADMIN_KEY`/`CRON_SECRET` are configured.
2. Confirm GitHub CI typecheck, tests and build succeed and Vercel preview is READY.
3. Re-run the exact screenshot task in preview. Keywords should refer to Polish professional buyers; the UI must not show **Start Placement** for this campaign.
4. Check that attempts to approve a wine/Poland campaign return no approved status; no planned/partner/bot tasks are created.
5. When DataForSEO keys are added, switch on with a small test search. Confirm API response and actual verified group URL, not merely inferred links.
6. Never enable `CAMPAIGN_AUTOPOST` for these wine campaigns. For lawful B2B, use targeted professional prospecting and individual review.

**Note:** this patch improves software behavior and error handling; it does not guarantee that every platform exposes all relevant communities, that a provider is always available or that a particular B2B message is legally permitted.