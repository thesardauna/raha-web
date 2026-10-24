-- RAHA — Supabase schema
-- Run ONCE in the Supabase SQL editor on a fresh project.
--
-- Postcode format (NIPOST NDAPS): 5 segments, 11 characters, stored COMPACT and uppercase.
--   AA 99 H77 BB 55   ->  AA99H77BB55
--   state(2 letters) lga(2 digits 01-99) district(3 alnum) area(2 letters) unit(2 digits 01-99)
-- The NIPOST docs call it "12-character", but the segments add up to 11 characters.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create domain public.ng_postcode as text
  check (value ~ '^[A-Z]{2}(0[1-9]|[1-9][0-9])[A-Z0-9]{3}[A-Z]{2}(0[1-9]|[1-9][0-9])$');

create type public.user_role as enum ('customer', 'merchant', 'rider', 'admin');

create type public.order_status as enum (
  'pending', 'confirmed', 'preparing', 'ready_for_pickup',
  'out_for_delivery', 'delivered', 'cancelled'
);

create type public.delivery_status as enum (
  'awaiting_rider', 'assigned', 'picked_up', 'in_transit',
  'delivered', 'failed', 'cancelled'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- users  (profile row for every auth.users entry)
-- ---------------------------------------------------------------------------
create table public.users (
  id               uuid primary key references auth.users (id) on delete cascade,
  full_name        text,
  phone            text,
  role             public.user_role not null default 'customer',
  address          text,
  default_postcode public.ng_postcode,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Auto-create the profile on signup. Role is always 'customer';
-- promote riders/admins yourself (dashboard or service role).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------
create table public.merchants (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references public.users (id) on delete cascade,
  business_name text not null,
  description   text,
  phone         text,
  address       text,
  postcode      public.ng_postcode,          -- default pickup postcode
  lga           text,
  is_verified   boolean not null default false, -- admin approval
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants (id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric(12, 2) not null check (price >= 0),   -- NGN
  image_url    text,
  stock_qty    integer check (stock_qty is null or stock_qty >= 0),
  is_available boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_merchant_idx on public.products (merchant_id);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders  (+ order_items: an order can hold several products)
-- ---------------------------------------------------------------------------
create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.users (id),
  merchant_id    uuid not null references public.merchants (id),
  status         public.order_status not null default 'pending',
  subtotal       numeric(12, 2) not null check (subtotal >= 0),
  delivery_fee   numeric(12, 2) not null default 0 check (delivery_fee >= 0),
  total          numeric(12, 2) not null check (total >= 0),
  payment_method text not null default 'cash_on_delivery'
                   check (payment_method in ('cash_on_delivery', 'bank_transfer')),
  payment_status text not null default 'unpaid'
                   check (payment_status in ('unpaid', 'paid', 'refunded')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint orders_total_matches check (total = subtotal + delivery_fee)
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_merchant_idx on public.orders (merchant_id, status);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  product_id   uuid references public.products (id) on delete set null,
  product_name text not null,                         -- snapshot at order time
  unit_price   numeric(12, 2) not null check (unit_price >= 0),
  quantity     integer not null check (quantity > 0)
);

create index order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- deliveries
-- ---------------------------------------------------------------------------
create table public.deliveries (
  id                           uuid primary key default gen_random_uuid(),
  order_id                     uuid not null unique references public.orders (id) on delete cascade,
  rider_id                     uuid references public.users (id),
  status                       public.delivery_status not null default 'awaiting_rider',

  pickup_postcode              public.ng_postcode not null,   -- e.g. 'AA99H77BB55'
  pickup_address               text,
  destination_postcode         public.ng_postcode not null,
  destination_address          text,

  -- set by your server after /api/postcode?action=verify succeeds
  pickup_postcode_verified     boolean not null default false,
  destination_postcode_verified boolean not null default false,
  postcodes_verified_at        timestamptz,

  recipient_name               text,
  recipient_phone              text,
  distance_km                  numeric(6, 2) check (distance_km is null or distance_km >= 0),
  picked_up_at                 timestamptz,
  delivered_at                 timestamptz,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create index deliveries_rider_idx       on public.deliveries (rider_id, status);
create index deliveries_open_jobs_idx   on public.deliveries (created_at) where rider_id is null and status = 'awaiting_rider';
create index deliveries_pickup_pc_idx   on public.deliveries (pickup_postcode);
create index deliveries_dest_pc_idx     on public.deliveries (destination_postcode);

create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.users       enable row level security;
alter table public.merchants   enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.deliveries  enable row level security;

-- Helpers (security definer so policies don't recurse through RLS)
create function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = (select auth.uid()) and role = 'admin');
$$;

create function public.is_rider()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = (select auth.uid()) and role = 'rider');
$$;

create function public.owns_merchant(m uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.merchants where id = m and owner_id = (select auth.uid()));
$$;

-- Column-level limits: clients can never set role, is_verified, prices on orders, etc.
revoke insert, update, delete on public.users       from anon, authenticated;
revoke insert, update, delete on public.merchants   from anon, authenticated;
revoke insert, update, delete on public.orders      from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;
revoke insert, update, delete on public.deliveries  from anon, authenticated;

grant update (full_name, phone, address, default_postcode) on public.users to authenticated;
grant insert (owner_id, business_name, description, phone, address, postcode, lga) on public.merchants to authenticated;
grant update (business_name, description, phone, address, postcode, lga, is_active) on public.merchants to authenticated;
grant update (status) on public.orders to authenticated;                        -- merchant moves order along
grant update (status, picked_up_at, delivered_at) on public.deliveries to authenticated; -- rider progress

-- Orders, order_items and delivery creation/assignment go through server routes
-- using the service-role key (see lib/supabase-admin.ts), which bypasses RLS.
-- That is what keeps prices, totals and rider assignment tamper-proof.

-- users
create policy "users: read own or admin" on public.users
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "users: update own" on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- merchants
create policy "merchants: public sees verified, owner/admin sees own" on public.merchants
  for select to anon, authenticated
  using ((is_verified and is_active) or owner_id = (select auth.uid()) or public.is_admin());

create policy "merchants: create own" on public.merchants
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "merchants: owner updates" on public.merchants
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- products
create policy "products: public sees available items of live merchants" on public.products
  for select to anon, authenticated
  using (
    (is_available and exists (
       select 1 from public.merchants m
       where m.id = merchant_id and m.is_verified and m.is_active))
    or public.owns_merchant(merchant_id)
    or public.is_admin()
  );

create policy "products: owner inserts" on public.products
  for insert to authenticated with check (public.owns_merchant(merchant_id));

create policy "products: owner updates" on public.products
  for update to authenticated
  using (public.owns_merchant(merchant_id)) with check (public.owns_merchant(merchant_id));

create policy "products: owner deletes" on public.products
  for delete to authenticated using (public.owns_merchant(merchant_id));

-- orders
create policy "orders: customer, merchant or admin reads" on public.orders
  for select to authenticated
  using (customer_id = (select auth.uid()) or public.owns_merchant(merchant_id) or public.is_admin());

create policy "orders: merchant updates status" on public.orders
  for update to authenticated
  using (public.owns_merchant(merchant_id)) with check (public.owns_merchant(merchant_id));

-- order_items: visible whenever the parent order is visible
create policy "order_items: follow parent order" on public.order_items
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- deliveries
create policy "deliveries: customer, merchant, rider or admin reads" on public.deliveries
  for select to authenticated
  using (
    rider_id = (select auth.uid())
    or (rider_id is null and status = 'awaiting_rider' and public.is_rider())
    or public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = (select auth.uid()) or public.owns_merchant(o.merchant_id)))
  );

create policy "deliveries: assigned rider updates progress" on public.deliveries
  for update to authenticated
  using (rider_id = (select auth.uid()))
  with check (rider_id = (select auth.uid()));
