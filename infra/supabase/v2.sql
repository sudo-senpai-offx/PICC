-- =====================================================================
-- PICC (Passive Income Command Center) — Supabase schema v2.0
-- Run AFTER schema.sql in the Supabase SQL editor.
-- Extends the v1 tables with the income-classification model: financial
-- accounts, transactions, income streams, NFT holdings/royalties, DePIN
-- nodes, agent configs/earnings/bounties, predictions and human review
-- logs. All tables are user-scoped with Row Level Security.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Financial accounts (Firefly III sync / manual tracking)
-- ---------------------------------------------------------------------
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  firefly_account_id text,
  name text,
  type text check (type in ('asset', 'expense', 'revenue', 'liability')),
  balance numeric(12,2),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_accounts_user_idx on public.financial_accounts (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Transactions (sync with Firefly III)
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  firefly_transaction_id text,
  account_id uuid references public.financial_accounts (id) on delete set null,
  amount numeric(12,2),
  description text,
  category text,
  tags text[] not null default '{}',
  transaction_date date,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id, transaction_date desc);
create index if not exists transactions_account_idx on public.transactions (account_id);

-- ---------------------------------------------------------------------
-- Income streams (IGM / Money4Band / CashPilot / manual)
-- ---------------------------------------------------------------------
create table if not exists public.income_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text,
  type text check (type in ('bandwidth', 'dividend', 'affiliate', 'rental', 'content', 'agent', 'depin', 'staking', 'defi', 'nft')),
  platform text,
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  daily_earnings numeric(10,4),
  total_earnings numeric(12,2),
  last_collected timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists income_streams_user_idx on public.income_streams (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- NFT holdings
-- ---------------------------------------------------------------------
create table if not exists public.nft_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  collection_name text,
  token_id text,
  contract_address text,
  blockchain text check (blockchain in ('Ethereum', 'Solana', 'Polygon')),
  purchase_price numeric(24,8),
  current_floor_price numeric(24,8),
  royalty_percentage numeric(5,2),
  total_royalties_earned numeric(24,8),
  is_listed boolean not null default false,
  listing_price numeric(24,8),
  listed_on text check (listed_on in ('OpenSea', 'Magic Eden', 'Rarible')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nft_holdings_user_idx on public.nft_holdings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- NFT royalty earnings
-- ---------------------------------------------------------------------
create table if not exists public.nft_royalty_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  nft_id uuid references public.nft_holdings (id) on delete set null,
  sale_amount numeric(24,8),
  royalty_amount numeric(24,8),
  royalty_percentage numeric(5,2),
  buyer_address text,
  transaction_hash text,
  sale_date timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists nft_royalty_earnings_user_idx on public.nft_royalty_earnings (user_id, sale_date desc);

-- ---------------------------------------------------------------------
-- DePIN nodes
-- ---------------------------------------------------------------------
create table if not exists public.depin_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  node_type text check (node_type in ('bandwidth', 'storage', 'compute', 'environmental', 'energy')),
  platform text check (platform in (
    'Honeygain', 'EarnApp', 'DeNet', 'Silencio', 'COIN', 'GridLink',
    'OpenLoop', 'Hivello', 'Grass', 'Gradient', 'ProjectSolarMining'
  )),
  node_id text,
  status text not null default 'active' check (status in ('active', 'offline', 'paused', 'retired')),
  daily_earnings numeric(12,4),
  total_earnings numeric(12,4),
  device_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists depin_nodes_user_idx on public.depin_nodes (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- AI agent configurations
-- ---------------------------------------------------------------------
create table if not exists public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text,
  type text check (type in (
    'researcher', 'analyst', 'content_creator', 'trader', 'nft_flipper',
    'defi_optimizer', 'staker', 'freelance_agent', 'bounty_hunter', 'depin_optimizer'
  )),
  model text,
  system_prompt text,
  tools text[] not null default '{}',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_configs_user_idx on public.agent_configs (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Agent earnings
-- ---------------------------------------------------------------------
create table if not exists public.agent_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  agent_id uuid references public.agent_configs (id) on delete set null,
  earnings_source text check (earnings_source in (
    'content_sales', 'trading_profits', 'nft_flips', 'defi_yield', 'bounties', 'freelance'
  )),
  amount numeric(24,8),
  currency text not null default 'USD',
  description text,
  transaction_hash text,
  created_at timestamptz not null default now()
);

create index if not exists agent_earnings_user_idx on public.agent_earnings (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Agent bounties (AIGEN protocol integration)
-- ---------------------------------------------------------------------
create table if not exists public.agent_bounties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  aigen_mission_id text,
  title text,
  description text,
  reward_amount numeric(24,8),
  reward_currency text not null default 'USDC' check (reward_currency in ('USDC', 'ETH', 'AIGEN')),
  reward_chain text check (reward_chain in ('base', 'optimism')),
  verification_type text check (verification_type in ('peer_vote', 'first_valid_match', 'creator_judges')),
  deadline_hours integer,
  status text not null default 'open' check (status in ('open', 'funded', 'in_progress', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_bounties_user_idx on public.agent_bounties (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Predictions (DeepSeek-style model outputs + resolution accuracy)
-- ---------------------------------------------------------------------
create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  symbol text,
  model_type text check (model_type in ('arima', 'prophet', 'xgboost', 'lstm', 'gru', 'ensemble')),
  prediction_date date,
  predicted_value numeric(12,4),
  confidence_lower numeric(12,4),
  confidence_upper numeric(12,4),
  actual_value numeric(12,4),
  accuracy numeric(5,2),
  created_at timestamptz not null default now()
);

create index if not exists predictions_user_idx on public.predictions (user_id, prediction_date desc);

-- ---------------------------------------------------------------------
-- Human review logs (compliance audit trail)
-- ---------------------------------------------------------------------
create table if not exists public.human_review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  action_type text check (action_type in (
    'copy_suggestion', 'execute_trade', 'publish_content', 'deploy_node', 'stake_crypto'
  )),
  ai_suggestion jsonb not null default '{}'::jsonb,
  user_decision text,
  review_timer_seconds integer,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists human_review_logs_user_idx on public.human_review_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.financial_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.income_streams enable row level security;
alter table public.nft_holdings enable row level security;
alter table public.nft_royalty_earnings enable row level security;
alter table public.depin_nodes enable row level security;
alter table public.agent_configs enable row level security;
alter table public.agent_earnings enable row level security;
alter table public.agent_bounties enable row level security;
alter table public.predictions enable row level security;
alter table public.human_review_logs enable row level security;

-- ---------------------------------------------------------------------
-- Policies (users only access own rows)
-- ---------------------------------------------------------------------
create policy "Users can manage own financial accounts" on public.financial_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own income streams" on public.income_streams
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own nft holdings" on public.nft_holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own nft royalty earnings" on public.nft_royalty_earnings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own depin nodes" on public.depin_nodes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own agent configs" on public.agent_configs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own agent earnings" on public.agent_earnings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own agent bounties" on public.agent_bounties
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own predictions" on public.predictions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can manage own human review logs" on public.human_review_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Updated-at triggers (reuse public.set_updated_at from schema.sql)
-- ---------------------------------------------------------------------
create trigger financial_accounts_set_updated_at before update on public.financial_accounts
  for each row execute function public.set_updated_at();
create trigger income_streams_set_updated_at before update on public.income_streams
  for each row execute function public.set_updated_at();
create trigger nft_holdings_set_updated_at before update on public.nft_holdings
  for each row execute function public.set_updated_at();
create trigger depin_nodes_set_updated_at before update on public.depin_nodes
  for each row execute function public.set_updated_at();
create trigger agent_configs_set_updated_at before update on public.agent_configs
  for each row execute function public.set_updated_at();
create trigger agent_bounties_set_updated_at before update on public.agent_bounties
  for each row execute function public.set_updated_at();
