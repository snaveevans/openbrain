create or replace function public.fetch_memory(memory_id uuid)
returns table (
  id uuid,
  content text,
  source text,
  metadata jsonb,
  embedding_model text,
  created_at timestamptz,
  updated_at timestamptz,
  embedded_at timestamptz
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
    memories.embedded_at
  from public.memories as memories
  where memories.id = memory_id
  limit 1;
$$;

revoke execute on function public.match_memories(extensions.vector, integer, text) from public;
revoke execute on function public.fetch_memory(uuid) from public;

revoke execute on function public.match_memories(extensions.vector, integer, text) from anon;
revoke execute on function public.match_memories(extensions.vector, integer, text) from authenticated;
revoke execute on function public.fetch_memory(uuid) from anon;
revoke execute on function public.fetch_memory(uuid) from authenticated;

grant execute on function public.match_memories(extensions.vector, integer, text) to service_role;
grant execute on function public.fetch_memory(uuid) to service_role;
