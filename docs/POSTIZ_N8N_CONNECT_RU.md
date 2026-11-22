# AURELIUS 1.2 — Postiz + n8n + Google Sheets + DataForSEO + TGStat
Последнее обновление: 22.11.2026. Проект: tetiana-a/universal-ai-search-agent-demo.
Облако: https://universal-ai-search-agent-demo.vercel.app

## Что уже создано в этой GitHub-ветке
- `lib/scout/postiz.ts`: проверка собственных подключённых каналов Postiz и создание **черновика, без публикации**.
- `GET/POST /api/scout/postiz`: требует `x-scout-key`. GET возвращает доступные аккаунты; POST принимает только `action:"draft"`. Никаких публичных рассылок.
- `/postiz` и `/postizdraft ACCOUNT_ID | текст` в личном Telegram-боте владельца (после выката).
- `lib/scout/tgstat.ts`: лицензированный TGStat Search, OFF до настройки `TGSTAT_TOKEN` и `TGSTAT_SEARCH_ENABLED=on`.
- n8n JSON для проверки Postiz, создания черновиков и зеркальной выгрузки в Google Sheets; предыдущие n8n-файлы (ежедневный отчёт и разрешённая Telegram-очередь) сохранены.

## ШАГ 0. ВАЖНО: безопасность production
В Vercel Project → Settings → Environment Variables нужно создать `SCOUT_ADMIN_KEY` и `CRON_SECRET` (разные длинные случайные секреты).
Установить `SCOUT_PUBLIC_DASHBOARD=off`, `TELEGRAM_OPEN_GROUP_ACCESS=off`, `CAMPAIGN_AUTOPOST=off`.
Новая версия остаётся в PR #44, пока владелец не подтвердит настройки. Не запускайте рекламу в тестовых Preview deployments, если они подключены к боевой базе Redis.

## ШАГ 1. Postiz (экран пользователя: Настройки → Вебхуки (0/2))
**Вебхуки — обратные уведомления, они не нужны для первоначального API-подключения.**
1. В `https://platform.postiz.com/settings` выберите **Агенты / Разработчик** (или Public API / Developers, в зависимости от интерфейса).
2. Найдите **Public API** и нажмите **Reveal** или создание ключа. Это секретный API-ключ Postiz.
3. Подключите через встроенную авторизацию **СОБСТВЕННУЮ** Facebook Page, Instagram Professional, TikTok или Telegram-канал к Postiz; подтвердите нужные разрешения в соцсети. Название «Facebook» в Postiz для API — Page, **не чужая группа**.
4. В Vercel добавьте `POSTIZ_API_KEY` (секретное поле, Production). Для облачного Postiz API сервер фиксирован: `https://api.postiz.com/public/v1`.
5. После выката PR #44 в личном чате с @AURELIUS8_bot отправьте `/postiz`. Бот покажет **только действительно подключённые** каналы и их ID.
6. Тест: `/postizdraft INTEGRATION_ID | Это тестовый черновик AURELIUS, без публикации рекламы.`. Проверьте появление записи в черновиках Postiz. Пост НЕ опубликован и не поставлен на отправку. Если нужна публикация — сначала проверьте черновик и запланируйте его в Postiz UI.
7. При проблемах: `POSTIZ_NOT_CONFIGURED` — отсутствует API-ключ; `401` от AURELIUS — неправильный `SCOUT_ADMIN_KEY`; `POSTIZ_HTTP_401` — неверный ключ Postiz; `CHANNEL_NOT_CONNECTED` — неправильный Integration ID или OAuth не подключён.

## ШАГ 2. n8n Cloud (ваш скриншот)
Устанавливать локально ничего не нужно.
1. Нажмите слева **+ → New workflow**; в редакторе меню **... → Import from File**.
2. Скачайте JSON из папки `n8n/` этой GitHub-ветки и импортируйте по одному:
   - `aurelius-postiz-connection-check.json` — безопасная проверка API и каналов.
   - `aurelius-postiz-draft-only.json` — ручное создание черновика Postiz; **не публикует**.
   - `aurelius-google-sheets-sync.json` — зеркальная таблица.
   - `aurelius-readonly-daily-report.json` — ежедневный отчёт владельцу.
   - `aurelius-authorized-dispatch-waves.json` — только разрешённые Telegram-группы, первоначально OFF.
3. В n8n слева **+ → New credential → Header Auth**:
   - Name: `x-scout-key`
   - Value: значение `SCOUT_ADMIN_KEY` из Vercel (секрет в Credential, не в JSON).
4. Откройте каждый HTTP Request узел с `/api/scout/postiz`, `/api/groups` или `/api/campaigns` и выберите созданный Header Auth credential.
5. Запустите вручную только **AURELIUS — inspect connected Postiz channels**: должны появиться объекты `integrationId`, `account`, `platform`, `canDraft`.
6. Для **черновика** откройте Code node «OWNER: fill integration and draft», вставьте `integrationId` вашего аккаунта и безопасный тестовый текст, затем **Execute Workflow**. Ответ `DRAFT ONLY - NOT PUBLISHED`. Этот workflow не содержит автотриггера.

**НЕЛЬЗЯ:** создавать n8n Telegram Trigger для того же бота — он перезапишет текущий Telegram webhook Vercel. В n8n используйте только Telegram **Send Message** и/или вызовы защищённых API AURELIUS.

## ШАГ 3. Google Sheets
1. В Google Drive создайте таблицу **AURELIUS CRM** с четырьмя листами:
`Groups`, `GroupPosts`, `Campaigns`, `Tasks`.
2. На первой строке листов разместите заголовки **ровно в указанном порядке**:
   - Groups: `id,url,name,platform,city,country,status,ads,members,botConnected,postingEnabled,updatedAt`
   - GroupPosts: `id,groupId,groupName,platform,status,mode,link,createdAt,error`
   - Campaigns: `id,title,topic,region,status,platforms,dailyTarget,found,updatedAt`
   - Tasks: `id,campaignId,groupId,groupName,platform,mode,status,day,link,error`
3. Скопируйте ID таблицы из URL между `/d/` и `/edit`.
4. Импортируйте `aurelius-google-sheets-sync.json`, во всех четырёх узлах Google Sheets замените `REPLACE_SPREADSHEET_ID` на ID вашего документа, затем через **Google Sheets OAuth2** выберите собственный Google-аккаунт и соответствующие листы.
5. В двух HTTP Request узлах подставьте тот же Header Auth `x-scout-key`.
6. Запустите вручную и убедитесь, что каждая строка появляется/обновляется по полю `id`. Перед регулярной синхронизацией убедитесь, что все четыре ноды действительно используют операцию **Append or Update**.
7. Redis остаётся **главной** базой. Google Sheets — зеркальный рабочий журнал; не храните в нём пароли/токены, удаляйте лишние личные данные и контролируйте доступ.

## ШАГ 4. Поиск (DataForSEO + TGStat)
Текущий поисковый ключ Gemini не гарантирует доступность Google Search grounding и может возвращать HTTP 404.

**DataForSEO**:
- Регистрация и биллинг в https://dataforseo.com/; API-логин и пароль нужны отдельно.
- Vercel: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `DATAFORSEO_GROUP_SEARCH=on`.
- Начните с малого бюджета; запросы могут быть платными даже при нулевом результате.

**TGStat** (необязателен для MVP):
- Получите TGStat API Stat с разрешением `channels/search`; этот метод доступен на планах S+.
- Vercel: `TGSTAT_TOKEN` и `TGSTAT_SEARCH_ENABLED=on` только после подтверждения тарифа.
- TGStat возвращает ссылки публичных Telegram-групп/каналов, которые AURELIUS повторно проверяет через публичную страницу. **TGStat не даёт права публиковать.**
- Не полагайтесь на TGStat для Facebook/Instagram/TikTok или приватных групп.

## ШАГ 5. Публикации и тестирование
**Telegram API:** в тестовой группе, где Татьяна является владельцем, назначьте бота администратором и выполните `/connect` (после выката). Сделайте одну harmless тестовую публикацию и сохраните реальную ссылку и статус.

**Postiz:** публикация на своих подключённых страницах после проверки черновика пользователем. Отслеживайте результат на Postiz, а не засчитывайте созданный draft как опубликованный пост.

**Facebook Groups:** подтверждённые администратором ручные/партнёрские задачи, без обещания Facebook Group автопостинга от API.

**n8n Telegram dispatch waves:** импортированный workflow выключен, серверная переменная `CAMPAIGN_AUTOPOST=off`. Включить можно лишь после 14-дневной проверки и согласия клиента. Входной API `/api/campaigns/dispatch` требует Bearer `CRON_SECRET`; авторизацию надо оформить отдельным n8n Credential.

**Postiz Webhooks (0/2):** пока ничего там не создавайте. Позже возможен вебхук с Postiz на защищённый n8n endpoint для синхронизации событий публикации. Без серверной верификации события нельзя засчитывать как доказанный пост.

## Не обещать заказчику
- 300 в день из неизвестных сторонних групп: нужны сотни/тысячи разрешённых площадок с договорённостями.
- 90% полноты интернета: только 90% из конкретного датированного контрольного списка реально доступных живых групп.
- Безопасное размещение в приватных сообществах без согласия администратора.
- Отсутствие блокировок; можно лишь соблюдать официальные лимиты и не использовать обходы.

Основные полезные ссылки:
https://docs.postiz.com/public-api/introduction
https://docs.postiz.com/public-api/posts/create
https://docs.postiz.com/public-api/integrations/list
https://docs.n8n.io/integrations/builtin/credentials/httprequest/
https://api.tgstat.ru/docs/ru/channels/search.html

Все подготовленные n8n workflows намеренно **inactive** и без секретов. Документы описывают, как включить их после настройки.

## Дополнительный режим: ОДОБРЕННАЯ публикация по расписанию Postiz

Файл `n8n/aurelius-postiz-approved-schedule.json` импортируется **выключенным** и запускается вручную. Он может поставить пост на расписание, но для этого нужны **ВСЕ** условия:
1. `POSTIZ_ENABLE_SCHEDULE=on` в Vercel (по умолчанию отсутствует, поэтому запрещено).
2. Существующая кампания AURELIUS со статусом `approved` и `approvedAt`.
3. Конкретный `integrationId` реально подключённого аккаунта Postiz.
4. Владелец должен отредактировать Code node: `campaignId`, `integrationId` и `scheduledAt` не менее 5 минут в будущем.
5. Запрос включает `confirm=I_APPROVE_SCHEDULE`, проверяется сервером.
6. Поддерживаются простые каналы Facebook Page, LinkedIn Page/Profile, Telegram и некоторые текстовые платформы. Instagram/TikTok имеют дополнительные медиатребования; их пока следует планировать в интерфейсе Postiz.
7. Результат `SCHEDULED_NOT_VERIFIED_PUBLISHED` означает, что Postiz принял расписание, **не** что внешний пост опубликован.

`n8n/aurelius-postiz-posts-to-sheets.json` — отдельный ручной workflow для выгрузки последних постов Postiz с доступными внешними URL. Создайте пятый лист `PostizPosts` с заголовками `id,channel,platform,publishDate,releaseURL,verification`, подставьте Google Sheets OAuth и x-scout-key. Запись `linked` означает, что Postiz сообщил внешнюю ссылку; для доказательства существования поста необходимо дополнительно открыть эту ссылку и проверить доступность.

В разделе «Вебхуки (0/2)» Postiz пока не нужно ничего добавлять. Для последующего webhook-мониторинга потребуется защищённый URL n8n с проверкой подлинности; без этого нельзя доверять событиям.

**Важно:** никакие ключи внешних API не будут автоматически добавлены из этого репозитория. До настройки владельцем приложения остаются в режиме ожидающего подключения.
