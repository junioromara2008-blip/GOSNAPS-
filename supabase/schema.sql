create table if not exists public.profiles(
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text default 'GOSNAPS member',
 created_at timestamptz default now()
);
create table if not exists public.messages(
 id bigint generated always as identity primary key,
 sender text not null,
 text text,
 attachment text,
 created_at timestamptz default now()
);
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
create policy "profile read authenticated" on public.profiles for select to authenticated using(true);
create policy "profile own insert" on public.profiles for insert to authenticated with check(auth.uid()=id);
create policy "messages read authenticated" on public.messages for select to authenticated using(true);
create policy "messages insert authenticated" on public.messages for insert to authenticated with check(true);
alter publication supabase_realtime add table public.messages;
-- Storage: create bucket `gosnaps-files` in Dashboard > Storage.
-- For production, add Storage RLS policies limiting upload/download to authenticated users.
