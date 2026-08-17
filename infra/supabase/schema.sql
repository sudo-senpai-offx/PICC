-- =====================================================================
-- PICC (Passive Income Command Center) — Supabase schema
-- Run this in the Supabase SQL editor once per project.
-- All tables are user-scoped with Row Level Security.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profiles (extends auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid references auth.users (id) on delete cascade primary key,
  email text,
  full_name text,
  subscription_tier text not null default 'free' check (subscription_tier in ('free', 'pro', 'business')),
  subscription_status text not null default 'active' check (subscription_status in ('active', 'trialing', 'past_due', 'canceled')),
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Simulations (Financial Twin, dropshipping, YouTube/blog projections)
-- ---------------------------------------------------------------------
create table if not exists public.simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('stock', 'reit', 'bonds', 'dropshipping', 'youtube', 'blogging')),
  name text,
  parameters jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists simulations_user_idx on public.simulations (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Agent logs (every AI suggestion + every human confirmation)
-- ---------------------------------------------------------------------
create table if not exists public.agent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  agent_name text,
  action text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_logs_user_idx on public.agent_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Human confirmations (audit trail for the mandatory human-review gate)
-- ---------------------------------------------------------------------
create table if not exists public.human_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  surface text not null,               -- 'extension.amazon', 'content_studio', 'financial_twin', ...
  suggestion_id text,
  acknowledged boolean not null default true,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists human_confirmations_user_idx on public.human_confirmations (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Overlay settings (syncs with the browser extension popup)
-- ---------------------------------------------------------------------
create table if not exists public.overlay_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  platforms jsonb not null default '{"amazon": true, "youtube": true, "brokerage": true}'::jsonb,
  auto_suggest boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Content drafts (Content Studio output)
-- ---------------------------------------------------------------------
create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('blog', 'youtube_script', 'affiliate_review', 'social')),
  topic text not null,
  draft jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_drafts_user_idx on public.content_drafts (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Listing analyses (Listing Optimizer output, read-only Amazon data)
-- ---------------------------------------------------------------------
create table if not exists public.listing_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  asin text,
  product_name text,
  suggestions jsonb not null default '[]'::jsonb,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists listing_analyses_user_idx on public.listing_analyses (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Crypto holdings (staking/earn positions tracked as income streams)
-- ---------------------------------------------------------------------
create table if not exists public.crypto_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  asset_symbol text,          -- 'ETH', 'SOL', 'ADA', 'USDT'
  asset_name text,
  wallet_address text,
  balance numeric(24,8),
  staked_amount numeric(24,8),
  staking_apy numeric(5,2),
  staking_platform text,      -- 'Lido', 'Jito', 'Luno', 'MX Global'
  liquid_staking_token text,  -- 'stETH', 'JitoSOL', 'ksETH'
  source_stream_id uuid,      -- optional link to an IncomeStream
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crypto_holdings_user_idx on public.crypto_holdings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- DeFi positions (lending / yield farming / liquidity providing)
-- ---------------------------------------------------------------------
create table if not exists public.defi_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  protocol text,              -- 'Aave', 'Compound', 'Pendle', 'Yearn'
  asset_symbol text,
  amount numeric(24,8),
  apy numeric(5,2),
  position_type text check (position_type in ('lending', 'yield_farming', 'liquidity_providing')),
  contract_address text,
  source_stream_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists defi_positions_user_idx on public.defi_positions (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Trading signals (Trading Suite output / n8n trading-signal workflow)
-- direction: up | down | neutral (decision-support only)
-- models: momentum + mean-reversion + regression votes used to derive confidence
-- ---------------------------------------------------------------------
create table if not exists public.trading_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  asset text not null,            -- 'BTC-USD', 'EUR/USD', 'ETH-USD'
  price numeric(24,8),
  direction text not null check (direction in ('up', 'down', 'neutral')),
  confidence numeric(5,4),        -- 0..1, honest backtest-damped confidence
  horizon text,                   -- '5m', '1m', '1h', ...
  models jsonb not null default '{}'::jsonb,
  commentary text,
  source text not null default 'engine' check (source in ('engine', 'n8n')),
  created_at timestamptz not null default now()
);

create index if not exists trading_signals_user_idx on public.trading_signals (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- DeFi holdings (staking/yield monitor snapshots / n8n staking-monitor)
-- metadata: normalized opportunity list, analysis: AI yield+risk summary
-- ---------------------------------------------------------------------
create table if not exists public.defi_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'staking' check (type in ('staking', 'lending', 'yield_farming', 'liquidity_providing')),
  name text,
  metadata jsonb not null default '{}'::jsonb,
  analysis text,
  source_stream_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists defi_holdings_user_idx on public.defi_holdings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- DePIN holdings (DePIN market snapshots / n8n depin-aggregator)
-- ---------------------------------------------------------------------
create table if not exists public.depin_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'depin',
  name text,
  metadata jsonb not null default '{}'::jsonb,
  analysis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists depin_holdings_user_idx on public.depin_holdings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Payment orders (PayPal, manual e-wallets, BTCPay — no bank needed)
-- provider: paypal | ewallet_gcash | ewallet_maya | ewallet_tng | btcpay
-- status: awaiting_payment | submitted | granted | failed
-- reference: PayPal order id / e-wallet PICC-XXXX code / BTCPay invoice id
-- confirm_ref: PayPal capture id / e-wallet confirmation code / BTCPay invoice id
-- ---------------------------------------------------------------------
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  tier text not null check (tier in ('pro', 'business')),
  amount numeric,
  currency text,
  reference text,
  confirm_ref text,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'submitted', 'granted', 'failed')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.simulations enable row level security;
alter table public.agent_logs enable row level security;
alter table public.human_confirmations enable row level security;
alter table public.overlay_settings enable row level security;
alter table public.content_drafts enable row level security;
alter table public.listing_analyses enable row level security;
alter table public.payment_orders enable row level security;
alter table public.crypto_holdings enable row level security;
alter table public.defi_positions enable row level security;
alter table public.trading_signals enable row level security;
alter table public.defi_holdings enable row level security;
alter table public.depin_holdings enable row level security;

-- Profiles
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Simulations
drop policy if exists "Users can view own simulations" on public.simulations;
create policy "Users can view own simulations" on public.simulations for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own simulations" on public.simulations;
create policy "Users can insert own simulations" on public.simulations for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own simulations" on public.simulations;
create policy "Users can delete own simulations" on public.simulations for delete using (auth.uid() = user_id);

-- Agent logs
drop policy if exists "Users can view own agent logs" on public.agent_logs;
create policy "Users can view own agent logs" on public.agent_logs for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own agent logs" on public.agent_logs;
create policy "Users can insert own agent logs" on public.agent_logs for insert with check (auth.uid() = user_id);

-- Human confirmations
drop policy if exists "Users can view own confirmations" on public.human_confirmations;
create policy "Users can view own confirmations" on public.human_confirmations for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own confirmations" on public.human_confirmations;
create policy "Users can insert own confirmations" on public.human_confirmations for insert with check (auth.uid() = user_id);

-- Overlay settings
drop policy if exists "Users can view own overlay settings" on public.overlay_settings;
create policy "Users can view own overlay settings" on public.overlay_settings for select using (auth.uid() = user_id);
drop policy if exists "Users can upsert own overlay settings" on public.overlay_settings;
create policy "Users can upsert own overlay settings" on public.overlay_settings for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own overlay settings" on public.overlay_settings;
create policy "Users can update own overlay settings" on public.overlay_settings for update using (auth.uid() = user_id);

-- Content drafts
drop policy if exists "Users can view own content drafts" on public.content_drafts;
create policy "Users can view own content drafts" on public.content_drafts for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own content drafts" on public.content_drafts;
create policy "Users can insert own content drafts" on public.content_drafts for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own content drafts" on public.content_drafts;
create policy "Users can update own content drafts" on public.content_drafts for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own content drafts" on public.content_drafts;
create policy "Users can delete own content drafts" on public.content_drafts for delete using (auth.uid() = user_id);

-- Listing analyses
drop policy if exists "Users can view own listing analyses" on public.listing_analyses;
create policy "Users can view own listing analyses" on public.listing_analyses for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own listing analyses" on public.listing_analyses;
create policy "Users can insert own listing analyses" on public.listing_analyses for insert with check (auth.uid() = user_id);

-- Payment orders
drop policy if exists "Users can view own payment orders" on public.payment_orders;
create policy "Users can view own payment orders" on public.payment_orders for select using (auth.uid() = user_id);

-- Crypto holdings
drop policy if exists "Users can view own crypto holdings" on public.crypto_holdings;
create policy "Users can view own crypto holdings" on public.crypto_holdings for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own crypto holdings" on public.crypto_holdings;
create policy "Users can insert own crypto holdings" on public.crypto_holdings for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own crypto holdings" on public.crypto_holdings;
create policy "Users can update own crypto holdings" on public.crypto_holdings for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own crypto holdings" on public.crypto_holdings;
create policy "Users can delete own crypto holdings" on public.crypto_holdings for delete using (auth.uid() = user_id);

-- DeFi positions
drop policy if exists "Users can view own defi positions" on public.defi_positions;
create policy "Users can view own defi positions" on public.defi_positions for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own defi positions" on public.defi_positions;
create policy "Users can insert own defi positions" on public.defi_positions for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own defi positions" on public.defi_positions;
create policy "Users can update own defi positions" on public.defi_positions for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own defi positions" on public.defi_positions;
create policy "Users can delete own defi positions" on public.defi_positions for delete using (auth.uid() = user_id);

-- Trading signals
drop policy if exists "Users can view own trading signals" on public.trading_signals;
create policy "Users can view own trading signals" on public.trading_signals for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own trading signals" on public.trading_signals;
create policy "Users can insert own trading signals" on public.trading_signals for insert with check (auth.uid() = user_id);
drop policy if exists "Users can delete own trading signals" on public.trading_signals;
create policy "Users can delete own trading signals" on public.trading_signals for delete using (auth.uid() = user_id);

-- DeFi holdings
drop policy if exists "Users can view own defi holdings" on public.defi_holdings;
create policy "Users can view own defi holdings" on public.defi_holdings for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own defi holdings" on public.defi_holdings;
create policy "Users can insert own defi holdings" on public.defi_holdings for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own defi holdings" on public.defi_holdings;
create policy "Users can update own defi holdings" on public.defi_holdings for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own defi holdings" on public.defi_holdings;
create policy "Users can delete own defi holdings" on public.defi_holdings for delete using (auth.uid() = user_id);

-- DePIN holdings
drop policy if exists "Users can view own depin holdings" on public.depin_holdings;
create policy "Users can view own depin holdings" on public.depin_holdings for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own depin holdings" on public.depin_holdings;
create policy "Users can insert own depin holdings" on public.depin_holdings for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own depin holdings" on public.depin_holdings;
create policy "Users can update own depin holdings" on public.depin_holdings for update using (auth.uid() = user_id);
drop policy if exists "Users can delete own depin holdings" on public.depin_holdings;
create policy "Users can delete own depin holdings" on public.depin_holdings for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Updated-at trigger helper
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists overlay_settings_set_updated_at on public.overlay_settings;
create trigger overlay_settings_set_updated_at before update on public.overlay_settings
for each row execute function public.set_updated_at();

drop trigger if exists content_drafts_set_updated_at on public.content_drafts;
create trigger content_drafts_set_updated_at before update on public.content_drafts
for each row execute function public.set_updated_at();

drop trigger if exists payment_orders_set_updated_at on public.payment_orders;
create trigger payment_orders_set_updated_at before update on public.payment_orders
for each row execute function public.set_updated_at();

drop trigger if exists crypto_holdings_set_updated_at on public.crypto_holdings;
create trigger crypto_holdings_set_updated_at before update on public.crypto_holdings
for each row execute function public.set_updated_at();

drop trigger if exists defi_positions_set_updated_at on public.defi_positions;
create trigger defi_positions_set_updated_at before update on public.defi_positions
for each row execute function public.set_updated_at();

drop trigger if exists defi_holdings_set_updated_at on public.defi_holdings;
create trigger defi_holdings_set_updated_at before update on public.defi_holdings
for each row execute function public.set_updated_at();

drop trigger if exists depin_holdings_set_updated_at on public.depin_holdings;
create trigger depin_holdings_set_updated_at before update on public.depin_holdings
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Auto-create profile + overlay settings on signup
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.overlay_settings (user_id)
  values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
