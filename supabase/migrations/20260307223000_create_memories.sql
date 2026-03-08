create extension if not exists pgcrypto with schema extensions;

create table public.memories (
  id uuid primary key default extensions.gen_random_uuid(),
  content text not null check (length(trim(content)) > 0),
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_created_at_idx on public.memories (created_at desc);

alter table public.memories enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger memories_set_updated_at
before update on public.memories
for each row
execute function public.set_updated_at();
