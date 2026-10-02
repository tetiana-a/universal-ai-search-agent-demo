# Aurelius Universal AI Search Agent — Production Readiness Notes

This repository is the enhanced working MVP/vertical-slice derived from the v9 demo source that was available locally for this task.

## What is now implemented in the project

### Research pipeline
- Natural-language query intake.
- Scenario detection retained from the original demo.
- Deep research mode settings passed to the server route.
- Query Understanding contract: intent, entity type, geography, languages, criteria, exclusions, required fields, source classes.
- Search Plan + multiple search branches.
- Supplemental discovery via Brave Search, Exa and Tavily when their server-side API keys are configured.
- OpenAI web search remains the primary live research path.
- Structured function-call output with a strict research contract.
- Source Registry returned with access status and evidence availability.
- Access events returned with fallback action.
- Deterministic post-processing deduplication.
- Evidence quote + evidence summary + confidence + freshness metadata per result.
- Quality Gate with deterministic checks.
- Explicit independent-verification flag; the system does not claim second-source verification unless it is actually reported.

### Access / anti-bot policy
The project deliberately does **not** implement CAPTCHA solving, fingerprint spoofing, stolen cookies, anti-detect account farms, or bypassing access controls.

The production access ladder is:
1. Official API.
2. Public HTML / JSON.
3. Sitemap / RSS / public feed.
4. Licensed data provider.
5. Permitted browser automation.
6. Authorized customer session where the source permits it.
7. Manual review.
8. BLOCKED / NOT_AUTOMATABLE.

This maximizes information collection without pretending that restricted sources were successfully accessed.

### Export
The web UI now supports:
- CSV.
- Real `.xlsx` generated without an npm export dependency.
- Print-to-PDF workflow.
- Google Docs compatible `.doc`/HTML report.
- JSON reproducibility export.

### UI transparency
The research screen exposes:
- Query Understanding.
- Search branches.
- Source Registry / access policy.
- Access events and fallbacks.
- Evidence Quality Gate.
- Result details including evidence quote, confidence, freshness and independent verification status.

## Environment

Required:
- `OPENAI_API_KEY`

Optional supplemental retrieval:
- `BRAVE_SEARCH_API_KEY`
- `EXA_API_KEY`
- `TAVILY_API_KEY`

Reserved for the production acquisition layer:
- `JINA_API_KEY`
- `FIRECRAWL_API_KEY`
- `SERPER_API_KEY`

Supplemental provider discovery can be disabled with `SUPPLEMENTAL_SEARCH_ENABLED=false`.

## Important production boundary
This demo is still a single-request vertical slice. It does not yet persist SearchTask/Source Registry/Evidence into PostgreSQL, does not run a Redis/Celery queue, and does not launch isolated Playwright workers in this repository.

Those are the next production infrastructure steps described in the technical plan. The UI and server contract now expose the fields needed to move toward those layers without changing the user-facing workflow.

## Acceptance checklist alignment
The current project contract supports:
- Search Plan before result emission.
- Source status classification.
- Source URL + evidence quote + confidence.
- Deduplication.
- Budget/depth settings exposed in UI.
- CSV/XLSX/JSON exports and printable PDF.
- Security-aware handling of web content as untrusted data.
