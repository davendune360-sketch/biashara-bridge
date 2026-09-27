create extension if not exists pgcrypto;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  owner_name text not null,
  phone text default '',
  photo_url text default '',
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  phone text default '',
  email text default '',
  area text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  category text default 'Other',
  sku text default '',
  unit text default 'piece',
  variants text default '',
  price numeric(12,2) not null default 0,
  stock integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text not null,
  phone text default '',
  item text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  amount numeric(12,2) not null default 0,
  specs text default '',
  notes text default '',
  channel text not null default 'WhatsApp',
  sale_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'paid', 'preparing', 'delivered')),
  mpesa text default '',
  created_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;

create policy "owners manage their businesses" on public.businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owners manage their customers" on public.customers
  for all using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "owners manage their products" on public.products
  for all using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create policy "owners manage their orders" on public.orders
  for all using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

create index customers_business_id_idx on public.customers(business_id);
create index products_business_id_idx on public.products(business_id);
create index orders_business_id_idx on public.orders(business_id);
create index orders_sale_date_idx on public.orders(sale_date desc);
