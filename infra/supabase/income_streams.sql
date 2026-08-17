-- =====================================================================
-- PICC v2.0 — Income streams & full-spectrum passive income schema.
-- Additive migration: run AFTER schema.sql (same project, SQL editor).
-- Every table is user-scoped with Row Level Security. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Financial accounts (Firefly III account tracking)
-- ---------------------------------------------------------------------
create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  firefly_account_id text,
  name text,
  type text,                -- 'asset', 'expense', 'revenue', 'liability'
  balance numeric(12,2),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_accounts_user_idx on public.financial_accounts (user_id);

-- ---------------------------------------------------------------------
-- Transactions (Firefly III / connector sync)
-- ---------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  firefly_transaction_id text,
  account_id uuid references public.financial_accounts (id) on delete set null,
  amount numeric(12,2) not null default 0,
  description text,
  category text,
  tags text[],
  transaction_date date,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_idx on public.transactions (user_id, transaction_date desc);

-- ---------------------------------------------------------------------
-- Income streams (the unified connector output model)
-- type: bandwidth | dividend | affiliate | rental | content | agent |
--       depin | staking | defi | nft | treasury | manual
-- transport: api | ws | browser  (which connector strategy produced this)
-- ---------------------------------------------------------------------
create table if not exists public.income_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text,
  type text not null,
  platform text,
  transport text not null default 'manual',  -- api | ws | browser | manual
  status text not null default 'active',
  balance numeric(12,2),
  daily_earnings numeric(12,4),
  total_earnings numeric(12,2),
  currency text not null default 'USD',
  payout_threshold numeric(12,2),
  last_collected timestamptz,
  settings jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists income_streams_user_idx on public.income_streams (user_id, updated_at desc);

-- ---------------------------------------------------------------------
-- NFT holdings (marketplace sync: OpenSea, Magic Eden, Rarible)
-- ---------------------------------------------------------------------
create table if not exists public.nft_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  collection_name text,
  token_id text,
  contract_address text,
  blockchain text,                 -- 'Ethereum', 'Solana', 'Polygon'
  purchase_price numeric(24,8),
  current_floor_price numeric(24,8),
  royalty_percentage numeric(5,2),
  total_royalties_earned numeric(24,8),
  is_listed boolean not null default false,
  listing_price numeric(24,8),
  listed_on text,                  -- 'OpenSea', 'Magic Eden', 'Rarible'
  source_stream_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nft_holdings_user_idx on public.nft_holdings (user_id);

-- ---------------------------------------------------------------------
-- NFT royalty earnings
-- ---------------------------------------------------------------------
create table if not exists public.nft_royalty_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  nft_id uuid references public.nft_holdings (id) on delete cascade,
  sale_amount numeric(24,8),
  royalty_amount numeric(24,8),
  royalty_percentage numeric(5,2),
  buyer_address text,
  transaction_hash text,
  sale_date timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists nft_royalty_earnings_user_idx on public.nft_royalty_earnings (user_id);

-- ---------------------------------------------------------------------
-- DePIN nodes (bandwidth / storage / compute / environmental / energy)
-- ---------------------------------------------------------------------
create table if not exists public.depin_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  node_type text,                  -- 'bandwidth', 'storage', 'compute', 'environmental', 'energy'
  platform text,                  -- 'Honeygain', 'EarnApp', 'Grass', 'Gradient', ...
  node_id text,
  status text not null default 'active',
  daily_earnings numeric(12,4),
  total_earnings numeric(12,4),
  device_info jsonb not null default '{}'::jsonb,
  source_stream_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists depin_nodes_user_idx on public.depin_nodes (user_id);

-- ---------------------------------------------------------------------
-- Agent configs (CrewAI microservice sync)
-- ---------------------------------------------------------------------
create table if not exists public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text,
  type text,                      -- 'researcher', 'analyst', 'content_creator', 'trader',
                                  -- 'nft_flipper', 'defi_optimizer', 'staker', 'freelance_agent',
                                  -- 'bounty_hunter', 'depin_optimizer', 'content_strategist'
  model text,
  system_prompt text,
  tools text[],
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_configs_user_idx on public.agent_configs (user_id);

-- ---------------------------------------------------------------------
-- Agent earnings (per-agent income attribution)
-- ---------------------------------------------------------------------
create table if not exists public.agent_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  agent_id uuid references public.agent_configs (id) on delete cascade,
  earnings_source text,           -- 'content_sales', 'trading_profits', 'nft_flips',
                                  -- 'defi_yield', 'bounties', 'freelance'
  amount numeric(24,8),
  currency text not null default 'USD',
  description text,
  transaction_hash text,
  created_at timestamptz not null default now()
);

create index if not exists agent_earnings_user_idx on public.agent_earnings (user_id);

-- ---------------------------------------------------------------------
-- Agent bounties (AIGEN protocol sync)
-- ---------------------------------------------------------------------
create table if not exists public.agent_bounties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  aigen_mission_id text,
  title text,
  description text,
  reward_amount numeric(24,8),
  reward_currency text,           -- 'USDC', 'ETH', 'AIGEN'
  reward_chain text,              -- 'base', 'optimism'
  verification_type text,         -- 'peer_vote', 'first_valid_match', 'creator_judges'
  deadline_hours integer,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_bounties_user_idx on public.agent_bounties (user_id, status);

-- ---------------------------------------------------------------------
-- Predictions (ARIMA / Prophet / XGBoost / LSTM / GRU / ensemble)
-- ---------------------------------------------------------------------
create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  symbol text,
  model_type text,                -- 'arima', 'prophet', 'xgboost', 'lstm', 'gru', 'ensemble'
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
-- Human review logs (compliance — every AI suggestion + user decision)
-- ---------------------------------------------------------------------
create table if not exists public.human_review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  action_type text,               -- 'copy_suggestion', 'execute_trade', 'publish_content',
                                  -- 'deploy_node', 'stake_crypto'
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

drop policy if exists "Users can view own financial accounts" on public.financial_accounts;
create policy "Users can view own financial accounts" on public.financial_accounts for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own financial accounts" on public.financial_accounts;
create policy "Users can manage own financial accounts" on public.financial_accounts for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own transactions" on public.transactions;
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own transactions" on public.transactions;
create policy "Users can manage own transactions" on public.transactions for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own income streams" on public.income_streams;
create policy "Users can view own income streams" on public.income_streams for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own income streams" on public.income_streams;
create policy "Users can manage own income streams" on public.income_streams for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own nft holdings" on public.nft_holdings;
create policy "Users can view own nft holdings" on public.nft_holdings for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own nft holdings" on public.nft_holdings;
create policy "Users can manage own nft holdings" on public.nft_holdings for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own nft royalty earnings" on public.nft_royalty_earnings;
create policy "Users can view own nft royalty earnings" on public.nft_royalty_earnings for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own nft royalty earnings" on public.nft_royalty_earnings;
create policy "Users can manage own nft royalty earnings" on public.nft_royalty_earnings for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own depin nodes" on public.depin_nodes;
create policy "Users can view own depin nodes" on public.depin_nodes for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own depin nodes" on public.depin_nodes;
create policy "Users can manage own depin nodes" on public.depin_nodes for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own agent configs" on public.agent_configs;
create policy "Users can view own agent configs" on public.agent_configs for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own agent configs" on public.agent_configs;
create policy "Users can manage own agent configs" on public.agent_configs for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own agent earnings" on public.agent_earnings;
create policy "Users can view own agent earnings" on public.agent_earnings for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own agent earnings" on public.agent_earnings;
create policy "Users can manage own agent earnings" on public.agent_earnings for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own agent bounties" on public.agent_bounties;
create policy "Users can view own agent bounties" on public.agent_bounties for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own agent bounties" on public.agent_bounties;
create policy "Users can manage own agent bounties" on public.agent_bounties for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own predictions" on public.predictions;
create policy "Users can view own predictions" on public.predictions for select using (auth.uid() = user_id);
drop policy if exists "Users can manage own predictions" on public.predictions;
create policy "Users can manage own predictions" on public.predictions for all with check (auth.uid() = user_id);

drop policy if exists "Users can view own human review logs" on public.human_review_logs;
create policy "Users can view own human review logs" on public.human_review_logs for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own human review logs" on public.human_review_logs;
create policy "Users can insert own human review logs" on public.human_review_logs for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------
drop trigger if exists financial_accounts_set_updated_at on public.financial_accounts;
create trigger financial_accounts_set_updated_at before update on public.financial_accounts
for each row execute function public.set_updated_at();

drop trigger if exists income_streams_set_updated_at on public.income_streams;
create trigger income_streams_set_updated_at before update on public.income_streams
for each row execute function public.set_updated_at();

drop trigger if exists nft_holdings_set_updated_at on public.nft_holdings;
create trigger nft_holdings_set_updated_at before update on public.nft_holdings
for each row execute function public.set_updated_at();

drop trigger if exists depin_nodes_set_updated_at on public.depin_nodes;
create trigger depin_nodes_set_updated_at before update on public.depin_nodes
for each row execute function public.set_updated_at();

drop trigger if exists agent_configs_set_updated_at on public.agent_configs;
create trigger agent_configs_set_updated_at before update on public.agent_configs
for each row execute function public.set_updated_at();

drop trigger if exists agent_bounties_set_updated_at on public.agent_bounties;
create trigger agent_bounties_set_updated_at before update on public.agent_bounties
for each row execute function public.set_updated_at();
