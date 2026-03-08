create extension if not exists vector with schema extensions;

alter table public.memories
  add column embedding extensions.vector(1536),
  add column embedding_model text,
  add column embedded_at timestamptz;

create index memories_embedding_idx
on public.memories
using ivfflat (embedding extensions.vector_cosine_ops)
with (lists = 100);

create or replace function public.match_memories(
  query_embedding extensions.vector(1536),
  match_count integer default 10,
  match_source text default null
)
returns table (
  id uuid,
  content text,
  source text,
  metadata jsonb,
  embedding_model text,
  created_at timestamptz,
  updated_at timestamptz,
  similarity double precision
)
language sql
stable
as $$
  select
    memories.id,
    memories.content,
    memories.source,
    memories.metadata,
    memories.embedding_model,
    memories.created_at,
    memories.updated_at,
    1 - (memories.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  from public.memories as memories
  where memories.embedding is not null
    and (match_source is null or memories.source = match_source)
  order by memories.embedding OPERATOR(extensions.<=>) query_embedding
  limit greatest(match_count, 1);
$$;
