-- Resolve Supabase linter warning:
-- rls_disabled_in_public on public.v_next_queue_item.
--
-- Production has reported this relation as a table, but the defensive
-- relkind check keeps the migration safe if another environment has it
-- as a view or materialized view.
do $$
declare
  v_relkind "char";
begin
  select c.relkind
  into v_relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'v_next_queue_item';

  if v_relkind is null then
    raise notice 'public.v_next_queue_item does not exist; skipping hardening';
    return;
  end if;

  if v_relkind in ('r', 'p') then
    execute 'alter table public.v_next_queue_item enable row level security';

    execute 'drop policy if exists deny_direct_api_access on public.v_next_queue_item';

    execute $policy$
      create policy deny_direct_api_access
        on public.v_next_queue_item
        for all
        to anon, authenticated
        using (false)
        with check (false)
    $policy$;
  elsif v_relkind = 'v' then
    execute 'alter view public.v_next_queue_item set (security_invoker = true)';
  end if;

  execute 'revoke all on public.v_next_queue_item from anon, authenticated';
end $$;
