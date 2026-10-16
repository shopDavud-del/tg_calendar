-- Запускать в Supabase → SQL Editor ПОСЛЕ деплоя функций.
-- Замените ВАШ_PROJECT_REF и ВАШ_CRON_SECRET (тот же, что в секретах функций).
-- Каждую минуту: уведомления, продление повторов, проверка тарифов, проверка активности раз в 5 дней.

select cron.schedule(
  'calendar-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ujvcphbwygjfefwuzgsu.supabase.co/functions/v1/cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '4b29694cd236c1772196c980359a0c2bf9bd4121d17c37a1'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);

-- Остановить:   select cron.unschedule('calendar-tick');
-- Проверить:    select * from cron.job_run_details order by start_time desc limit 5;
