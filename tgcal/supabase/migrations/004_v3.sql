-- =====================================================================
--  v3: клиенты, реферальная программа, язык групп
--  Запустить целиком в Supabase → SQL Editor → Run (один раз)
-- =====================================================================
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  scope_id   bigint not null,                 -- группа-салон (отрицательный ID) или личный календарь мастера
  name       text check (char_length(name) <= 80),
  phone      text,                            -- только цифры, с + в начале
  username   text,
  note       text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create unique index if not exists clients_phone on public.clients(scope_id, phone) where phone is not null;
create unique index if not exists clients_user  on public.clients(scope_id, lower(username)) where username is not null;
alter table public.events add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists events_client on public.events(client_id);

alter table public.users add column if not exists ref_by bigint;
alter table public.users add column if not exists disc_pct int not null default 0 check (disc_pct between 0 and 60);
create table if not exists public.referrals (
  referee_id  bigint primary key,
  referrer_id bigint not null,
  rewarded    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists referrals_referrer on public.referrals(referrer_id);
alter table public.groups add column if not exists lang text not null default 'ru';

alter table public.clients   enable row level security;
alter table public.referrals enable row level security;
revoke all on all tables in schema public from anon, authenticated;
