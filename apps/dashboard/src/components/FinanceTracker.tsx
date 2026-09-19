import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge, Button, Card, Field, Input, Select, Skeleton } from "@/components/ui"
import {
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
  type AccountType,
  type FinanceTransaction,
  type FinancialAccount
} from "@/lib/finance"
import { getPaperOverview } from "@/lib/trading"

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "revenue", label: "Revenue (income)" },
  { value: "expense", label: "Expense" }
]
const CURRENCIES = ["USD", "MYR", "EUR", "GBP", "SGD", "AUD", "JPY", "CNY", "THB", "IDR"]

type AccountDraft = { name: string; type: AccountType; currency: string; balance: string; note: string }
const EMPTY_ACCOUNT: AccountDraft = { name: "", type: "asset", currency: "USD", balance: "", note: "" }

type TxDraft = { description: string; amount: string; category: string; tags: string; transaction_date: string }
const EMPTY_TX: TxDraft = {
  description: "",
  amount: "",
  category: "",
  tags: "",
  transaction_date: new Date().toISOString().slice(0, 10)
}

/**
 * Finance tracker (PICC_FULL_SCOPE Part 2a): accounts + transactions CRUD over
 * the real /api/data/* store, computed net worth, and the auto-synced paper-
 * trading account. Mounted on the Profile page.
 *
 * Honesty rules: net worth is computed, never manual; the trading account's
 * balance is live (edits are disabled so a manual value never fights the sync);
 * fixed-rate FX conversion is labelled approximate, not live quotes.
 */
export function FinanceTracker() {
  const [accounts, setAccounts] = useState<FinancialAccount[] | null>(null)
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // account editor
  const [acctForm, setAcctForm] = useState<AccountDraft>(EMPTY_ACCOUNT)
  const [editingAccount, setEditingAccount] = useState<FinancialAccount | null>(null)

  // transaction editor
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [txForm, setTxForm] = useState<TxDraft>(EMPTY_TX)
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [accs, txs] = await Promise.all([listAccounts(), listTransactions()])
      // Trading-suite bridge: auto-create/keep the synced paper account in sync.
      const ov = await getPaperOverview().catch(() => null)
      const synced = await syncTradingAccount(accs, ov?.ok ? ov.cash : null)
      setAccounts(synced)
      setTransactions(txs)
      setSelectedAccountId((cur) => (cur && synced.some((a) => a.id === cur) ? cur : synced[0]?.id ?? null))
    } catch (e) {
      setError(e instanceof Error ? e.message : "finance load failed")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const totals = useMemo(
    () => netWorthTotals(accounts ?? [], transactions),
    [accounts, transactions]
  )
  const currencyChips = useMemo(() => {
    const entries = Object.entries(totals.byCurrency).filter(([, v]) => v !== 0)
    if (entries.length === 0) return null
    const usd = entries.find(([c]) => c === "USD")
    return usd ? `${formatMoney(usd[1])} USD` : entries.map(([c, v]) => `${formatMoney(v, c)} ${c}`).join(" + ")
  }, [totals])

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId) ?? null
  const selectedTxs = useMemo(
    () =>
      transactions
        .filter((t) => t.account_id === selectedAccountId)
        .sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1)),
    [transactions, selectedAccountId]
  )

  const submitAccount = async () => {
    const balance = Number(acctForm.balance) || 0
    if (!acctForm.name.trim()) return
    setBusy("account")
    try {
      if (editingAccount) {
        await updateAccount({ ...editingAccount, name: acctForm.name.trim(), type: acctForm.type, currency: acctForm.currency, balance, note: acctForm.note.trim() || undefined })
      } else {
        await createAccount({ name: acctForm.name.trim(), type: acctForm.type, currency: acctForm.currency, balance, note: acctForm.note.trim() || undefined })
      }
      setAcctForm(EMPTY_ACCOUNT)
      setEditingAccount(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "account save failed")
    } finally {
      setBusy(null)
    }
  }

  const beginEditAccount = (a: FinancialAccount) => {
    setEditingAccount(a)
    setAcctForm({ name: a.name, type: a.type, currency: a.currency, balance: String(a.balance), note: a.note ?? "" })
  }

  const cancelEditAccount = () => {
    setEditingAccount(null)
    setAcctForm(EMPTY_ACCOUNT)
  }

  const removeAccount = async (a: FinancialAccount) => {
    if (a.synced) return
    setBusy(`del-account-${a.id}`)
    try {
      await deleteAccount(a.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "account delete failed")
    } finally {
      setBusy(null)
    }
  }

  const submitTx = async () => {
    if (!selectedAccount || !txForm.description.trim()) return
    const amount = Number(txForm.amount) || 0
    setBusy("transaction")
    try {
      const base = {
        account_id: selectedAccount.id,
        description: txForm.description.trim(),
        amount,
        category: txForm.category.trim() || undefined,
        tags: txForm.tags.trim() || undefined,
        transaction_date: txForm.transaction_date || new Date().toISOString().slice(0, 10)
      }
      if (editingTx) await updateTransaction({ ...editingTx, ...base })
      else await createTransaction(base)
      setTxForm(EMPTY_TX)
      setEditingTx(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "transaction save failed")
    } finally {
      setBusy(null)
    }
  }

  const beginEditTx = (t: FinanceTransaction) => {
    setEditingTx(t)
    setTxForm({
      description: t.description,
      amount: String(t.amount),
      category: t.category ?? "",
      tags: t.tags ?? "",
      transaction_date: t.transaction_date
    })
  }

  const cancelEditTx = () => {
    setEditingTx(null)
    setTxForm(EMPTY_TX)
  }

  const removeTx = async (t: FinanceTransaction) => {
    setBusy(`del-tx-${t.id}`)
    try {
      await deleteTransaction(t.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "transaction delete failed")
    } finally {
      setBusy(null)
    }
  }

  if (!accounts) {
    return (
      <Card className="stack">
        <h2 className="h2">Finance tracker</h2>
        {error ? <p className="muted">{error}</p> : null}
        <div aria-busy="true" className="skeleton-row">
          <Skeleton width="60%" />
          <Skeleton width="40%" />
        </div>
      </Card>
    )
  }

  return (
    <Card className="stack" style={{ marginTop: 16 }}>
      <div className="row-between" style={{ alignItems: "center" }}>
        <h2 className="h2" style={{ margin: 0 }}>
          Finance tracker
        </h2>
        <Button variant="primary" onClick={refresh} disabled={busy !== null} style={{ fontSize: 11, padding: "3px 12px" }}>
          {busy !== null ? "Saving…" : "Refresh"}
        </Button>
      </div>
      {error ? <p className="muted" style={{ color: "var(--danger)" }}>{error}</p> : null}

      {/* Computed net worth — never manual */}
      <div className="row wrap" style={{ gap: 16, alignItems: "baseline" }}>
        <div>
          <div className="metric-label">Net worth (assets − liabilities)</div>
          <div className="metric-value">
            {totals.usdTotal !== 0 || Object.keys(totals.byCurrency).length > 0
              ? formatMoney(totals.usdTotal)
              : "—"}
          </div>
        </div>
        {currencyChips ? (
          <span className="muted small">
            {currencyChips}
            <br />
            fixed approximate FX rates · not live quotes
          </span>
        ) : (
          <span className="muted small">computed from {accounts.length} account{accounts.length === 1 ? "" : "s"}</span>
        )}
      </div>

      {/* Accounts */}
      <h3 className="h3" style={{ marginBottom: 8 }}>Accounts</h3>
      {accounts.length === 0 ? (
        <p className="muted">No accounts yet — add your first one below.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Currency</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const bal = runningBalance(a, transactions)
                return (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {a.synced && (
                        <span style={{ marginLeft: 6 }}>
                          <Badge tone="success">linked · auto-synced</Badge>
                        </span>
                      )}
                      {a.note ? <div className="muted small">{a.note}</div> : null}
                    </td>
                    <td><Badge tone={a.type === "asset" ? "success" : a.type === "liability" ? "danger" : "muted"}>{a.type}</Badge></td>
                    <td>{a.currency}</td>
                    <td style={{ fontWeight: 700 }}>{formatMoney(bal, a.currency)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button variant="ghost" onClick={() => beginEditAccount(a)} style={{ fontSize: 10, padding: "2px 8px" }}>
                        Edit
                      </Button>{" "}
                      {!a.synced && (
                        <Button
                          variant="ghost"
                          disabled={busy === `del-account-${a.id}`}
                          onClick={() => removeAccount(a)}
                          style={{ fontSize: 10, padding: "2px 8px", color: "var(--danger)" }}
                        >
                          {busy === `del-account-${a.id}` ? "…" : "Delete"}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <Field label={editingAccount ? "Edit account" : "Add account"}>
          <Input
            value={acctForm.name}
            onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })}
            placeholder="Name (e.g. Maybank savings)"
          />
        </Field>
        <Field label="Type">
          <Select value={acctForm.type} onChange={(e) => setAcctForm({ ...acctForm, type: e.target.value as AccountType })}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Currency">
          <Select value={acctForm.currency} onChange={(e) => setAcctForm({ ...acctForm, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Starting balance">
          <Input
            type="number"
            step="0.01"
            value={acctForm.balance}
            disabled={editingAccount?.synced ?? false}
            onChange={(e) => setAcctForm({ ...acctForm, balance: e.target.value })}
            placeholder={acctForm.type === "liability" ? "amount owed, e.g. -500" : "0.00"}
          />
          {acctForm.type === "liability" && (
            <span className="muted small">liabilities are entered negative (amount owed)</span>
          )}
        </Field>
        <Field label="Note">
          <Input value={acctForm.note} onChange={(e) => setAcctForm({ ...acctForm, note: e.target.value })} placeholder="optional" />
        </Field>
        <Button variant="primary" disabled={busy === "account" || !acctForm.name.trim()} onClick={submitAccount} style={{ fontSize: 11, padding: "6px 14px" }}>
          {editingAccount ? "Save account" : "Add account"}
        </Button>
        {editingAccount && (
          <Button variant="ghost" onClick={cancelEditAccount} style={{ fontSize: 11, padding: "6px 10px" }}>
            Cancel
          </Button>
        )}
      </div>

      {/* Transactions per account */}
      <h3 className="h3" style={{ marginBottom: 8, marginTop: 16 }}>Transactions</h3>
      <Field label="Account">
        <Select value={selectedAccountId ?? ""} onChange={(e) => setSelectedAccountId(e.target.value || null)}>
          {accounts.length === 0 ? (
            <option value="">—</option>
          ) : (
            accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>
            ))
          )}
        </Select>
      </Field>

      {!selectedAccount ? (
        <p className="muted">Add an account first to record transactions.</p>
      ) : (
        <>
          {selectedTxs.length === 0 ? (
            <p className="muted">No transactions yet for {selectedAccount.name}.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Tags</th>
                    <th>Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {selectedTxs.map((t) => (
                    <tr key={t.id}>
                      <td className="muted">{t.transaction_date}</td>
                      <td>{t.description}</td>
                      <td>{t.category ? <Badge>{t.category}</Badge> : <span className="muted">—</span>}</td>
                      <td className="muted small">{t.tags ?? ""}</td>
                      <td style={{ fontWeight: 700, color: t.amount >= 0 ? "var(--text)" : "var(--loss)" }}>
                        {formatMoney(t.amount, selectedAccount.currency)}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Button variant="ghost" onClick={() => beginEditTx(t)} style={{ fontSize: 10, padding: "2px 8px" }}>
                          Edit
                        </Button>{" "}
                        <Button
                          variant="ghost"
                          disabled={busy === `del-tx-${t.id}`}
                          onClick={() => removeTx(t)}
                          style={{ fontSize: 10, padding: "2px 8px", color: "var(--danger)" }}
                        >
                          {busy === `del-tx-${t.id}` ? "…" : "Delete"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <Field label={editingTx ? "Edit transaction" : "Add transaction"}>
              <Input
                value={txForm.description}
                onChange={(e) => setTxForm({ ...txForm, description: e.target.value })}
                placeholder="Description"
              />
            </Field>
            <Field label="Amount">
              <Input
                type="number"
                step="0.01"
                value={txForm.amount}
                onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Category">
              <Input value={txForm.category} onChange={(e) => setTxForm({ ...txForm, category: e.target.value })} placeholder="e.g. salary" />
            </Field>
            <Field label="Tags">
              <Input value={txForm.tags} onChange={(e) => setTxForm({ ...txForm, tags: e.target.value })} placeholder="comma, separated" />
            </Field>
            <Field label="Date">
              <Input type="date" value={txForm.transaction_date} onChange={(e) => setTxForm({ ...txForm, transaction_date: e.target.value })} />
            </Field>
            <Button variant="primary" disabled={busy === "transaction" || !txForm.description.trim()} onClick={submitTx} style={{ fontSize: 11, padding: "6px 14px" }}>
              {editingTx ? "Save transaction" : "Add transaction"}
            </Button>
            {editingTx && (
              <Button variant="ghost" onClick={cancelEditTx} style={{ fontSize: 11, padding: "6px 10px" }}>
                Cancel
              </Button>
            )}
          </div>
          <p className="muted small">
            Negative amounts record spending/outflows. Net worth = assets − liabilities (liabilities entered
            negative), computed from starting balance + transactions — no manual snapshots.
          </p>
        </>
      )}
    </Card>
  )
}