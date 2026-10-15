-- =====================================================================
--  Обновление v2.1: «готово», услуги мастера, заявки на возврат
--  Запустить целиком в Supabase → SQL Editor → Run (один раз)
-- =====================================================================
create table if not exists public.event_done (
  event_id uuid not null references public.events(id) on delete cascade,
  day      text not null,                    -- дата вхождения в часовом поясе события, YYYY-MM-DD
  primary key (event_id, day)
);
create table if not exists public.services (
  id         uuid primary key default gen_random_uuid(),
  owner_id   bigint not null,               -- мастер (Telegram ID)
  name       text not null check (char_length(name) between 1 and 60),
  minutes    int  not null check (minutes between 5 and 720),
  created_at timestamptz not null default now()
);
create index if not exists services_owner on public.services(owner_id);
create table if not exists public.refund_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    bigint not null,
  charge_id  text not null,
  status     text not null default 'new',    -- new | approved | denied
  created_at timestamptz not null default now()
);
alter table public.event_done      enable row level security;
alter table public.services        enable row level security;
alter table public.refund_requests enable row level security;
revoke all on all tables in schema public from anon, authenticated;
