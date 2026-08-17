// PICC research-driven automation catalog.
//
// This module turns the 2026 income-classification research into something the
// dashboard can act on: a categorized opportunity catalog, the n8n workflow
// templates available for import, the CrewAI crews wired to the agents
// microservice, and a live monitor for on-chain bounty boards (agent economy).
//
// Everything here is honest by construction: every catalog entry carries a
// `verified` flag with a source URL, and anything the research could not
// confirm is labeled "needs_research" instead of being presented as fact.
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Income classification (blueprint categories A–G)
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  { id: "A", key: "passive", label: "Fully passive", blurb: "One-time setup, the money does the work — CDs, money markets, T-bills, dividend/index/bond funds." },
  { id: "B", key: "semi-passive", label: "Semi-passive", blurb: "Upfront work + maintenance — apps, print-on-demand, stock media, newsletters, faceless channels, AI tools with SEO." },
  { id: "C", key: "active", label: "Active", blurb: "Ongoing management — rentals, real-estate crowdfunding, parking, laundromats, hyper-casual games." },
  { id: "D", key: "crypto", label: "Crypto & Web3", blurb: "Staking, liquid staking, restaking, DeFi yield, NFTs, P2P lending, and the agent economy." },
  { id: "E", key: "depin", label: "DePIN & infrastructure", blurb: "Bandwidth, storage/compute, environmental data, and energy sharing." },
  { id: "F", key: "content", label: "AI content automation", blurb: "MoneyPrinterTurbo pipelines, AiToEarn, affiliate + local-SEO automations." },
  { id: "G", key: "stacks", label: "Open-source stacks", blurb: "Income-generator, money4band, CashPilot, IncomeOS, Firefly III, n8n, LM Studio." }
]

// ---------------------------------------------------------------------------
// Opportunity catalog — the automation/assistance/workflow backlog, researched
// August 2026. `verified` is true only when a primary source was found.
// ---------------------------------------------------------------------------
export const OPPORTUNITY_CATALOG = [
  // --- A · fully passive ----------------------------------------------------
  { id: "a-div-yield", category: "A", title: "Dividend & bond-fund income tracker", description: "Track dividend ETFs and bond funds with the existing Yahoo Finance + prediction engine; Firefly III keeps the bookkeeping double-entry.", whatItAutomates: "Auto-fetches quotes/forecasts; flags yield spikes and ex-dividend dates.", integrations: ["yfinance", "prediction", "Firefly III API"], effort: "low", expectedValue: "Accuracy + ex-date reminders", verified: true, sourceUrl: "https://api-docs.firefly-iii.org", status: "ready" },
  { id: "a-tbill-fy", category: "A", title: "T-Bill ladder tracker", description: "Record T-bill purchases and maturities as Firefly III liabilities; an n8n webhook syncs PICC snapshot rows into Firefly III.", whatItAutomates: "One-click snapshot → Firefly III transaction sync.", integrations: ["n8n", "Firefly III API", "picc-firefly-sync.json"], effort: "medium", expectedValue: "Cleaner net worth", verified: true, sourceUrl: "https://api-docs.firefly-iii.org", status: "ready" },
  // --- B · semi-passive ----------------------------------------------------
  { id: "b-faceless", category: "B", title: "Faceless shorts pipeline", description: "MoneyPrinterTurbo (harry0703, active 2026) generates script → TTS → visuals → captions; n8n schedules runs and posts the output.", whatItAutomates: "Full YouTube Shorts assembly; schedule via n8n.", integrations: ["MoneyPrinterTurbo", "n8n", "picc-moneyprinterturbo.json"], effort: "medium", expectedValue: "Volume content", verified: true, sourceUrl: "https://github.com/harry0703/MoneyPrinterTurbo", status: "ready" },
  { id: "b-newsletter", category: "B", title: "Newsletter monetization", description: "n8n + an email platform to build a subscription newsletter; Firefly III tracks the subscription revenue.", whatItAutomates: "Draft scheduling, subscriber list, revenue tagging.", integrations: ["n8n", "Firefly III API"], effort: "medium", expectedValue: "Recurring revenue", verified: true, sourceUrl: "https://docs.n8n.io", status: "ready" },
  { id: "b-ai-seo", category: "B", title: "AI tool with organic SEO", description: "Build small AI-powered tools and quizzes; Open-Laudable / AdMob monetization.", whatItAutomates: "Content generation + ad-monetization plumbing.", integrations: ["n8n", "AdMob"], effort: "high", expectedValue: "Traffic → ads", verified: false, sourceUrl: "", status: "needs_research" },
  // --- C · active ------------------------------------------------------------
  { id: "c-rental", category: "C", title: "Rental expense tracking", description: "Firefly III + n8n categorize rental income/expenses from bank import files.", whatItAutomates: "Categorization + monthly P&L.", integrations: ["Firefly III API", "n8n"], effort: "low", expectedValue: "Cleaner books", verified: true, sourceUrl: "https://api-docs.firefly-iii.org", status: "ready" },
  // --- D · crypto & Web3 -----------------------------------------------------
  { id: "d-staking", category: "D", title: "Staking & restaking yield monitor", description: "Keyless DefiLlama yields feed covers Lido (stETH ~2.2%), Jito (JitoSOL ~5%), Aave, Compound, Pendle and Yearn — no paid StakingRewards key needed.", whatItAutomates: "Hourly APY snapshot + alert on drops via n8n.", integrations: ["defillama", "n8n", "picc-yield-monitor-llama.json"], effort: "low", expectedValue: "Yield vigilance", verified: true, sourceUrl: "https://yields.llama.fi/pools", status: "ready" },
  { id: "d-nft", category: "D", title: "NFT floor / royalty tracking", description: "Browser connectors read OpenSea / Magic Eden floor + volume; the extension overlays live page reads.", whatItAutomates: "Floor-price and royalty visibility without an API.", integrations: ["connectors", "extension overlay"], effort: "low", expectedValue: "Better timing", verified: true, sourceUrl: "https://opensea.io", status: "ready" },
  { id: "d-p2p", category: "D", title: "P2P lending positions", description: "Record Prosper / PeerBerry notes as liabilities with scheduled income; no reliable public API — manual + n8n reminders.", whatItAutomates: "Repayment reminders + P&L.", integrations: ["n8n", "Firefly III API"], effort: "medium", expectedValue: "Position visibility", verified: false, sourceUrl: "", status: "needs_research" },
  { id: "d-bounties", category: "D", title: "Agent-economy bounty monitor", description: "Live boards: Agora ($THREE) at three.ws/labor-market and AIGEN Protocol's public board (intermittent in Aug 2026). n8n filters by your skills.", whatItAutomates: "Periodic board scan + skill filter + alert.", integrations: ["n8n", "picc-agent-bounties.json", "CrewAI bounty_hunter"], effort: "medium", expectedValue: "On-chain work", verified: true, sourceUrl: "https://three.ws/labor-market", status: "ready" },
  { id: "d-cashclaw", category: "D", title: "CashClaw freelance operator", description: "OpenClaw skill pack (npx cashclaw init) turns an agent into a freelance business on the HYRVE marketplace; Stripe + USDC payouts.", whatItAutomates: "SEO audits, content, lead gen, delivery + invoicing.", integrations: ["cashclaw", "HYRVE API", "picc-cashclaw-hyrve.json"], effort: "medium", expectedValue: "Service revenue", verified: true, sourceUrl: "https://github.com/ertugrulakben/cashclaw", status: "ready" },
  { id: "d-yappr", category: "D", title: "Self-funding X agent (yappr)", description: "npm package yappr runs an agent on X that pays for its own data/LLM/compute from its token's fees. Beta — small experiment, real risk.", whatItAutomates: "Token-funded agent loop on X.", integrations: ["yappr"], effort: "high", expectedValue: "Token fees", verified: true, sourceUrl: "https://github.com/etherlect/yappr", status: "track" },
  // --- E · DePIN --------------------------------------------------------------
  { id: "e-bandwidth", category: "E", title: "Extended bandwidth fleet", description: "Verified additions beyond the current 5 collectors: Mysterium, Proxyrack ($0.50/GB), Bitping, EarnFM ($15 min), ByteLixir, PacketShare ($10 min).", whatItAutomates: "Node health scan + payout thresholds in the automator.", integrations: ["automator", "n8n", "picc-depin-claim-reminders.json"], effort: "low", expectedValue: "More channels", verified: true, sourceUrl: "https://mystnodes.com", status: "ready" },
  { id: "e-storage", category: "E", title: "Storage & compute nodes", description: "Storj (monthly STORJ), io.net (claimable $IO), Helium (claimable HNT). All payouts require manual claiming — PICC reminds.", whatItAutomates: "Claim reminders + node health.", integrations: ["automator", "n8n", "picc-depin-claim-reminders.json"], effort: "medium", expectedValue: "Claim discipline", verified: true, sourceUrl: "https://storj.dev/node/payouts", status: "ready" },
  { id: "e-points", category: "E", title: "Points → airdrop trackers", description: "OpenLoop, BlockMesh, DeNet watcher, Silencio/COIN, Hivello (pivoted away from DePIN Feb 2026). Track usage; no token value until TGE.", whatItAutomates: "Usage streak tracking via quests.", integrations: ["automator quests"], effort: "low", expectedValue: "Airdrop eligibility", verified: true, sourceUrl: "https://docs.openloop.so", status: "track" },
  { id: "e-solar", category: "E", title: "Excess-solar Bitcoin mining", description: "Project Solar Mining is a Home Assistant automation (miners run only on solar export). Rewards land in your own pool wallet.", whatItAutomates: "Hysteresis on/off for ≤3 NerdQAxe++ miners.", integrations: ["Home Assistant"], effort: "medium", expectedValue: "Grid-free BTC", verified: true, sourceUrl: "https://github.com/MalachiRevolts/ProjectSolarMining", status: "track" },
  // --- F · content automation -------------------------------------------------
  { id: "f-monetize", category: "F", title: "Multi-dimensional monetization", description: "MoneyPrinterTurbo + affiliate tweets + local-SEO cold outreach (the MPV2 'dimensions'). Wire publishing via n8n.", whatItAutomates: "Video + affiliate + lead-gen loop.", integrations: ["MoneyPrinterTurbo", "n8n"], effort: "medium", expectedValue: "Multiple income hooks", verified: false, sourceUrl: "", status: "needs_research" },
  { id: "f-aitoearn", category: "F", title: "AiToEarn publishing agent", description: "Electron app automating publishing across 13+ platforms (YouTube/TikTok/X/LinkedIn). Open-core: hosted relay handles platform OAuth.", whatItAutomates: "Create → publish → monetize loop.", integrations: ["AiToEarn"], effort: "medium", expectedValue: "Cross-platform reach", verified: true, sourceUrl: "https://github.com/yikart/AiToEarn", status: "ready" },
  // --- G · stacks ---------------------------------------------------------------
  { id: "g-igm", category: "G", title: "Income Generator (IGM)", description: "Fleet deploy/manage for bandwidth apps with ARM emulation + WebUI. Alive (222★, 2026-07).", whatItAutomates: "Container fleet + proxies + auto-claim.", integrations: ["income-generator"], effort: "medium", expectedValue: "Scale out nodes", verified: true, sourceUrl: "https://github.com/XternA/income-generator", status: "ready" },
  { id: "g-m4b", category: "G", title: "Money4Band (M4B)", description: "Self-updating bandwidth Docker stack (Honeygain, EarnApp, Pawns, PacketStream, Peer2Profit, Repocket, EarnFM, Proxyrack, Bitping). Alive (431★, 2026-08).", whatItAutomates: "Multi-app bandwidth fleet on one device.", integrations: ["money4band"], effort: "low", expectedValue: "More channels, one stack", verified: true, sourceUrl: "https://github.com/MRColorR/money4band", status: "ready" },
  { id: "g-cashpilot", category: "G", title: "CashPilot orchestration", description: "Self-hosted orchestrator + Web UI for bandwidth/DePIN/storage/GPU containers. Note: its n8n community node is archived — use HTTP nodes instead.", whatItAutomates: "Deploy/monitor/restart income containers.", integrations: ["CashPilot", "n8n"], effort: "medium", expectedValue: "Fleet orchestration", verified: true, sourceUrl: "https://github.com/GeiserX/CashPilot", status: "ready" },
  { id: "g-incomeos", category: "G", title: "IncomeOS aggregation", description: "Self-hosted passive-income dashboard (Next.js + Supabase, MCP included). Early-stage project (2026-06) — verify before adopting.", whatItAutomates: "Aggregate Stripe/affiliates/manual revenue.", integrations: ["IncomeOS"], effort: "medium", expectedValue: "One revenue view", verified: true, sourceUrl: "https://github.com/Perufitlife/incomeos", status: "track" },
  { id: "g-firefly", category: "G", title: "Firefly III accounting", description: "Self-hosted double-entry personal finance with a REST API (OAuth2 or personal-access tokens) — PICC pushes income snapshots to it via n8n.", whatItAutomates: "Every income row lands in real accounting.", integrations: ["Firefly III API", "n8n", "picc-firefly-sync.json"], effort: "low", expectedValue: "Trustworthy books", verified: true, sourceUrl: "https://api-docs.firefly-iii.org", status: "ready" },
  { id: "g-lmstudio", category: "G", title: "Local LLM (LM Studio)", description: "Run models locally for zero API cost; use as the LLM provider for the automator assistant and crews.", whatItAutomates: "Offline reasoning for PICC helpers.", integrations: ["LM Studio"], effort: "low", expectedValue: "No API spend", verified: true, sourceUrl: "https://lmstudio.ai", status: "ready" }
]

// ---------------------------------------------------------------------------
// CrewAI crews wired to the agents microservice (agents/picc_agents/crew.py)
// ---------------------------------------------------------------------------
export const AGENT_CATALOG = [
  { id: "research", name: "Research crew", agents: ["researcher", "analyst"], description: "General + financial research reports.", status: "ready" },
  { id: "content", name: "Content crew", agents: ["researcher", "analyst", "content_creator"], description: "Platform-ready blog/YouTube content.", status: "ready" },
  { id: "listing", name: "Listing crew", agents: ["listing_analyst"], description: "Amazon listing suggestions.", status: "ready" },
  { id: "trading", name: "Trading crew", agents: ["trading_strategist"], description: "Trading Suite signal commentary.", status: "ready" },
  { id: "investment", name: "Investment crew", agents: ["defi_analyst", "nft_royalty_analyst"], description: "DeFi / staking / NFT strategy.", status: "ready" },
  { id: "bounty", name: "Bounty crew", agents: ["bounty_hunter"], description: "AIGEN bounty shortlist with first steps.", status: "ready" },
  { id: "cashclaw", name: "CashClaw crew", agents: ["cashclaw_hunter"], description: "Crypto rewards recovery audit.", status: "ready" },
  { id: "depin", name: "DePIN crew", agents: ["depin_optimizer"], description: "Network / uptime optimization report.", status: "ready" },
  { id: "strategist", name: "Strategist crew", agents: ["content_strategist"], description: "Content strategy tied to real income streams.", status: "ready" },
  { id: "monitor", name: "Monitor crew", agents: ["yield_monitor", "fleet_monitor"], description: "Yield + DePIN fleet health digest (new).", status: "ready" }
]

// ---------------------------------------------------------------------------
// n8n workflow templates — reads the real files in infra/n8n/workflows and
// merges in curated descriptions. Falls back gracefully when the repo layout
// is missing (e.g. in tests / packaged builds).
// ---------------------------------------------------------------------------
const DEFAULT_WORKFLOWS_DIR = fileURLToPath(new URL("../../../../infra/n8n/workflows", import.meta.url))

const WORKFLOW_NOTES = {
  "picc-bounty-monitor.json": { description: "AIGEN bounty board → skill filter → assignment alert.", triggers: ["schedule"] },
  "picc-content-pipeline.json": { description: "Faceless video pipeline via MoneyPrinter-style generator.", triggers: ["schedule"] },
  "picc-content-studio.json": { description: "Content Studio draft → publish queue.", triggers: ["webhook"] },
  "picc-depin-aggregator.json": { description: "Aggregate DePIN earnings from multiple sources.", triggers: ["schedule"] },
  "picc-depin-health.json": { description: "Node health scores → offline alert + restart.", triggers: ["schedule"] },
  "picc-income-aggregator.json": { description: "CashPilot + IGM earnings → merged store.", triggers: ["schedule"] },
  "picc-listing-optimizer.json": { description: "Listing analysis webhook for the optimizer.", triggers: ["webhook"] },
  "picc-moneymaker-pipeline.json": { description: "MoneyPrinterV2 scheduled run + upload.", triggers: ["schedule"] },
  "picc-simulator.json": { description: "Financial Twin simulation webhook.", triggers: ["webhook"] },
  "picc-staking-monitor.json": { description: "Staking/DeFi yield snapshot + AI analysis (now keyless DefiLlama).", triggers: ["webhook"] },
  "picc-trading-signal.json": { description: "Trading signals → commentary alert.", triggers: ["schedule"] },
  "picc-yield-monitor-llama.json": { description: "Keyless DefiLlama APY monitor (no paid StakingRewards key).", triggers: ["webhook", "schedule"] },
  "picc-firefly-sync.json": { description: "Push PICC income snapshot rows into Firefly III.", triggers: ["webhook"] },
  "picc-agent-bounties.json": { description: "Agent-economy board scan (three.ws + AIGEN) → skill filter.", triggers: ["schedule"] },
  "picc-cashclaw-hyrve.json": { description: "CashClaw HYRVE job poll → PICC log.", triggers: ["schedule"] },
  "picc-depin-claim-reminders.json": { description: "Manual-claim reminders (io.net / Helium / Storj).", triggers: ["schedule"] },
  "picc-moneyprinterturbo.json": { description: "MoneyPrinterTurbo scheduled pipeline.", triggers: ["schedule"] }
}

export function workflowsDir() {
  return process.env.PICC_N8N_WORKFLOWS_DIR || DEFAULT_WORKFLOWS_DIR
}

function triggerOf(flow) {
  const types = (flow?.nodes ?? []).map((n) => n.type ?? "")
  if (types.includes("n8n-nodes-base.scheduleTrigger")) return "schedule"
  if (types.includes("n8n-nodes-base.webhook")) return "webhook"
  return "manual"
}

export async function listWorkflows() {
  const dir = workflowsDir()
  const files = []
  let dirFound = true
  try {
    const entries = await readdir(dir)
    for (const f of entries.filter((f) => f.endsWith(".json")).sort()) {
      try {
        const raw = JSON.parse(await readFile(join(dir, f), "utf8"))
        files.push({
          file: f,
          name: String(raw.name ?? f.replace(/\.json$/, "")),
          nodes: Array.isArray(raw.nodes) ? raw.nodes.length : 0,
          triggers: Array.from(new Set((raw.nodes ?? []).map((n) => triggerOf(n)).filter(Boolean)))
        })
      } catch {
        files.push({ file: f, name: f.replace(/\.json$/, ""), nodes: 0, triggers: [], unparsed: true })
      }
    }
  } catch {
    dirFound = false
  }
  const merged = files.map((f) => ({
    ...f,
    description: WORKFLOW_NOTES[f.file]?.description ?? "n8n workflow template — import and wire your credentials.",
    install: "n8n → Workflows → Import from File"
  }))
  // Even without the repo, expose the known templates so the UI never breaks.
  const embedded = Object.keys(WORKFLOW_NOTES)
    .filter((f) => !files.some((x) => x.file === f))
    .map((f) => ({
      file: f,
      name: f.replace(/\.json$/, "").replace(/^picc-/, ""),
      nodes: 0,
      triggers: WORKFLOW_NOTES[f].triggers,
      description: WORKFLOW_NOTES[f].description,
      install: "n8n → Workflows → Import from File",
      embedded: true
    }))
  return { ok: true, dir, dirFound, count: merged.length + embedded.length, workflows: [...merged, ...embedded] }
}

// ---------------------------------------------------------------------------
// Agent-economy bounty boards — live reachability + light parsing.
// Honest failure: a board that is unreachable is reported as such.
// ---------------------------------------------------------------------------
export const BOUNTY_BOARDS = [
  { id: "aigen", name: "AIGEN Protocol", url: "https://cryptogenesis.duckdns.org/work/board", kind: "json", note: "On-chain bounty board (Base/Optimism). Public board was intermittent in Aug 2026." },
  { id: "agora-three", name: "Agora ($THREE) · labor market", url: "https://three.ws/labor-market", kind: "html", note: "On-chain job board for agents + humans, escrow in $THREE on Solana." }
]

async function fetchWithTimeout(url, ms = 6000) {
  const r = await fetch(url, {
    headers: { "User-Agent": "PICC-dashboard/0.2.0", Accept: "application/json,text/html" },
    signal: AbortSignal.timeout(ms)
  })
  return r
}

async function scanBoard(board) {
  const out = { ...board, reachable: false, entries: [], error: null }
  try {
    const r = await fetchWithTimeout(board.url)
    if (!r.ok) {
      out.error = `HTTP ${r.status}`
      return out
    }
    out.reachable = true
    const text = await r.text()
    if (board.kind === "json") {
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        payload = null
      }
      const items = Array.isArray(payload) ? payload : payload?.missions ?? payload?.bounties ?? []
      out.entries = Array.isArray(items) ? items.slice(0, 20) : []
      out.count = Array.isArray(items) ? items.length : 0
    } else {
      const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? ""
      const snippet = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
      out.pageTitle = title
      out.snippet = snippet
      out.entries = []
      out.count = 0
    }
  } catch (err) {
    out.error = err.name === "TimeoutError" || /timeout/i.test(String(err.message)) ? "timeout — board unreachable" : String(err.message ?? err)
  }
  return out
}

export async function monitorBountyBoards() {
  const boards = await Promise.all(BOUNTY_BOARDS.map(scanBoard))
  return { ok: true, checkedAt: new Date().toISOString(), boards }
}

// ---------------------------------------------------------------------------
// Convenience envelope for the dashboard endpoints
// ---------------------------------------------------------------------------
export async function opportunityCatalog() {
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    categories: CATEGORIES,
    opportunities: OPPORTUNITY_CATALOG,
    agents: AGENT_CATALOG
  }
}
