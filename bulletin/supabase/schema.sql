-- Bulletin database schema (Supabase / Postgres)
-- The current state of everything run in the SQL Editor, in dependency order.
-- Reference only: running this on a project that already has these tables will fail.

---------------------------------------------------------------------------
-- Profiles: one per account, created automatically on sign-up
---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null
    check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 50),
  bio text check (char_length(bio) <= 160),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Anyone can read profiles"
  on public.profiles for select
  using (true);

create policy "Users can edit their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Users may change only their display name and bio
revoke update on public.profiles from authenticated;
grant update (display_name, bio) on public.profiles to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce(new.raw_user_meta_data ->> 'display_name',
             new.raw_user_meta_data ->> 'username')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

---------------------------------------------------------------------------
-- Posts
---------------------------------------------------------------------------

create table public.posts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  content text not null
    check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lets queries join each post to its author's profile
alter table public.posts
  add constraint posts_user_id_profiles_fkey
  foreign key (user_id) references public.profiles (id)
  on delete cascade;

alter table public.posts enable row level security;

create policy "Users can create their own posts"
  on public.posts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can edit their own posts"
  on public.posts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own posts"
  on public.posts for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The read policy is in the Friendships section, since it depends on is_friend()

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute procedure public.set_updated_at();

---------------------------------------------------------------------------
-- Friendships: one row per pair; pending -> accepted, or deleted
---------------------------------------------------------------------------

create table public.friendships (
  id bigint generated always as identity primary key,
  requester_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  recipient_id uuid not null
    references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

-- Only one friendship row per pair, whichever direction it was sent
create unique index friendships_one_per_pair
  on public.friendships (
    least(requester_id, recipient_id),
    greatest(requester_id, recipient_id)
  );

alter table public.friendships enable row level security;

create policy "Users can see their own friendships"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

create policy "Users can send friend requests"
  on public.friendships for insert to authenticated
  with check ((select auth.uid()) = requester_id and status = 'pending');

create policy "Recipients can accept requests"
  on public.friendships for update to authenticated
  using ((select auth.uid()) = recipient_id)
  with check ((select auth.uid()) = recipient_id and status = 'accepted');

create policy "Either friend can remove a friendship"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

revoke insert, update on public.friendships from authenticated;
grant insert (recipient_id) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

create function public.is_friend(other_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted'
      and (
        (requester_id = (select auth.uid()) and recipient_id = other_id)
        or (recipient_id = (select auth.uid()) and requester_id = other_id)
      )
  );
$$;

-- Posts are visible to their author (including the archive)
-- and to the author's friends for 15 days
create policy "Users can read their own posts and friends' recent posts"
  on public.posts for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      public.is_friend(user_id)
      and created_at > now() - interval '15 days'
    )
  );

-- A person's friends list, visible only to them and their friends
create function public.get_friends(target_id uuid)
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name
  from public.friendships f
  join public.profiles p
    on p.id = case
      when f.requester_id = target_id then f.recipient_id
      else f.requester_id
    end
  where f.status = 'accepted'
    and target_id in (f.requester_id, f.recipient_id)
    and (
      (select auth.uid()) = target_id
      or public.is_friend(target_id)
    )
  order by p.display_name;
$$;

revoke execute on function public.get_friends(uuid) from public, anon;
grant execute on function public.get_friends(uuid) to authenticated;

---------------------------------------------------------------------------
-- Comments: soft-deleted, so a note stays behind
---------------------------------------------------------------------------

create table public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  content text check (char_length(content) between 1 and 300),
  deleted_by text check (deleted_by in ('commenter', 'author')),
  created_at timestamptz not null default now(),
  -- A comment either has text, or is deleted with a reason, never both
  check ((deleted_by is null) = (content is not null))
);

create index comments_post_id_idx on public.comments (post_id, created_at);

alter table public.comments enable row level security;

create policy "Users can read comments on posts they can see"
  on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy "Users can comment on recent posts they can see"
  on public.comments for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.created_at > now() - interval '15 days'
    )
  );

create policy "Commenters and post authors can delete comments"
  on public.comments for update to authenticated
  using (
    deleted_by is null
    and (
      (select auth.uid()) = user_id
      or (select auth.uid()) = (select p.user_id from public.posts p where p.id = post_id)
    )
  )
  with check (
    content is null
    and (
      (deleted_by = 'commenter' and (select auth.uid()) = user_id)
      or (
        deleted_by = 'author'
        and (select auth.uid()) = (select p.user_id from public.posts p where p.id = post_id)
      )
    )
  );

revoke insert, update, delete on public.comments from authenticated;
grant insert (post_id, content) on public.comments to authenticated;
grant update (content, deleted_by) on public.comments to authenticated;

---------------------------------------------------------------------------
-- Post images: up to 4 per post, in a private storage bucket
---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', false, 2097152, array['image/jpeg']);

create table public.post_images (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid()
    references public.profiles (id) on delete cascade,
  path text not null unique,
  alt text not null check (char_length(alt) between 1 and 300),
  position smallint not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  unique (post_id, position)
);

alter table public.post_images enable row level security;

create policy "Users can see images on posts they can see"
  on public.post_images for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));

create policy "Users can add images to their own posts"
  on public.post_images for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and path like (select auth.uid())::text || '/%'
    and exists (
      select 1 from public.posts p
      where p.id = post_id and p.user_id = (select auth.uid())
    )
  );

revoke insert, update, delete on public.post_images from authenticated;
grant insert (post_id, path, alt, position) on public.post_images to authenticated;

create policy "Users can upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can view images they're allowed to see"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-images'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.post_images pi where pi.path = objects.name)
    )
  );

create policy "Users can delete their own images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

---------------------------------------------------------------------------
-- Realtime: tables that send live changes (each subscriber still goes through RLS)
---------------------------------------------------------------------------

alter publication supabase_realtime add table public.posts, public.comments, public.friendships;