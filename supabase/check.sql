-- Проверка: выполнены ли все SQL-миграции. Вставьте в Supabase → SQL Editor → Run.
-- В колонке «есть» везде должно быть true. Если где-то false — выполните миграцию, указанную в колонке «миграция».
select * from (
  select 'таблица event_done' as проверка, '003_v21' as миграция, to_regclass('public.event_done') is not null as есть
  union all select 'таблица services', '003_v21', to_regclass('public.services') is not null
  union all select 'таблица refund_requests', '003_v21', to_regclass('public.refund_requests') is not null
  union all select 'таблица clients', '004_v3', to_regclass('public.clients') is not null
  union all select 'таблица referrals', '004_v3', to_regclass('public.referrals') is not null
  union all select 'таблица promo_codes', '002_v2', to_regclass('public.promo_codes') is not null
  union all select 'таблица day_marks', '002_v2', to_regclass('public.day_marks') is not null
  union all select 'events.group_id', '002_v2', exists(select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='group_id')
  union all select 'events.client_id', '004_v3', exists(select 1 from information_schema.columns where table_schema='public' and table_name='events' and column_name='client_id')
  union all select 'users.disc_pct', '004_v3', exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='disc_pct')
  union all select 'groups.lang', '004_v3', exists(select 1 from information_schema.columns where table_schema='public' and table_name='groups' and column_name='lang')
  union all select 'groups.mode', '002_v2', exists(select 1 from information_schema.columns where table_schema='public' and table_name='groups' and column_name='mode')
  union all select 'users.banned', '005_safety', exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='banned')
  union all select 'функция db_size', '005_safety', exists(select 1 from pg_proc where proname='db_size')
  union all select 'функция cleanup_old', '005_safety', exists(select 1 from pg_proc where proname='cleanup_old')
) t order by есть, проверка;
