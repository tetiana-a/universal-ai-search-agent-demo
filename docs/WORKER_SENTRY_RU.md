# Фоновая очередь (Graphile Worker на Render) и Sentry

Архитектура: **AURELIUS (Vercel) + Supabase PostgreSQL + Graphile Worker на Render + Telegram Bot API + DataForSEO + Apify + Postiz + Sentry**. Без n8n и Ayrshare.

## Что делает очередь

| Задача | Когда (UTC) | Повторы |
|---|---|---|
| `dispatch`: публикации кампаний по расписанию | каждые 5 минут | 3 |
| `daily_scout`: скан Разведчика и отчёт | 06:00 | 3 |
| `daily_groups`: обновление базы сообществ | 07:00 | 3 |
| `daily_campaigns`: план дня, партнёры, бот, мониторинг, отчёт, архив | 08:00 | 2 |

- **Очередь** хранится в Supabase (схема `graphile_worker`, создаётся сама при первом запуске).
- **Повторы** с растущей паузой. **Идемпотентность**: у каждой задачи ключ (`jobKey`), а отправка поста дополнительно защищена отметкой «уже отправлено», поэтому повтор не публикует второй раз.
- **Dead-letter**: если все попытки не удались, запись попадает в таблицу `aurelius_dead_jobs` в Supabase, на /control (красная строка) и одно сообщение в Telegram-группу.
- **Heartbeat**: раз в минуту. На /control видно «Фоновая очередь: работает / молчит / не подключена».
- **Запасной вариант**: пока очередь жива, старые расписания (Vercel Cron и GitHub Actions) ничего не делают. Если очередь молчит 5 минут, они снова работают сами. `WORKER_FALLBACK=always` в Vercel заставляет их всегда работать.
- У задач на Render нет лимита 300 секунд, как у Vercel, поэтому ежедневный мониторинг проходит по всем кампаниям.

## Шаг 1. DATABASE_URL из Supabase (бесплатно)

1. Откройте https://supabase.com/dashboard и проект **aurelius**.
2. Вверху нажмите кнопку **Connect**.
3. Вкладка **Connection String**, в поле **Method** выберите **Session pooler**.
4. Скопируйте строку вида `postgresql://postgres.pzgenazaubbikatjlkgy:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
5. Вместо `[YOUR-PASSWORD]` вставьте пароль базы. Если не помните: **Project Settings → Database → Reset database password**, задайте новый и сохраните.

## Шаг 2. Sentry (бесплатный тариф Developer)

1. https://sentry.io/signup/ — зарегистрируйтесь (можно через GitHub).
2. **Create Project** → платформа **Next.js** → имя `aurelius` → **Create Project**.
3. Мастер установки пропустите (код уже готов). Откройте **Settings → Projects → aurelius → Client Keys (DSN)** и скопируйте **DSN** (`https://…@….ingest.sentry.io/…`).
4. Vercel → проект → **Settings → Environment Variables** → добавьте две переменные (Production и Preview) с этим DSN: `SENTRY_DSN` и `NEXT_PUBLIC_SENTRY_DSN`. Затем **Deployments → … → Redeploy**.

## Шаг 3. Render (платно, около $7 в месяц, только после вашего «да»)

1. https://dashboard.render.com → войдите через **GitHub**.
2. **New → Blueprint** → выберите репозиторий `universal-ai-search-agent-demo` → **Connect**.
3. Render прочитает `render.yaml` и покажет сервис **aurelius-worker** (Background Worker, Starter, Frankfurt).
4. Заполните поля значениями из Vercel (**Settings → Environment Variables**, у каждой «⋯ → Edit», скопировать): `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_CHAT_IDS`, `CAMPAIGN_AUTOPOST`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `JINA_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `APIFY_TOKEN`, `POSTIZ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Пустые у вас в Vercel оставьте пустыми. `DATABASE_URL` из шага 1, `SENTRY_DSN` из шага 2.
5. **Apply** и привяжите карту. Через 2–3 минуты в **Logs** появится `AURELIUS queue running`, а на /control: «Фоновая очередь: работает».

## Ограничения

- Supabase Free **не делает резервных копий**. Ежедневный архив и Excel-выгрузка на /analytics остаются вашей копией. Бэкапы есть с тарифа Pro ($25/мес).
- Сайт и бот продолжают работать без Render: тогда расписание идёт через Vercel и GitHub, как раньше.
