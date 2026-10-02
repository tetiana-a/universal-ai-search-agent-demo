# Global Search + Public Communities — Aurelius v2

## Search layer

The agent uses a policy-driven multi-engine matrix. No single engine is treated as complete.

### Direct / AI-oriented providers
- Brave Search API
- Exa
- Tavily
- Mojeek
- OpenAI live web search (primary research pass)

### Regional / multilingual providers
- Yandex Search API
- Naver Search API
- Seznam via SERP adapter
- Baidu via SERP adapter

### Broad SERP aggregation
- DataForSEO adapter can fan out to Google, Bing, Yahoo, Baidu, Naver and Seznam SERPs. Google Custom Search JSON API is not a new-project dependency.

### Search branches
1. General web
2. Government / official registries
3. Specialist directories / associations
4. Companies / suppliers / manufacturers
5. Documents / open data / PDF
6. News / current activity
7. Local / maps / places
8. Jobs / specialists
9. Public social/community discovery
10. Regional-language expansion

## Public groups and communities

The system generates discovery queries for public/indexed pages such as:
- Facebook public groups/pages
- Telegram public channels/pages
- LinkedIn public profiles/company pages/group pages where indexed
- Reddit communities
- YouTube channels/videos
- Meetup communities/events
- Discord invite/discovery pages that are public/indexed
- Quora
- public forums and Google Groups

Example query shapes are generated with `site:` operators and keyword variants. The system records the query/engine/domain provenance.

## Access policy

Public discovery does not mean unrestricted scraping. The agent must respect robots/policy, authentication and rate limits. Restricted sources are marked `blocked`, `auth_required`, `policy_restricted` or `manual_review`. CAPTCHA, anti-detect, fingerprint spoofing, stolen credentials and unauthorized access are explicitly out of scope.

## Recall strategy

For a deep search, the agent should expand across: 
- synonyms
- local-language terms
- geography variants
- source-type variants
- social/community variants
- document/PDF variants
- official registry variants

The goal is broad candidate discovery, followed by source-level verification and evidence capture. Search-engine snippets are not accepted as final evidence when the underlying source is available.

## Cost control

`SUPPLEMENTAL_SEARCH_MAX_QUERIES` caps supplemental query fan-out. Production should add per-provider quotas, budget accounting, concurrency limits and a cost-per-qualified-result metric.
