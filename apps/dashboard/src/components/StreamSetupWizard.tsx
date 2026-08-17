import { useMemo, useState } from "react"
import { Badge, Button, Card, Input } from "./ui"
import { CATALOG } from "@/lib/streamCatalog"
import type { IncomeStream, StreamCategory, StreamStatus } from "@/lib/types"

interface StepDef {
  category: StreamCategory
  title: string
  description: string
  examples: string[]
  defaultName: string
  setupHint: string
}

const STEPS: StepDef[] = [
  {
    category: "bandwidth",
    title: "Bandwidth sharing",
    description:
      "Sell your unused home or VPS internet bandwidth to companies that need residential IPs for ad-verification, price-checking and market research.",
    examples: ["Honeygain", "EarnApp", "IPRoyal Pawns", "PacketStream", "Repocket", "Traffmonetizer"],
    defaultName: "Honeygain",
    setupHint:
      "Install the app on a device that stays online, leave it running, and it accrues cents per day. Most pay out at $20–$40 via PayPal or crypto. PICC can auto-sync Honeygain — see the collectors step at the end."
  },
  {
    category: "dividend",
    title: "Dividends",
    description:
      "Regular payouts from shares, ETFs and REITs you own. Passive once the capital is in; yields typically 2–6% a year.",
    examples: ["VOO", "VYM", "SCHD", "EPU", "REITs"],
    defaultName: "Dividend ETF",
    setupHint:
      "Enter the ticker you hold and PICC's Financial Twin can estimate annual dividend income on your capital. Record each payout as it lands."
  },
  {
    category: "interest",
    title: "Interest",
    description:
      "Interest on savings, fixed deposits, money-market funds or stablecoin staking. Safe, predictable, but low — usually 3–5% a year.",
    examples: ["Fixed deposit", "ASNB", "Money market", "USDC yield", "T-bills"],
    defaultName: "High-yield savings",
    setupHint:
      "Add the account as a stream and log the monthly interest. Very low effort — set estimated daily to roughly monthly-interest ÷ 30."
  },
  {
    category: "affiliate",
    title: "Affiliate marketing",
    description:
      "Commission on purchases made through links you share. Passive only after the content that holds the links is built and ranking.",
    examples: ["Amazon Associates", "Shopee affiliate", "TikTok Shop", "Brokerage referrals", "Software affiliate programs"],
    defaultName: "Affiliate program",
    setupHint:
      "Put affiliate links in the content PICC's Content Studio writes for you. Track commissions here as they're approved."
  },
  {
    category: "content",
    title: "Content monetization",
    description:
      "Ad revenue, sponsorships and memberships from content you publish — YouTube, a blog, or a newsletter.",
    examples: ["YouTube", "Blog + AdSense", "Substack / Beehiiv", "Medium Partner Program"],
    defaultName: "Content channel",
    setupHint:
      "Use Content Studio for drafts, publish consistently, then log ad/sponsor income as it arrives."
  },
  {
    category: "rental",
    title: "Rental income",
    description:
      "Rent out physical assets — a room, parking space, camera gear, tools, or even a spare SSD on storage networks.",
    examples: ["Room", "Parking space", "Camera gear", "Equipment", "Storj node"],
    defaultName: "Rental income",
    setupHint:
      "List the asset once and log rent as it comes in monthly. PICC's Storage catalog entry (Storj) is the closest passive digital equivalent."
  },
  {
    category: "p2p",
    title: "P2P lending",
    description:
      "Lend money to borrowers through peer-to-peer platforms for higher yield — at higher risk. Capital can be locked up.",
    examples: ["Funding Societies", "Lendela", "Marketplace lenders"],
    defaultName: "P2P lending",
    setupHint:
      "Only lend money you can afford to lose. Track the outstanding balance and log each repayment as earnings."
  },
  {
    category: "crypto",
    title: "Crypto staking & DeFi yield",
    description:
      "Yield on crypto you hold — on-chain staking (ETH, SOL), stablecoin savings, or exchange earn products. Higher risk, higher volatility.",
    examples: ["ETH staking (Lido ~2–3.5%)", "SOL staking (Jito ~5–6%)", "USDT / USDC savings", "Luno holdings"],
    defaultName: "Crypto staking",
    setupHint:
      "Malaysia: on-ramp via SC-registered exchanges (Luno, MX Global); on-chain staking is unregulated locally — use at your own risk. Set est $/day ≈ (staked amount × APY) ÷ 365."
  },
  {
    category: "agent",
    title: "AI agents",
    description:
      "Sell outcomes produced by AI agents — research reports, content, automation — or run agents that work for you.",
    examples: ["CrewAI microservice", "Research reports", "Automated content", "Data pipelines"],
    defaultName: "AI agent income",
    setupHint:
      "PICC ships a CrewAI crew in agents/picc_agents. Set PICC_AGENTS_URL in .env and sell the reports it produces. Log each sale here."
  },
  {
    category: "other",
    title: "Everything else",
    description:
      "Any other income that doesn't fit above — cashback, surveys, cash-out residuals, one-off gigs you've automated away.",
    examples: ["Cashback", "Surveys", "Residuals", "One-off sales"],
    defaultName: "Other income",
    setupHint: "Keep this category for anything unusual. Log earnings the same way as any other stream."
  }
]

export function StreamSetupWizard({
  streams,
  onAdded,
  onSetCollectorsHint
}: {
  streams: IncomeStream[]
  onAdded: (input: Omit<IncomeStream, "id">) => void
  onSetCollectorsHint: () => void
}) {
  const configured = useMemo(
    () => new Set(streams.map((s) => s.category)),
    [streams]
  )

  const [index, setIndex] = useState(() => STEPS.findIndex((s) => !configured.has(s.category)))
  const [form, setForm] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState(false)

  const step = STEPS[index]
  const done = index < 0
  const progress = STEPS.filter((s) => configured.has(s.category)).length

  const bump = (nextIndex: number) => {
    let i = nextIndex
    while (i < STEPS.length && configured.has(STEPS[i].category)) i++
    setIndex(i >= STEPS.length ? -1 : i)
  }

  const addCurrent = () => {
    if (!step) return
    const f = form
    const name = f.name?.trim() || step.defaultName
    onAdded({
      name,
      platform: f.platform?.trim() || name,
      category: step.category,
      status: "active" as StreamStatus,
      balance: Number(f.balance) || 0,
      totalEarned: Number(f.totalEarned) || 0,
      payoutThreshold: Number(f.threshold) || 0,
      payoutMethod: f.payout || "PayPal",
      estimatedDaily: Number(f.estDaily) || 0,
      url: f.url?.trim() || CATALOG.find((c) => c.name.toLowerCase() === name.toLowerCase())?.url,
      collector: "manual"
    })
    setForm({})
    bump(index + 1)
  }

  if (collapsed || done) {
    return (
      <Card className="stack">
        <div className="row space-between">
          <h2 className="h2" style={{ margin: 0 }}>
            🧭 Setup guide
            <Badge tone={progress === STEPS.length ? "success" : "warn"}>{progress}/{STEPS.length} configured</Badge>
          </h2>
          {done ? (
            <Button variant="ghost" onClick={onSetCollectorsHint}>
              🎁 Add Honeygain / CashPilot collectors
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setCollapsed(false)}>
              Resume setup
            </Button>
          )}
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {STEPS.map((s) => (
            <Badge key={s.category} tone={configured.has(s.category) ? "success" : "muted"}>
              {configured.has(s.category) ? "✓" : "○"} {s.title}
            </Badge>
          ))}
        </div>
      </Card>
    )
  }

  const f = (k: string) => form[k] ?? ""

  return (
    <Card className="stack">
      <div className="row space-between">
        <h2 className="h2" style={{ margin: 0 }}>
          🧭 Setup guide
          <Badge tone="warn">{progress}/{STEPS.length} configured</Badge>
        </h2>
        <Button variant="ghost" onClick={() => setCollapsed(true)}>
          Minimize
        </Button>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${(progress / STEPS.length) * 100}%` }} />
      </div>
      <div className="row space-between" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ gap: 6, flex: 1 }}>
          <div className="row">
            <h3 className="h3" style={{ margin: 0 }}>
              Step {index + 1} of {STEPS.length}: {step.title}
            </h3>
            {configured.has(step.category) ? <Badge tone="success">already configured</Badge> : null}
          </div>
          <p className="muted" style={{ margin: 0 }}>{step.description}</p>
          <div className="row wrap" style={{ gap: 6 }}>
            {step.examples.map((ex) => (
              <span key={ex} className="chip">{ex}</span>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{step.setupHint}</p>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <Input placeholder={`Name (default: ${step.defaultName})`} value={f("name")} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
        <Input placeholder="Platform" value={f("platform")} onChange={(e) => setForm({ ...form, platform: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Input placeholder="Est $/day" type="number" min="0" value={f("estDaily")} onChange={(e) => setForm({ ...form, estDaily: e.target.value })} style={{ width: 110 }} />
        <Input placeholder="Balance $" type="number" min="0" value={f("balance")} onChange={(e) => setForm({ ...form, balance: e.target.value })} style={{ width: 110 }} />
        <Input placeholder="Payout threshold $" type="number" min="0" value={f("threshold")} onChange={(e) => setForm({ ...form, threshold: e.target.value })} style={{ width: 150 }} />
        <Input placeholder="Payout method" value={f("payout")} onChange={(e) => setForm({ ...form, payout: e.target.value })} style={{ width: 140 }} />
        <Input placeholder="Dashboard URL" value={f("url")} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Button onClick={addCurrent}>✓ Add & next</Button>
        <Button variant="secondary" onClick={() => bump(index + 1)}>Skip</Button>
        {index < STEPS.length - 1 ? (
          <Button variant="ghost" onClick={() => bump(index + 1)}>I already do this</Button>
        ) : null}
      </div>
    </Card>
  )
}
