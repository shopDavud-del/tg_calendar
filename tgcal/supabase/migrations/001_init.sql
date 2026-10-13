-- =====================================================================
--  Календарь для Telegram: схема базы данных
--  Запустить целиком в Supabase → SQL Editor → Run
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Пользователи (Telegram ID — единственное, что мы знаем о человеке)
create table if not exists public.users (
  id           bigint primary key,
  tz           text not null default 'UTC',
  plan         text not null default 'free' check (plan in ('free','plus','pro')),
  plan_until   timestamptz,
  ics_token    text not null unique
               default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  settings     jsonb not null default '{"theme":"midnight","radius":22,"week_start":1,"view":"month"}',
  created_at   timestamptz not null default now()
);

-- Группы, куда добавлен бот
create table if not exists public.groups (
  chat_id      bigint primary key,
  title        text,
  sponsor_id   bigint references public.users(id) on delete set null,  -- чей тариф действует в группе
  ask_unclear  boolean not null default false,  -- спрашивать «добавить?» про сообщения с датой без команды
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.group_members (
  chat_id  bigint not null,
  user_id  bigint not null,
  primary key (chat_id, user_id)
);
create index if not exists group_members_user on public.group_members(user_id);

-- События. owner_id: положительный = личный календарь, отрицательный = группа
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  owner_id    bigint not null,
  title       text not null check (char_length(title) between 1 and 200),
  notes       text check (char_length(notes) <= 1000),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  tz          text not null default 'UTC',
  repeat      text check (repeat in ('daily','weekly','monthly','yearly')),
  remind      int[] not null default '{30}',   -- минуты ДО начала; для «весь день»: -540 = в 9:00 того же дня
  created_by  bigint,
  source      text not null default 'app',     -- app | bot | google | ics
  google_id   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists events_owner_start on public.events(owner_id, starts_at);
-- NULL в google_id не конфликтуют между собой, поэтому индекс обычный (нужен для upsert)
create unique index if not exists events_google_uniq on public.events(owner_id, google_id);

-- Запланированные уведомления
create table if not exists public.reminders (
  id          bigserial primary key,
  event_id    uuid not null references public.events(id) on delete cascade,
  occurrence  timestamptz not null,
  offset_min  int not null,
  fire_at     timestamptz not null,
  sent        boolean not null default false,
  unique (event_id, occurrence, offset_min)
);
create index if not exists reminders_due on public.reminders(fire_at) where not sent;

-- Токены Google (refresh-токен хранится ЗАШИФРОВАННЫМ, ключ — в секретах функций)
create table if not exists public.google_tokens (
  user_id      bigint primary key references public.users(id) on delete cascade,
  refresh_enc  text not null,
  calendar_id  text not null default 'primary',
  connected_at timestamptz not null default now()
);

-- Платежи в Stars
create table if not exists public.payments (
  charge_id    text primary key,
  user_id      bigint not null,
  plan         text not null,
  period       text not null,
  stars        int not null,
  is_recurring boolean not null default false,
  refunded     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Ожидающие подтверждения «Да / Нет»
create table if not exists public.pending (
  id          uuid primary key default gen_random_uuid(),
  chat_id     bigint not null,
  user_id     bigint not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);

-- Служебное (метка проверки активности и т.п.)
create table if not exists public.meta (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  БЕЗОПАСНОСТЬ: RLS включён, политик НЕТ → ключ anon не видит ничего.
--  Доступ есть только у Edge Functions (service_role), которые сами
--  проверяют подпись Telegram и права пользователя.
-- ---------------------------------------------------------------------
alter table public.users          enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.events         enable row level security;
alter table public.reminders      enable row level security;
alter table public.google_tokens  enable row level security;
alter table public.payments       enable row level security;
alter table public.pending        enable row level security;
alter table public.meta           enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
