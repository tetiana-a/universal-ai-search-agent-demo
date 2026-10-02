# Aurelius Universal AI Search Agent — v2.0 working upgrade

Date: 2026-10-02

## Implemented in the working repository

- Expanded research contract from basic results to Query Understanding + Search Branches + Source Registry + Access Events.
- Added supplemental server-side search adapters for Brave, Exa and Tavily when API keys are present.
- Kept OpenAI web search as the primary live research path.
- Added provider discovery hints as untrusted inputs; the final model must still verify facts through live web research.
- Added richer result fields: evidence quote, confidence, source type/domain, retrieved timestamp, freshness, independent verification flag.
- Strengthened deterministic Quality Gate.
- Added explicit access statuses and fallback reasons.
- Added real XLSX export with 5 sheets: Results, Sources, Run Summary, Search Branches, Access Events.
- Added printable PDF report workflow.
- Added Google Docs-compatible Word/HTML `.doc` export.
- Added JSON reproducibility export.
- Added UI panels for Query Understanding, Search Branches, Source Registry / Access Policy and Access Events.
- Result drawer now shows evidence quote, confidence, freshness and independent verification status.
- Added production readiness documentation and master coding prompt.

## Explicit boundary

The project does not solve CAPTCHA, bypass access controls, use stolen credentials/cookies or anti-detect systems. Restricted sources are surfaced and routed to allowed fallback channels/manual review.

## Production next steps

The repository remains a vertical-slice MVP, not a full distributed production platform. The next layer is durable PostgreSQL Source Registry/Evidence storage, queue workers, isolated acquisition/browser workers, Jina/Firecrawl adapters, checkpoint/resume and multi-user controls as described in the technical plan.


## v2.1 — Global Search + Public Communities

- Added a policy-driven global search matrix instead of a single-engine strategy.
- Added adapter support for Mojeek, Yandex Search API, Naver Search API and DataForSEO SERP aggregation (Google/Bing/Yahoo/Baidu/Naver/Seznam).
- Added public-community discovery branches for Facebook, Telegram, LinkedIn, Reddit, YouTube, Meetup, Discord, Quora and public forums using indexed/public search rather than unauthorized access.
- Added official/specialist/company/documents/news/local/jobs/regional-language branches.
- Added provider catalog and search-matrix telemetry to the research prompt.
- Added `SUPPLEMENTAL_SEARCH_MAX_QUERIES` cost/recall control.
- Restricted sources remain explicit blocked/manual-review states; no CAPTCHA or anti-bot bypass.
