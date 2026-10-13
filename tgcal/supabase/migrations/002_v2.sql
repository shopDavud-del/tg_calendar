-- =====================================================================
--  Обновление v2: команда/салон, коды подписок, отметки дней, дайджесты
--  Запустить целиком в Supabase → SQL Editor → Run (один раз)
-- =====================================================================

-- тариф Team
alter table public.users drop constraint if exists users_plan_check;
alter table public.users add constraint users_plan_check check (plan in ('free','plus','pro','team'));

-- события команды: owner_id = кому назначена запись, group_id = в какой группе создана
alter table public.events add column if not exists group_id bigint;
create index if not exists events_group on public.events(group_id, starts_at);

-- участники групп: ник и имя (нужны, чтобы писать «запиши … @ник»)
alter table public.group_members add column if not exists username text;
alter table public.group_members add column if not exists name text;
create index if not exists group_members_username on public.group_members(chat_id, lower(username));

-- режимы групп
alter table public.groups add column if not exists mode text not null default 'shared' check (mode in ('shared','team'));
alter table public.groups add column if not exists notify_group boolean not null default true;

-- отметки дней (выполнено / пропуск / особый)
create table if not exists public.day_marks (
  user_id bigint not null,
  day     date   not null,
  mark    text   not null check (mark in ('done','miss','star')),
  primary key (user_id, day)
);

-- коды подписок
create table if not exists public.promo_codes (
  code        text primary key,
  plan        text not null check (plan in ('plus','pro','team')),
  days        int  not null check (days between 1 and 3650),
  max_uses    int  not null default 1 check (max_uses >= 1),
  used_count  int  not null default 0,
  note        text,
  expires_at  timestamptz,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  code     text not null references public.promo_codes(code) on delete cascade,
  user_id  bigint not null,
  at       timestamptz not null default now(),
  primary key (code, user_id)
);

-- журнал утренних/вечерних сообщений (чтобы не слать дважды)
create table if not exists public.digest_log (
  user_id bigint not null,
  kind    text   not null,
  day     text   not null,
  primary key (user_id, kind, day)
);

alter table public.day_marks         enable row level security;
alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.digest_log        enable row level security;
revoke all on all tables in schema public from anon, authenticated;
