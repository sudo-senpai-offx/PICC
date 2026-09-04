// @vitest-environment jsdom
// PICC_FULL_SCOPE Part 2a — finance tracker layer over /api/data/*.
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  convertToUsd,
  createAccount,
  createTransaction,
  deleteAccount,
  deleteTransaction,
  formatMoney,
  listAccounts,
  listTransactions,
  netWorthTotals,
  runningBalance,
  syncTradingAccount,
  updateAccount,
  updateTransaction,
  type FinanceTransaction,
  type FinancialAccount
} from "../finance"

const ACC_RE = /\/api\/data\/financial_accounts(\/upsert|\/remove)?$/
const TX_RE = /\/api\/data\/transactions(\/upsert|\/remove)?$/

function fetchMock(rows: Record<string, unknown[]> = {}, posted: unknown[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url)
    const postedRow = init?.body ? (JSON.parse(String(init.body)) as { row?: unknown; id?: string }).row : undefined
    const postedId = init?.body ? (JSON.parse(String(init.body)) as { id?: string }).id : undefined
    if (ACC_RE.test(u) && !u.endsWith("/remove")) {
      if (postedRow) {
        posted.push({ table: "financial_accounts", row: postedRow })
        const row = { id: "gen-" + posted.length, created_at: new Date().toISOString(), user_id: null, ...(postedRow as object) }
        rows.financial_accounts = [...(rows.financial_accounts ?? []), row]
        return { ok: true, json: async () => ({ ok: true, row }) } as Response
      }
      if (u.endsWith("/upsert")) {
        const id = (postedRow as { id: string }).id
        const row = { created_at: new Date().toISOString(), user_id: null, ...(postedRow as object) }
        rows.financial_accounts = [...(rows.financial_accounts ?? []).filter((r) => (r as { id: string }).id !== id), row]
        return { ok: true, json: async () => ({ ok: true, row }) } as Response
      }
      return { ok: true, json: async () => ({ ok: true, rows: rows.financial_accounts ?? [] }) } as Response
    }
    if (u.endsWith("/remove")) {
      const table = u.includes("financial_accounts") ? "financial_accounts" : "transactions"
      rows[table] = (rows[table] ?? []).filter((r) => (r as { id: string }).id !== postedId)
      return { ok: true, json: async () => ({ ok: true, removed: true }) } as Response
    }
    if (TX_RE.test(u)) {
      if (postedRow) {
        const row = { id: "tx-" + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), user_id: null, ...(postedRow as object) }
        rows.transactions = [...(rows.transactions ?? []), row]
        return { ok: true, json: async () => ({ ok: true, row }) } as Response
      }
      if (u.endsWith("/upsert")) {
        const row = { created_at: new Date().toISOString(), user_id: null, ...(postedRow as object) }
        rows.transactions = [...(rows.transactions ?? []).filter((r) => (r as { id: string }).id !== (postedRow as { id: string }).id), row]
        return { ok: true, json: async () => ({ ok: true, row }) } as Response
      }
      return { ok: true, json: async () => ({ ok: true, rows: rows.transactions ?? [] }) } as Response
    }
    return { ok: true, json: async () => ({ ok: true, rows: [] }) } as Response
  })
}

function acct(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return { id: "a1", name: "Savings", type: "asset", balance: 100, currency: "USD", ...overrides }
}

function tx(overrides: Partial<FinanceTransaction> = {}): FinanceTransaction {
  return { id: "t1", account_id: "a1", amount: 25, description: "Deposit", transaction_date: "2026-09-01", ...overrides }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("accounts CRUD over /api/data/financial_accounts", () => {
  it("lists, creates, updates and deletes accounts through the store", async () => {
    const rows: Record<string, unknown[]> = { financial_accounts: [acct()] }
    const posted: unknown[] = []
    vi.stubGlobal("fetch", fetchMock(rows, posted))

    const listed = await listAccounts()
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe("Savings")

    const created = await createAccount({ name: "Credit card", type: "liability", balance: -500, currency: "MYR" })
    expect(created.id).toBeTruthy()
    expect(created.user_id).toBeNull()
    expect(posted.some((p) => (p as { row: FinancialAccount }).row.name === "Credit card")).toBe(true)

    const updated = await updateAccount({ ...created, balance: -450 })
    expect(updated.balance).toBe(-450)

    await deleteAccount(created.id)
    expect((await listAccounts()).some((a) => a.id === created.id)).toBe(false)
  })

  it("deleteAccount cascades to the account's transactions", async () => {
    const rows: Record<string, unknown[]> = {
      financial_accounts: [acct()],
      transactions: [tx(), tx({ id: "t2", account_id: "a1" }), tx({ id: "t3", account_id: "other" })]
    }
    vi.stubGlobal("fetch", fetchMock(rows))
    await deleteAccount("a1")
    const remaining = await listTransactions()
    expect(remaining.map((t) => t.id)).toEqual(["t3"])
  })
})

describe("transactions CRUD over /api/data/transactions", () => {
  it("creates, updates and deletes transactions", async () => {
    const rows: Record<string, unknown[]> = { transactions: [tx()] }
    vi.stubGlobal("fetch", fetchMock(rows))

    expect((await listTransactions()).map((t) => t.description)).toEqual(["Deposit"])

    const created = await createTransaction({ account_id: "a1", amount: -10, description: "Coffee", transaction_date: "2026-09-02" })
    expect(created.id).toBeTruthy()
    const updated = await updateTransaction({ ...created, amount: -12 })
    expect(updated.amount).toBe(-12)
    await deleteTransaction(created.id)
    expect((await listTransactions()).some((t) => t.id === created.id)).toBe(false)
  })
})

describe("computed balances and net worth", () => {
  it("running balance = starting balance + sum of the account's transactions", () => {
    const a = acct({ balance: 100 })
    expect(runningBalance(a, [tx({ amount: 25 }), tx({ amount: -30 }), tx({ amount: 5, account_id: "other" })])).toBe(95)
  })

  it("net worth = assets − liabilities, excluding revenue/expense flow accounts", () => {
    const accounts = [
      acct({ id: "a1", balance: 1000, currency: "USD" }),
      acct({ id: "a2", name: "Loan", type: "liability", balance: -200, currency: "USD" }),
      acct({ id: "a3", name: "Side gig", type: "revenue", balance: 5000, currency: "USD" }),
      acct({ id: "a4", name: "Rent", type: "expense", balance: -800, currency: "USD" })
    ]
    const { usdTotal, byCurrency } = netWorthTotals(accounts, [tx({ amount: 50 })])
    expect(byCurrency.USD).toBe(1000 + 50 - 200) // revenue/expense excluded
    expect(usdTotal).toBeCloseTo(850, 5)
  })

  it("multi-currency totals convert to USD via fixed approximate rates", () => {
    const accounts = [acct({ id: "a1", balance: 1000, currency: "USD" }), acct({ id: "a2", name: "MYR bank", balance: 1000, currency: "MYR" })]
    const { byCurrency, usdTotal } = netWorthTotals(accounts, [])
    expect(byCurrency.MYR).toBe(1000)
    expect(usdTotal).toBeCloseTo(1000 + 1000 * 0.215, 5)
  })

  it("convertToUsd treats unknown currencies as 0 and USD as 1", () => {
    expect(convertToUsd({ USD: 10, XBT: 100 })).toBe(10)
  })

  it("formatMoney renders the account's own currency", () => {
    expect(formatMoney(1234.5, "MYR")).toContain("MYR")
    expect(formatMoney(1234.5)).toContain("$")
  })
})

describe("syncTradingAccount — trading-suite bridge", () => {
  it("auto-creates a synced asset account when none exists", async () => {
    const rows: Record<string, unknown[]> = { financial_accounts: [] }
    vi.stubGlobal("fetch", fetchMock(rows))
    const out = await syncTradingAccount([], 500)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("Paper trading")
    expect(out[0].type).toBe("asset")
    expect(out[0].synced).toBe(true)
    expect(out[0].balance).toBe(500)
  })

  it("updates the existing synced account's balance to the live cash", async () => {
    const existing = acct({ id: "trade", name: "Paper trading", type: "asset", balance: 100, currency: "USD", synced: true })
    const rows: Record<string, unknown[]> = { financial_accounts: [existing] }
    const posted: unknown[] = []
    vi.stubGlobal("fetch", fetchMock(rows, posted))
    const out = await syncTradingAccount([existing], 250)
    expect(out[0].balance).toBe(250)
    expect(posted.some((p) => (p as { row: FinancialAccount }).row.id === "trade" && (p as { row: FinancialAccount }).row.balance === 250)).toBe(true)
  })

  it("is a no-op when the balance is unchanged, and no-ops when cash is unknown", async () => {
    const existing = acct({ id: "trade", name: "Paper trading", type: "asset", balance: 100, currency: "USD", synced: true })
    const rows: Record<string, unknown[]> = { financial_accounts: [existing] }
    const posted: unknown[] = []
    vi.stubGlobal("fetch", fetchMock(rows, posted))
    await syncTradingAccount([existing], 100)
    expect(posted).toHaveLength(0)
    const none = await syncTradingAccount([existing], null)
    expect(none[0].balance).toBe(100)
  })
})