-- Kleine voet: één gedeelde keuken per huiscode.
-- De tabel is niet direct leesbaar; alleen wie de huiscode kent, kan via deze twee functies lezen en schrijven.

create table if not exists public.kitchen (
  code text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.kitchen enable row level security;
revoke all on public.kitchen from anon, authenticated;

create or replace function public.get_kitchen(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.kitchen where code = p_code and length(p_code) >= 12;
$$;

create or replace function public.set_kitchen(p_code text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(p_code) < 12 then
    raise exception 'huiscode te kort';
  end if;
  insert into public.kitchen (code, data, updated_at)
  values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end;
$$;

grant execute on function public.get_kitchen(text) to anon;
grant execute on function public.set_kitchen(text, jsonb) to anon;
