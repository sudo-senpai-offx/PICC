// Local-first finance layer: accounts + transactions persisted through the
// self-hosted /api/data/* store (financial_accounts / transactions tables —
// already defined server-side with RLS-equivalent per-user rows).
//
// PICC_FULL_SCOPE Part 2a: replaces the old localStorage read-only stub.
// Running balance per account = starting balance + sum(transactions.amount).
// Net worth is computed, never manually snapshotted.
import { appendData, listData, removeData, upsertData } from "./localdata"

export type AccountType = "asset" | "expense" | "revenue" | "liability"

export interface FinancialAccount {
  id: string
  name: string
  type: AccountType
  /** Starting balance in the account's own currency. Running balance = this + sum(transactions). */
  balance: number
  currency: string
  /** True for the auto-created trading-suite account, whose balance is kept in sync with the paper engine. */
  synced?: boolean
  note?: string
  firefly_account_id?: string
  created_at?: string
  user_id?: string | null
}

export interface FinanceTransaction {
  id: string
  account_id: string
  amount: number
  description: string
  category?: string
  tags?: string
  /** YYYY-MM-DD */
  transaction_date: string
  firefly_transaction_id?: string
  created_at?: string
  user_id?: string | null
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ── Accounts ────────────────────────────────────────────────────────────────

export async function listAccounts(): Promise<FinancialAccount[]> {
  const res = await listData<FinancialAccount>("financial_accounts")
  return res.rows
}

export async function createAccount(
  input: Omit<FinancialAccount, "id" | "created_at" | "user_id">
): Promise<FinancialAccount> {
  const res = await appendData<FinancialAccount>("financial_accounts", input)
  return res.row
}

export async function updateAccount(account: FinancialAccount): Promise<FinancialAccount> {
  const res = await upsertData<FinancialAccount>("financial_accounts", account)
  return res.row
}

/** Delete an account and its transactions (the server has no cascades). */
export async function deleteAccount(id: string): Promise<void> {
  await removeData("financial_accounts", id)
  const txs = await listTransactions()
  await Promise.all(
    txs.filter((t) => t.account_id === id).map((t) => removeData("transactions", t.id))
  )
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function listTransactions(): Promise<FinanceTransaction[]> {
  const res = await listData<FinanceTransaction>("transactions")
  return res.rows
}

export async function createTransaction(
  input: Omit<FinanceTransaction, "id" | "created_at" | "user_id">
): Promise<FinanceTransaction> {
  const res = await appendData<FinanceTransaction>("transactions", input)
  return res.row
}

export async function updateTransaction(tx: FinanceTransaction): Promise<FinanceTransaction> {
  const res = await upsertData<FinanceTransaction>("transactions", tx)
  return res.row
}

export async function deleteTransaction(id: string): Promise<void> {
  await removeData("transactions", id)
}

// ── Computed values ─────────────────────────────────────────────────────────

export function runningBalance(account: FinancialAccount, transactions: FinanceTransaction[]): number {
  const sum = transactions
    .filter((t) => t.account_id === account.id)
    .reduce((acc, t) => acc + (Number(t.amount) || 0), 0)
  return (Number(account.balance) || 0) + sum
}

/**
 * Net worth is computed, never manually entered: assets minus liabilities
 * (PICC_FULL_SCOPE Part 2a). Balances are stored signed — a liability is
 * entered as the amount owed with a negative sign (the ledger convention), so
 * net worth is simply the sum of the asset and liability accounts' running
 * balances. Revenue/expense are flow accounts and are excluded. Returns
 * per-currency totals plus a USD-converted total via fixed approximate rates
 * (v1 — no live FX).
 */
export function netWorthTotals(
  accounts: FinancialAccount[],
  transactions: FinanceTransaction[]
): { byCurrency: Record<string, number>; usdTotal: number } {
  const byCurrency: Record<string, number> = {}
  for (const a of accounts) {
    if (a.type !== "asset" && a.type !== "liability") continue
    const bal = runningBalance(a, transactions)
    const cur = a.currency || "USD"
    byCurrency[cur] = (byCurrency[cur] ?? 0) + bal
  }
  return { byCurrency, usdTotal: convertToUsd(byCurrency) }
}

// Fixed approximate mid-market rates for the single net-worth number (v1 per
// spec: don't over-build FX). Not live quotes — labelled as such in the UI.
const FIXED_FX: Record<string, number> = {
  USD: 1,
  MYR: 0.215,
  EUR: 1.09,
  GBP: 1.27,
  SGD: 0.74,
  AUD: 0.66,
  JPY: 0.0067,
  CNY: 0.14,
  THB: 0.028,
  IDR: 0.000064
}

export function convertToUsd(byCurrency: Record<string, number>): number {
  return Object.entries(byCurrency).reduce(
    (acc, [cur, amt]) => acc + amt * (FIXED_FX[cur] ?? 0),
    0
  )
}

export function formatMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(n)
}

// ── Trading-suite bridge ────────────────────────────────────────────────────

/** Marker for the auto-created account that mirrors the paper engine's cash. */
export const TRADING_ACCOUNT_SYNCED_FLAG = true

/**
 * Wire the trading suite in as one real account (Part 2a): auto-create a
 * synced asset account if none exists, then keep its balance equal to the
 * paper engine's live cash. The account is marked `synced` so the UI shows
 * it as live and never lets manual edits fight the next sync.
 */
export async function syncTradingAccount(
  accounts: FinancialAccount[],
  cash: number | null
): Promise<FinancialAccount[]> {
  if (cash == null) return accounts
  const trading = accounts.find((a) => a.synced === TRADING_ACCOUNT_SYNCED_FLAG)
  if (trading) {
    if (trading.balance !== cash) {
      await updateAccount({ ...trading, balance: cash })
      return accounts.map((a) => (a.id === trading.id ? { ...a, balance: cash } : a))
    }
    return accounts
  }
  const created = await createAccount({
    name: "Paper trading",
    type: "asset",
    balance: cash,
    currency: "USD",
    synced: TRADING_ACCOUNT_SYNCED_FLAG,
    note: "Auto-synced from the trading suite — balance tracks the paper engine's live cash."
  })
  return [...accounts, created]
}