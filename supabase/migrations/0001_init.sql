-- ElMaster student app: initial schema.
-- Catalog tables are world-readable; everything a student owns is locked to
-- that student with row-level security. Purchases go through place_order(),
-- which prices the cart server-side and writes order + enrollments atomically.

-- ───────────────────────── Catalog ─────────────────────────

create table public.courses (
  id           text primary key,
  num          text not null,
  sym          text not null,
  title        text not null,
  subject      text not null,
  area         text not null check (area in ('Mathematics','Science','Coding','Languages','Humanities')),
  tags         text[] not null default '{}',
  instructor   text not null,
  role         text not null default '',
  price        integer not null check (price >= 0),
  mrp          integer not null check (mrp >= price),
  rating       numeric(2,1) not null default 0,
  reviews      text not null default '0',
  students     text not null default '0',
  lessons      integer not null default 0,
  hours        integer not null default 0,
  level        text not null check (level in ('Beginner','Intermediate','Advanced')),
  grade        text not null,
  cover        text not null,
  ink          text not null,
  pop          integer not null default 0,
  description  text not null default '',
  learn        text[] not null default '{}',
  published    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.lessons (
  id          text primary key,
  course_id   text not null references public.courses(id) on delete cascade,
  position    integer not null,
  title       text not null,
  duration    text not null,
  video_url   text,
  unique (course_id, position)
);

create table public.exams (
  id             text primary key,
  name           text not null,
  exam_date      date not null,
  meta           text not null default '',
  reg_closes_at  timestamptz
);

create table public.live_classes (
  id         text primary key,
  title      text not null,
  host       text not null,
  starts_at  timestamptz not null,
  is_live    boolean not null default false,
  watching   integer not null default 0
);

create table public.quiz_questions (
  id        bigint generated always as identity primary key,
  mock_id   text not null default 'nt-sprint',
  position  integer not null,
  question  text not null,
  options   text[] not null,
  answer    integer not null,
  unique (mock_id, position)
);

-- Coupons are never readable directly; use check_coupon().
create table public.coupons (
  code     text primary key,
  percent  integer not null check (percent between 1 and 100),
  active   boolean not null default true
);

-- ───────────────────────── Students ─────────────────────────

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  name             text not null default '',
  grade            text not null default 'Grade 10',
  goals            text[] not null default '{}',
  phone            text,
  remind_on        boolean not null default true,
  notifs_read_at   timestamptz,
  created_at       timestamptz not null default now()
);

create table public.cart_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  text not null references public.courses(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.wishlist (
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  text not null references public.courses(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  mrp_total    integer not null,
  subtotal     integer not null,
  coupon_code  text,
  coupon_off   integer not null default 0,
  total        integer not null,
  pay_method   text not null check (pay_method in ('upi','card','nb','emi')),
  -- 'paid' is set directly until a payment gateway (Razorpay) is wired in.
  status       text not null default 'paid' check (status in ('pending','paid','failed','refunded')),
  created_at   timestamptz not null default now()
);

create table public.order_items (
  order_id   uuid not null references public.orders(id) on delete cascade,
  course_id  text not null references public.courses(id),
  price      integer not null,
  mrp        integer not null,
  primary key (order_id, course_id)
);

create table public.enrollments (
  user_id         uuid not null references auth.users(id) on delete cascade,
  course_id       text not null references public.courses(id) on delete cascade,
  progress        integer not null default 0 check (progress between 0 and 100),
  current_lesson  integer not null default 0,
  enrolled_at     timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.registrations (
  user_id    uuid not null references auth.users(id) on delete cascade,
  exam_id    text not null references public.exams(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exam_id)
);

create table public.class_reminders (
  user_id   uuid not null references auth.users(id) on delete cascade,
  class_id  text not null references public.live_classes(id) on delete cascade,
  primary key (user_id, class_id)
);

create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   text not null references public.courses(id) on delete cascade,
  lesson_id   text not null references public.lessons(id) on delete cascade,
  at          text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create table public.quiz_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  mock_id     text not null,
  score       integer not null,
  total       integer not null,
  time_taken  integer not null,
  xp          integer not null,
  answers     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index on public.notes (user_id, course_id);
create index on public.quiz_attempts (user_id, created_at desc);
create index on public.orders (user_id, created_at desc);

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.courses         enable row level security;
alter table public.lessons         enable row level security;
alter table public.exams           enable row level security;
alter table public.live_classes    enable row level security;
alter table public.quiz_questions  enable row level security;
alter table public.coupons         enable row level security;
alter table public.profiles        enable row level security;
alter table public.cart_items      enable row level security;
alter table public.wishlist        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.enrollments     enable row level security;
alter table public.registrations   enable row level security;
alter table public.class_reminders enable row level security;
alter table public.notes           enable row level security;
alter table public.quiz_attempts   enable row level security;

create policy "catalog: published courses" on public.courses for select using (published);
create policy "catalog: lessons"           on public.lessons for select using (true);
create policy "catalog: exams"             on public.exams for select using (true);
create policy "catalog: live classes"      on public.live_classes for select using (true);
create policy "catalog: quiz questions"    on public.quiz_questions for select using (true);
-- coupons: no policies → not readable or writable by clients.

create policy "own profile" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

create policy "own cart" on public.cart_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own wishlist" on public.wishlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own registrations" on public.registrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders" on public.class_reminders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own notes" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own orders" on public.orders for select using (auth.uid() = user_id);
create policy "own order items" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));

-- Enrollments are created only by place_order(); students may read them and
-- move their own progress forward.
create policy "own enrollments" on public.enrollments for select using (auth.uid() = user_id);
create policy "own progress" on public.enrollments for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own attempts" on public.quiz_attempts for select using (auth.uid() = user_id);
create policy "own attempts insert" on public.quiz_attempts for insert with check (auth.uid() = user_id);

-- ───────────────────────── Functions ─────────────────────────

-- New auth user → profile row (name/grade/goals passed as signup metadata).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, grade, goals, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'grade', 'Grade 10'),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data->'goals')), '{}'),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Returns the discount percent for an active coupon, or 0.
create function public.check_coupon(p_code text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select percent from coupons where code = upper(trim(p_code)) and active), 0);
$$;

-- Prices the given courses server-side, applies the coupon, records the order
-- and enrolls the student, all in one transaction. Returns the order id.
create function public.place_order(p_course_ids text[], p_coupon text, p_pay_method text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user     uuid := auth.uid();
  v_order    uuid;
  v_mrp      integer;
  v_sub      integer;
  v_pct      integer := 0;
  v_off      integer := 0;
  v_ids      text[];
begin
  if v_user is null then raise exception 'not signed in'; end if;

  -- Only published courses the student doesn't already own.
  select array_agg(c.id), sum(c.mrp), sum(c.price)
    into v_ids, v_mrp, v_sub
  from courses c
  where c.id = any(p_course_ids) and c.published
    and not exists (select 1 from enrollments e where e.user_id = v_user and e.course_id = c.id);

  if v_ids is null then raise exception 'nothing to buy'; end if;

  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    v_pct := check_coupon(p_coupon);
    if v_pct = 0 then raise exception 'invalid coupon'; end if;
    v_off := round(v_sub * v_pct / 100.0);
  end if;

  insert into orders (user_id, mrp_total, subtotal, coupon_code, coupon_off, total, pay_method)
  values (v_user, v_mrp, v_sub, nullif(upper(trim(p_coupon)), ''), v_off, v_sub - v_off, p_pay_method)
  returning id into v_order;

  insert into order_items (order_id, course_id, price, mrp)
  select v_order, c.id, c.price, c.mrp from courses c where c.id = any(v_ids);

  insert into enrollments (user_id, course_id)
  select v_user, unnest(v_ids)
  on conflict do nothing;

  delete from cart_items where user_id = v_user and course_id = any(v_ids);

  return v_order;
end $$;

revoke all on function public.place_order(text[], text, text) from public, anon;
grant execute on function public.place_order(text[], text, text) to authenticated;
grant execute on function public.check_coupon(text) to anon, authenticated;
