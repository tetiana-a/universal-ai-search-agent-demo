-- AURELIUS: readable views over aurelius_archive (Russian columns, statuses in words).
-- Open any view in Supabase → Table Editor → Export → CSV. Run once in SQL Editor (safe to re-run).
-- security_invoker: views obey the table's RLS, so only the service key can read them (no public access).
create or replace function public.aurelius_platform(p text) returns text language sql immutable set search_path = '' as $$
  select case p when 'telegram' then 'Telegram' when 'facebook' then 'Facebook' when 'instagram' then 'Instagram' when 'tiktok' then 'TikTok' else p end $$;

create or replace view public."Сообщества" with (security_invoker = true) as
select data->>'name' as "Название",
  public.aurelius_platform(data->>'platform') as "Площадка",
  case data->>'kind' when 'group' then 'группа' when 'channel' then 'канал' when 'profile' then 'профиль' else data->>'kind' end as "Тип",
  data->>'url' as "Ссылка",
  round((data->>'members')::numeric)::bigint as "Участники",
  data->>'country' as "Страна", data->>'city' as "Город", data->>'language' as "Язык", data->>'topic' as "Тема",
  case data->>'relevance' when 'core' then 'профильное' when 'adjacent' then 'смежное' else data->>'relevance' end as "Релевантность",
  data->>'foundBy' as "Найдено по запросу",
  case data->>'activity' when 'active' then 'активна' when 'inactive' then 'неактивна — исключена из размещения' else 'не проверено (нет публичной ленты)' end as "Активность",
  (data->>'lastPostAt')::date as "Последний пост",
  (data->>'postsPerWeek')::numeric as "Постов в неделю",
  case data->>'ads' when 'allowed' then 'разрешена' when 'admin' then 'через админа' when 'paid' then 'платно' when 'forbidden' then 'запрещена' else 'не указано' end as "Реклама",
  data->>'adminContact' as "Контакт админа",
  case data->>'status' when 'new' then 'новая' when 'contacted' then 'написали админу' when 'free' then 'бесплатно' when 'exchange' then 'обмен' when 'paid' then 'платно' when 'declined' then 'отказ' else data->>'status' end as "Статус",
  day as "Найдено"
from public.aurelius_archive where collection = 'groups';

create or replace view public."Кампании" with (security_invoker = true) as
select data->>'title' as "Кампания", data->>'topic' as "Тема", data->>'region' as "Регион",
  case data->>'status' when 'draft' then 'черновик' when 'searching' then 'идёт поиск' when 'ready' then 'готова' when 'approved' then 'запущена' when 'stopped' then 'остановлена' else data->>'status' end as "Статус",
  (data->>'dailyTarget')::int as "Цель в день",
  (select string_agg(x, ', ') from jsonb_array_elements_text(case jsonb_typeof(data->'languages') when 'array' then data->'languages' else '[]' end) x) as "Языки",
  (select string_agg(x, ', ') from jsonb_array_elements_text(case jsonb_typeof(data->'keywords') when 'array' then data->'keywords' else '[]' end) x) as "Ключевые слова",
  data->>'adText' as "Текст объявления",
  day as "Создана", id as "ID"
from public.aurelius_archive where collection = 'campaigns';

create or replace view public."Размещения" with (security_invoker = true) as
select (data->>'day')::date as "День", data->>'campaignTitle' as "Кампания", data->>'groupName' as "Группа",
  public.aurelius_platform(data->>'platform') as "Площадка",
  case data->>'mode' when 'bot' then 'бот' when 'partner' then 'админ-партнёр' when 'manual' then 'вручную' else data->>'mode' end as "Способ",
  case data->>'status' when 'scheduled' then 'запланировано' when 'sent' then 'опубликовано ботом' when 'failed' then 'ошибка' when 'notified' then 'ждёт партнёра' when 'proof' then 'ждёт проверки' when 'verified' then 'засчитано' when 'skipped' then 'пропущено' when 'cancelled' then 'отменено' else data->>'status' end as "Статус",
  coalesce(data->>'link', '') as "Ссылка на пост", data->>'url' as "Ссылка на группу"
from public.aurelius_archive where collection = 'campaign_tasks';

create or replace view public."Журнал публикаций" with (security_invoker = true) as
select (data->>'at')::timestamptz as "Время", data->>'groupName' as "Группа", public.aurelius_platform(data->>'platform') as "Площадка",
  case data->>'mode' when 'bot' then 'бот' else 'вручную/партнёр' end as "Способ", data->>'status' as "Статус",
  data->>'link' as "Ссылка на пост", data->>'error' as "Ошибка", data->>'by' as "Кто"
from public.aurelius_archive where collection = 'group_posts';

create or replace view public."Мониторинг" with (security_invoker = true) as
select (data->>'at')::timestamptz as "Время поста", public.aurelius_platform(data->>'platform') as "Площадка",
  data->>'title' as "Пост", data->>'author' as "Автор", (data->>'views')::bigint as "Просмотры", data->>'url' as "Ссылка"
from public.aurelius_archive where collection = 'mentions';

create or replace view public."Поиски" with (security_invoker = true) as
select (data->>'createdAt')::timestamptz as "Время", data->>'query' as "Запрос",
  case data->>'origin' when 'telegram' then 'Бот' else 'Сайт' end as "Откуда",
  (data->>'results')::int as "Результатов", (data->>'verified')::int as "Подтверждено", (select string_agg(x, '; ') from jsonb_array_elements_text(case jsonb_typeof(data->'notes') when 'array' then data->'notes' else '[]' end) x) as "Заметки"
from public.aurelius_archive where collection = 'searches';

create or replace view public."Журнал действий" with (security_invoker = true) as
select (data->>'at')::timestamptz as "Время", data->>'actor' as "Кто", data->>'action' as "Действие", data->>'detail' as "Подробности"
from public.aurelius_archive where collection = 'journal';
