import { useState } from "react"
import { Button, Card, Field, Input, Textarea, Spinner, Badge } from "./ui"
import { HumanReviewGate } from "./HumanReviewGate"
import {
  analyzeListing,
  analyzeKeywords,
  fetchCompetitors,
  rewriteListing,
  logAgentAction,
  SOURCE_LABELS
} from "@/lib/api"
import type { KeywordResult, RewriteResult } from "@/lib/api"
import { appendData } from "@/lib/localdata"
import { useUser, useAuth } from "@/hooks/useAuth"
import type { CompetitorResult, Suggestion } from "@/lib/types"

export function ListingOptimizer() {
  const user = useUser()
  const { session } = useAuth()
  const [asin, setAsin] = useState("")
  const [title, setTitle] = useState("")
  const [bullets, setBullets] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [research, setResearch] = useState<{ title: string; link: string; source: string; date: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [competing, setCompeting] = useState(false)
  const [competitors, setCompetitors] = useState<CompetitorResult | null>(null)
  const [kwBusy, setKwBusy] = useState(false)
  const [keywords, setKeywords] = useState<KeywordResult | null>(null)
  const [rwBusy, setRwBusy] = useState(false)
  const [rewrites, setRewrites] = useState<RewriteResult | null>(null)

  const bulletList = bullets
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)

  const run = async () => {
    setBusy(true)
    const res = await analyzeListing(
      { asin, currentTitle: title, currentBullets: bulletList },
      user?.id,
      session?.access_token
    )
    setSuggestions(res.suggestions)
    setSource(res.source)
    setResearch(res.research ?? [])
    setBusy(false)
    await logAgentAction(user?.id, "Listing Optimizer", "analyze_listing", { asin, title }, res.suggestions)
    if (user) {
      await appendData("listing_analyses", {
        user_id: user.id,
        asin,
        product_name: title,
        suggestions: res.suggestions,
        source: { engine: res.source }
      }).catch(() => undefined)
    }
  }

  const fetchCompetitorsNow = async () => {
    setCompeting(true)
    setCompetitors(null)
    try {
      const res = await fetchCompetitors(
        { keywords: title, asin },
        session?.access_token
      )
      setCompetitors(res)
    } catch (err) {
      setCompetitors({ source: "error", competitors: [], note: (err as Error).message })
    }
    setCompeting(false)
    await logAgentAction(user?.id, "Listing Optimizer", "competitor_lookup", { keywords: title, asin }, competitors)
  }

  const runKeywords = async () => {
    setKwBusy(true)
    setKeywords(null)
    try {
      const res = await analyzeKeywords(
        { currentTitle: title, currentBullets: bulletList },
        session?.access_token
      )
      setKeywords(res)
      await logAgentAction(user?.id, "Listing Optimizer", "keyword_research", { title }, res)
    } catch (err) {
      setKeywords({ source: "error", keywords: { unigrams: [], phrases: [], source: "error" }, longTail: [], category: [], note: (err as Error).message })
    }
    setKwBusy(false)
  }

  const runRewrite = async () => {
    setRwBusy(true)
    setRewrites(null)
    try {
      const res = await rewriteListing(
        { currentTitle: title, currentBullets: bulletList },
        session?.access_token
      )
      setRewrites(res)
      await logAgentAction(user?.id, "Listing Optimizer", "listing_rewrite", { title }, res)
    } catch (err) {
      setRewrites({ source: "error", rewrites: [] })
    }
    setRwBusy(false)
  }

  const applyRewrite = (r: { title: string; bullets: string[] }) => {
    setTitle(r.title)
    setBullets(r.bullets.join("\n"))
  }

  return (
    <div className="stack">
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <Field label="ASIN" hint="Read-only analysis — nothing is submitted to Amazon">
            <Input
              value={asin}
              onChange={(e) => setAsin(e.target.value.trim())}
              placeholder="B0EXAMPLE"
            />
          </Field>
          <Field label="Current product title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Current bullet points" hint="One per line">
            <Textarea
              rows={4}
              value={bullets}
              onChange={(e) => setBullets(e.target.value)}
              placeholder={"Feature 1\nFeature 2\nFeature 3"}
            />
          </Field>
          <div className="row wrap">
            <Button type="submit" disabled={busy}>
              {busy ? "Analyzing listing…" : "Analyze listing"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={competing || (!title.trim() && !asin.trim())}
              onClick={() => void fetchCompetitorsNow()}
            >
              {competing ? "Fetching competitor intel…" : "Fetch competitor intel"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={kwBusy || !title.trim()}
              onClick={() => void runKeywords()}
            >
              {kwBusy ? "Mining keywords…" : "Keyword research"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={rwBusy || !title.trim()}
              onClick={() => void runRewrite()}
            >
              {rwBusy ? "Rewriting…" : "Rewrite listing"}
            </Button>
          </div>
        </form>
      </Card>

      {competing ? <Spinner label="Querying Amazon catalog + pricing…" /> : null}

      {competitors ? (
        <Card className="stack">
          <h2 className="h2">
            Competitor intel
            <Badge tone={competitors.source === "amazon" || competitors.source === "serper" ? "success" : "muted"}>
              {competitors.source === "amazon"
                ? "Amazon SP-API"
                : competitors.source === "serper"
                  ? "Google (Serper)"
                  : "not configured"}
            </Badge>
          </h2>

          {competitors.source === "unconfigured" ? (
            <div className="suggestion-card">
              <p className="muted">
                Connect the Amazon Selling Partner API (SP_AMAZON_* keys in apps/dashboard/.env) for
                buy-box prices and offer counts from Amazon itself — or add a free{" "}
                <code className="pre">SERPER_API_KEY</code> to see real competitor listings and prices
                from Google right now. Until then no competitor data is shown — nothing here is
                fabricated.
              </p>
            </div>
          ) : competitors.competitors.length === 0 ? (
            <p className="muted">{competitors.note || "No matches."}</p>
          ) : (
            <>
              {competitors.note ? <p className="muted small">{competitors.note}</p> : null}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Brand</th>
                      <th>Price</th>
                      <th>Lowest</th>
                      <th>Offers</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {competitors.competitors.map((c, i) => (
                      <tr key={c.asin || i}>
                        <td>
                          <div className="row gap">
                            {c.image ? <img src={c.image} alt="" className="thumb" /> : null}
                            <span className="small">{c.title}</span>
                          </div>
                        </td>
                        <td>{c.brand || "—"}</td>
                        <td>
                          {c.buyboxPrice != null ? (
                            <strong>
                              {c.currency ?? ""} {c.buyboxPrice}
                            </strong>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{c.lowestPrice != null ? `${c.currency ?? ""} ${c.lowestPrice}` : "—"}</td>
                        <td>{c.offerCount > 0 ? c.offerCount : "—"}</td>
                        <td>
                          {c.asin ? (
                            <code className="small">{c.asin}</code>
                          ) : c.url ? (
                            <>
                              <span className="muted small">{c.retailer ? `${c.retailer} · ` : ""}</span>
                              <a href={c.url} target="_blank" rel="noreferrer" className="link-btn">
                                view ↗
                              </a>
                            </>
                          ) : (
                            <span className="muted small">web</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {kwBusy ? <Spinner label="Mining keywords + long-tail ideas…" /> : null}

      {keywords ? (
        <Card className="stack">
          <h2 className="h2">
            Keyword research
            <Badge tone={keywords.source && SOURCE_LABELS[keywords.source]?.real ? "success" : "muted"}>
              {keywords.source ? (SOURCE_LABELS[keywords.source]?.label ?? keywords.source) : "local engine"}
            </Badge>
          </h2>
          {keywords.keywords.unigrams.length ? (
            <div>
              <span className="metric-label">Terms in your listing</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {keywords.keywords.unigrams.map((k) => (
                  <span key={k.word} className="chip">
                    {k.word} <span className="muted">×{k.count}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {keywords.keywords.phrases.length ? (
            <div>
              <span className="metric-label">Phrases detected</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {keywords.keywords.phrases.map((k) => (
                  <span key={k.word} className="chip">
                    {k.word} <span className="muted">×{k.count}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {keywords.category.length ? (
            <div>
              <span className="metric-label">Category keywords</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {keywords.category.map((k, i) => (
                  <span key={i} className="badge badge-accent">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {keywords.longTail.length ? (
            <div>
              <span className="metric-label">Long-tail ideas (use in titles + backend keywords)</span>
              <ul className="list">
                {keywords.longTail.map((k, i) => (
                  <li key={i} className="list-row">
                    <span>• {k}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {keywords.note ? <p className="muted small">{keywords.note}</p> : null}
        </Card>
      ) : null}

      {rwBusy ? <Spinner label="Writing alternative listings…" /> : null}

      {rewrites ? (
        <Card className="stack">
          <h2 className="h2">
            Listing rewrites
            <Badge tone={rewrites.source && SOURCE_LABELS[rewrites.source]?.real ? "success" : "muted"}>
              {rewrites.source ? (SOURCE_LABELS[rewrites.source]?.label ?? rewrites.source) : "engine"}
            </Badge>
          </h2>
          {rewrites.rewrites.length === 0 ? (
            <p className="muted">No rewrites returned.</p>
          ) : (
            rewrites.rewrites.map((r, i) => (
              <div key={i} className="suggestion-card">
                <div className="row space-between">
                  <strong>Option {i + 1}</strong>
                  <div className="row" style={{ gap: 8 }}>
                    <Button type="button" variant="ghost" onClick={() => applyRewrite(r)}>
                      ✏️ Use this in form
                    </Button>
                    <HumanReviewGate
                      surface="listing_optimizer.rewrite"
                      suggestionId={`rewrite-${i}`}
                      confirmLabel="📋 Copy full rewrite"
                      meta={{ asin, option: i }}
                      onConfirm={() =>
                        navigator.clipboard.writeText(`${r.title}\n\n${r.bullets.map((b) => `- ${b}`).join("\n")}`)
                      }
                    />
                  </div>
                </div>
                <p className="pre" style={{ whiteSpace: "pre-wrap" }}>
                  {r.title}
                </p>
                {r.bullets.length ? (
                  <ul className="list">
                    {r.bullets.map((b, j) => (
                      <li key={j} className="list-row">
                        <span>• {b}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.note ? <p className="muted small">{r.note}</p> : null}
              </div>
            ))
          )}
        </Card>
      ) : null}

      {busy ? <Spinner label="Analyzing competitor patterns…" /> : null}

      {suggestions ? (
        <Card className="stack">
          <h2 className="h2">
            AI suggestions
            <Badge tone={source && SOURCE_LABELS[source]?.real ? "success" : "muted"}>
              {source ? (SOURCE_LABELS[source]?.label ?? source) : "engine"}
            </Badge>
          </h2>
          <p className="muted small">
            Each suggestion is gated behind a mandatory human-review timer. You paste the final
            version into Amazon yourself — PICC never edits your store.
          </p>

          {research.length ? (
            <div className="research-strip">
              <span className="metric-label">Live research sources</span>
              <div className="row wrap">
                {research.slice(0, 4).map((r, i) => (
                  <a
                    key={i}
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="chip"
                  >
                    {r.title.slice(0, 48)}
                    {r.source ? <span className="muted small"> · {r.source}</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {suggestions.map((s) => (
            <div key={s.id} className="suggestion-card">
              <div className="row space-between">
                <strong>{s.title}</strong>
                <Badge tone="warn">{Math.round(s.confidence * 100)}% confidence</Badge>
              </div>
              <p className="muted">{s.body}</p>
              <HumanReviewGate
                surface="listing_optimizer"
                suggestionId={s.id}
                confirmLabel="📋 Copy suggestion"
                meta={{ asin }}
                onConfirm={() => navigator.clipboard.writeText(s.body)}
              />
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  )
}
