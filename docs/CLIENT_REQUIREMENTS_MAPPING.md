# Client requirements → implementation mapping

| Client requirement | Current working project | Production follow-up |
|---|---|---|
| Natural-language arbitrary query | Implemented | Persist SearchTask |
| Understand criteria/geography | Implemented via structured query understanding contract | Benchmark intent parsing |
| Build broad source map | Implemented with source branches + supplemental providers | Persistent Source Registry + source discovery workers |
| Research sources | Implemented through OpenAI web search + optional provider discovery | HTTP/Jina/Firecrawl/Playwright workers |
| Show inaccessible sources | Implemented | Persist source checks/history |
| Extract structured fields | Implemented result schema | Adaptive schema engine per task type |
| Evidence for facts | Implemented evidence summary + evidence quote | Evidence store + source snapshots |
| Deduplication | Implemented deterministic URL/title/location/area dedup | Entity resolution service + embeddings |
| Quality Gate | Implemented | Benchmark-driven thresholds |
| Search progress | Existing UI + new transparency panels | Durable realtime task progress |
| Source memory | UI and response contract prepared | PostgreSQL Source Registry + Source Health |
| Excel export | Implemented `.xlsx` | Server-side export worker for large datasets |
| PDF | Implemented print-to-PDF | Server-side report renderer for unattended export |
| Google Docs | Implemented Google Docs-compatible `.doc` report | Drive API connector if customer wants one-click push |
| JSON reproducibility | Implemented | Versioned export manifests |
| CAPTCHA / bot restrictions | No bypass; explicit fallback states | Add licensed providers and manual review queue |
| Security | Prompt injection / SSRF / secrets documented in code contract | Full sandbox and egress enforcement |
| Multi-source / vendor lock-in | Optional Brave/Exa/Tavily + OpenAI web | Provider router and health scoring |
