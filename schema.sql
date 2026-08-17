-- Grading Calendar — run once in the Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  default_minutes numeric,
  created_at timestamptz default now()
);

create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  school text, subject text, email text, phone text,
  color text, notes text,
  archived boolean default false,
  created_at timestamptz default now()
);
create index if not exists teachers_user_id_idx on teachers (user_id);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  teacher_id uuid references teachers(id) on delete cascade,
  name text not null,
  course text,
  due_date date not null,
  due_time time,
  total_items integer default 0,
  done_items integer default 0,
  minutes_per_item numeric,
  status text default 'todo',        -- 'todo' | 'doing' | 'done'
  priority text default 'normal',    -- 'low' | 'normal' | 'high'
  notes text,
  completed_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists assignments_user_id_idx on assignments (user_id);
create index if not exists assignments_due_idx on assignments (user_id, due_date);

-- Row level security: every row is readable/writable only by the account that
-- owns it. This is what makes publishing the anon key safe.
alter table profiles enable row level security;
alter table teachers enable row level security;
alter table assignments enable row level security;

drop policy if exists profiles_own on profiles;
create policy profiles_own on profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists teachers_own on teachers;
create policy teachers_own on teachers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists assignments_own on assignments;
create policy assignments_own on assignments for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
