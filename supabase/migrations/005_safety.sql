-- =====================================================================
--  v3.3: защита от переполнения базы, блокировки, автоочистка
--  Запустить целиком в Supabase → SQL Editor → Run (один раз)
-- =====================================================================
alter table public.users add column if not exists banned boolean not null default false;

-- Размер базы (для предупреждений администратору). Доступна только функциям, не публично.
create or replace function public.db_size() returns bigint language sql security definer set search_path = public as
$$ select pg_database_size(current_database()) $$;

-- Автоочистка: прошедшие разовые события удаляются через N дней (Free — меньше, платные — дольше)
create or replace function public.cleanup_old(free_days int, paid_days int) returns int language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  with d as (
    delete from public.events e
    where e.repeat is null
      and coalesce(e.ends_at, e.starts_at) < now() - make_interval(days => case
        when e.owner_id > 0 and not exists (select 1 from public.users u where u.id = e.owner_id and u.plan <> 'free' and u.plan_until > now()) then free_days
        else paid_days end)
    returning 1)
  select count(*) into n from d;
  delete from public.day_marks where day < current_date - 1100;
  return n;
end $$;

revoke all on function public.db_size() from public, anon, authenticated;
revoke all on function public.cleanup_old(int, int) from public, anon, authenticated;
grant execute on function public.db_size() to service_role;
grant execute on function public.cleanup_old(int, int) to service_role;
