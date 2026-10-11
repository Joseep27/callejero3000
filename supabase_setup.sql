-- Proyecto existente SitiosRelevantesVLC. No modifica otras tablas ni sus datos.
begin;
create table if not exists public.callejero3000_sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.callejero3000_sync_state enable row level security;
revoke all on public.callejero3000_sync_state from anon;
grant select, insert, update on public.callejero3000_sync_state to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='callejero3000_sync_state' and policyname='callejero3000_select_own') then
    create policy callejero3000_select_own on public.callejero3000_sync_state for select to authenticated using ((select auth.uid())=user_id);
    create policy callejero3000_insert_own on public.callejero3000_sync_state for insert to authenticated with check ((select auth.uid())=user_id);
    create policy callejero3000_update_own on public.callejero3000_sync_state for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
  end if;
end $$;

-- Comparación de versión atómica: un segundo dispositivo no pisa una subida
-- concurrente. El cliente vuelve a leer y fusionar si devuelve 40001.
create or replace function public.save_callejero3000_sync(expected_revision bigint, new_payload jsonb)
returns table(revision bigint, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if expected_revision=0 then
    return query insert into public.callejero3000_sync_state as s(user_id,payload,revision,updated_at)
      values(auth.uid(),new_payload,1,now()) on conflict(user_id) do nothing returning s.revision,s.updated_at;
    if found then return; end if;
  end if;
  return query update public.callejero3000_sync_state as s
    set payload=new_payload,revision=s.revision+1,updated_at=now()
    where s.user_id=auth.uid() and s.revision=expected_revision returning s.revision,s.updated_at;
  if not found then raise exception 'Sync version conflict' using errcode='40001'; end if;
end $$;
revoke all on function public.save_callejero3000_sync(bigint,jsonb) from public, anon;
grant execute on function public.save_callejero3000_sync(bigint,jsonb) to authenticated;
commit;
