begin;

-- Internal trigger functions execute through their triggers and must not be
-- exposed as callable RPC endpoints.
revoke all on function public.append_community_task_version()
  from public, anon, authenticated;

commit;
