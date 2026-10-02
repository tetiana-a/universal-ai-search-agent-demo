# Search provider verification — 2026-10-02

This file records the external provider facts used when designing the global search router.

## Direct providers

- Brave Search API — web search plus specialized endpoints such as local, images, news and video: https://brave.com/search/api/
- Tavily Search API — real-time search for AI applications: https://help.tavily.com/articles/4840311948-what-is-the-tavily-search-api
- Mojeek Search API — general web search with language/country controls: https://www.mojeek.com/services/search/web-search-api/
- Yandex Search API — Russian, Turkish and world search types: https://yandex.cloud/ru/services/search-api
- Naver Search API — web/news/blog/shop/local and specialist/document search categories: https://developers.naver.com/docs/serviceapi/search/doc/doc.md

## SERP aggregation

DataForSEO SERP API currently documents support for Google, Bing, Yahoo, Baidu, Naver and Seznam, with location/language parameters: https://docs.dataforseo.com/v3/serp/overview/

## Important platform lifecycle notes

Google Custom Search JSON API is closed to new customers; existing customers are expected to transition by 2027-01-01. It is therefore not a new-project dependency: https://developers.google.com/custom-search/v1/overview

Microsoft Bing Search APIs were retired on 2025-08-11. Microsoft points customers toward Grounding with Bing Search in Azure AI Agents: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement

## Public community discovery

The agent can discover indexed public pages for Facebook, Telegram, LinkedIn, Reddit, YouTube, Meetup, Discord, Quora and public forums through search-engine queries. This is discovery, not a promise of unrestricted scraping.

Telegram Bot API remains an official bot interface; current 2026 Bot API changelog is tracked at https://core.telegram.org/bots/api-changelog

## Product policy

Never bypass CAPTCHA, anti-bot challenges, authentication, rate limits or access controls. A restricted source becomes `blocked`, `auth_required`, `policy_restricted` or `manual_review` and the router should continue via an allowed provider or another source.
