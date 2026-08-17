// PICC Automator — Tier 0 income operations service.
//
// Combines three data paths into one coherent "stream status" for the
// dashboard and the browser-extension overlay:
//
//   1. Live provider collectors  (Honeygain, Pawns, Traffmonetizer, Repocket,
//      EarnApp) using credentials the user owns. Polled politely with a TTL cache (min 5 min
//      between polls) — this is a courteous-client rate limit, not evasion.
//   2. The dashboard's own stream data, pushed to us as a snapshot so the
//      extension can show platforms that have no public earner API
//      (PacketStream, Repocket, Grass, Nodepay, mobile apps, ...).
//   3. A daily-quest catalog + presence heartbeat (keep-alive) so "being
//      online" and "daily actions" are tracked instead of guessed.
//
// Human-review rule: every action that spends or commits real value is
// surfaced as a suggestion with a manual confirmation. Nothing here posts,
// buys, submits, or claims on the user's behalf.

import { execFile } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  fetchEarnAppSnapshot,
  fetchHoneygainSnapshot,
  fetchPawnsSnapshot,
  fetchRepocketSnapshot,
  fetchTraffmonetizerSnapshot
} from "./collectors.mjs"

const DATA_DIR = process.env.PICC_AUTOMATOR_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const CREDS_FILE = join(DATA_DIR, "automator-credentials.json")
const SNAPSHOT_FILE = join(DATA_DIR, "streams-snapshot.json")
const PRESENCE_FILE = join(DATA_DIR, "presence.json")

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

// ---------------------------------------------------------------------
// JSON persistence helpers (self-hosted, best-effort)
// ---------------------------------------------------------------------
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJSON(file, value) {
  try {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8")
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify(value, null, 2), "utf8")
        return true
      } catch (retryErr) {
        console.warn(`[picc-automator] write failed ${file}:`, retryErr.message)
        return false
      }
    }
    console.warn(`[picc-automator] write failed ${file}:`, err.message)
    return false
  }
}

// ---------------------------------------------------------------------
// Credentials (stored server-side so the extension overlay can read status)
// ---------------------------------------------------------------------
const DEFAULT_CREDS = {
  honeygainToken: "",
  pawnsEmail: "",
  pawnsPassword: "",
  pawnsToken: "",
  traffmonetizerToken: "",
  repocketEmail: "",
  repocketPassword: "",
  repocketToken: "",
  earnappOAuthToken: "",
  earnappBrdSessionId: "",
  pollIntervalMinutes: 15
}

export async function getCredentials() {
  const saved = await readJSON(CREDS_FILE, {})
  return { ...DEFAULT_CREDS, ...saved }
}

export async function saveCredentials(patch) {
  const next = { ...(await getCredentials()), ...sanitizePatch(patch) }
  next.pollIntervalMinutes = clampPoll(next.pollIntervalMinutes)
  await writeJSON(CREDS_FILE, next)
  // Provider cache may hold stale results — clear so a new token takes effect.
  providerCache.clear()
  return getCredentials()
}

function sanitizePatch(patch) {
  const out = {}
  // Blank credential fields mean "keep the saved value" — the UI never sends
  // masked secrets back, so an empty string would otherwise wipe a token on
  // every unrelated settings save.
  const str = (k) => {
    if (typeof patch[k] === "string" && patch[k].trim()) out[k] = patch[k].trim()
  }
  str("honeygainToken")
  str("pawnsEmail")
  str("pawnsPassword")
  str("pawnsToken")
  str("traffmonetizerToken")
  str("repocketEmail")
  str("repocketPassword")
  str("repocketToken")
  str("earnappOAuthToken")
  str("earnappBrdSessionId")
  if (patch.pollIntervalMinutes != null) out.pollIntervalMinutes = Number(patch.pollIntervalMinutes)
  return out
}

function clampPoll(minutes) {
  const v = Number(minutes) || 15
  return Math.min(60, Math.max(5, Math.round(v)))
}

// ---------------------------------------------------------------------
// Polite polling cache (TTL-backed, no hammering)
// ---------------------------------------------------------------------
const providerCache = new Map() // slug -> { at, data }

function estimatedDailyFrom(daily, windowDays = 30) {
  if (!Array.isArray(daily) || daily.length < 3) return 0
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - windowDays)
  const since = cutoff.toISOString().slice(0, 10)
  const days = daily.filter((d) => d.date >= since && d.usd > 0)
  if (days.length < 3) return 0
  const total = days.reduce((acc, d) => acc + d.usd, 0)
  return Math.round((total / windowDays) * 100) / 100
}

// ---------------------------------------------------------------------
// JWT helper — decodes the `exp` claim of a session token so we can warn
// before it expires (Traffmonetizer tokens are 7-day JWTs). No deps.
// ---------------------------------------------------------------------
function base64UrlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/")
  const pad = "=".repeat((4 - (b64.length % 4)) % 4)
  return Buffer.from(b64 + pad, "base64").toString("utf8")
}

export function jwtInfo(token) {
  if (typeof token !== "string" || !token) return { valid: false }
  const parts = token.split(".")
  if (parts.length !== 3) return { valid: false }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    const expSec = Number(payload?.exp)
    if (!Number.isFinite(expSec) || expSec <= 0) return { valid: false }
    const expMs = expSec * 1000
    return {
      valid: true,
      exp: expSec,
      expiresAt: new Date(expMs).toISOString(),
      daysLeft: Math.round(((expMs - Date.now()) / 86_400_000) * 10) / 10
    }
  } catch {
    return { valid: false }
  }
}

// Providers whose session token is a JWT we can monitor for expiry.
const JWT_TOKEN_FIELDS = {
  traffmonetizer: "traffmonetizerToken",
  pawns: "pawnsToken",
  repocket: "repocketToken"
}

function fmtUsd(n) {
  return `$${Number(n || 0).toFixed(2)}`
}

// ---------------------------------------------------------------------
// Main status: providers + manual snapshot merge
// ---------------------------------------------------------------------
export async function automatorStatus() {
  const creds = await getCredentials()
  const ttlMs = clampPoll(creds.pollIntervalMinutes) * 60_000

  const providers = {}
  const entries = [
    ["honeygain", "Honeygain", creds.honeygainToken, () => fetchHoneygainSnapshot(creds.honeygainToken), { minPayout: 20 }],
    ["pawns", "Pawns", creds.pawnsToken || (creds.pawnsEmail && creds.pawnsPassword), () => fetchPawnsSnapshot(creds.pawnsEmail, creds.pawnsPassword, creds.pawnsToken), { minPayout: 5 }],
    ["traffmonetizer", "Traffmonetizer", creds.traffmonetizerToken, () => fetchTraffmonetizerSnapshot(creds.traffmonetizerToken), { minPayout: 10 }],
    ["repocket", "Repocket", creds.repocketToken || (creds.repocketEmail && creds.repocketPassword), () => fetchRepocketSnapshot(creds.repocketEmail, creds.repocketPassword, creds.repocketToken), { minPayout: 10 }],
    ["earnapp", "EarnApp", creds.earnappOAuthToken, () => fetchEarnAppSnapshot(creds.earnappOAuthToken, creds.earnappBrdSessionId), { minPayout: 5 }]
  ]

  await Promise.all(
    entries.map(async ([slug, label, cred, poller, defs]) => {
      const cached = providerCache.get(slug)
      if (cached && Date.now() - cached.at < ttlMs) {
        const { ok, ...rest } = cached.data
        providers[slug] = {
          slug,
          platform: label,
          configured: Boolean(cred),
          status: ok ? "ok" : "error",
          ...rest,
          error: ok ? null : cached.data.error ?? null,
          lastChecked: cached.at
        }
        return
      }
      if (!cred) {
        providers[slug] = {
          slug,
          platform: label,
          configured: false,
          status: "not_configured",
          balance: null,
          payoutThreshold: defs.minPayout,
          error: null,
          lastChecked: null
        }
        return
      }
      const started = Date.now()
      try {
        const data = await poller()
        providerCache.set(slug, { at: Date.now(), data: { ok: true, ...data } })
        providers[slug] = {
          slug,
          platform: label,
          configured: true,
          status: "ok",
          ...data,
          estimatedDaily: estimatedDailyFrom(data.daily),
          error: null,
          lastChecked: Date.now(),
          fetchedMs: Date.now() - started
        }
      } catch (err) {
        providerCache.set(slug, { at: Date.now(), data: { ok: false, error: err.message } })
        providers[slug] = {
          slug,
          platform: label,
          configured: true,
          status: "error",
          balance: null,
          error: err.message ?? "provider unreachable",
          lastChecked: Date.now()
        }
      }
    })
  )

  // Surface session-token expiry for JWT-backed providers so the dashboard
  // can warn before a token silently stops working.
  for (const [slug, field] of Object.entries(JWT_TOKEN_FIELDS)) {
    const info = jwtInfo(creds[field])
    if (!info.valid || !providers[slug]) continue
    providers[slug] = {
      ...providers[slug],
      tokenExpiresAt: info.expiresAt,
      tokenExpiresInDays: info.daysLeft
    }
  }

  const snapshot = await getSnapshot()
  const autoSlugs = new Set(entries.map(([slug]) => slug))
  const manual = (snapshot.streams ?? [])
    .filter((s) => !autoSlugs.has(s.platform.toLowerCase()))
    .map((s) => ({
      id: s.id,
      name: s.name,
      platform: s.platform,
      category: s.category ?? "bandwidth",
      status: s.status ?? "active",
      balance: Number(s.balance) || 0,
      totalEarned: Number(s.totalEarned) || 0,
      payoutThreshold: Number(s.payoutThreshold) || 0,
      estimatedDaily: Number(s.estimatedDaily) || 0,
      url: s.url,
      lastCollected: s.lastCollected ?? null
    }))

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    pollIntervalMinutes: clampPoll(creds.pollIntervalMinutes),
    providers,
    manual
  }
}

// ---------------------------------------------------------------------
// Dashboard stream snapshot (extension overlay data path for no-API platforms)
// ---------------------------------------------------------------------
export async function getSnapshot() {
  const saved = await readJSON(SNAPSHOT_FILE, {})
  return {
    streams: Array.isArray(saved.streams) ? saved.streams : [],
    earnings: Array.isArray(saved.earnings) ? saved.earnings : [],
    updatedAt: saved.updatedAt ?? null
  }
}

export async function saveSnapshot(body) {
  const streams = Array.isArray(body?.streams)
    ? body.streams.slice(0, 500).map((s) => ({
        id: String(s?.id ?? ""),
        name: String(s?.name ?? "Unnamed"),
        platform: String(s?.platform ?? s?.name ?? ""),
        category: String(s?.category ?? "bandwidth"),
        status: String(s?.status ?? "active"),
        balance: Number(s?.balance) || 0,
        totalEarned: Number(s?.totalEarned) || 0,
        payoutThreshold: Number(s?.payoutThreshold) || 0,
        estimatedDaily: Number(s?.estimatedDaily) || 0,
        url: String(s?.url ?? ""),
        lastCollected: s?.lastCollected ?? null
      }))
    : []
  const earnings = Array.isArray(body?.earnings) ? body.earnings.slice(0, 2000) : []
  const updatedAt = new Date().toISOString()
  await writeJSON(SNAPSHOT_FILE, { streams, earnings, updatedAt })
  return { ok: true, streams: streams.length, updatedAt }
}

// ---------------------------------------------------------------------
// Presence / keep-alive (shows the extension is online; no stealth)
// ---------------------------------------------------------------------
export async function recordPresence(device) {
  const name = String(device ?? "extension").slice(0, 40) || "unknown"
  const current = await readJSON(PRESENCE_FILE, { devices: {} })
  const devices = { ...current.devices }
  devices[name] = new Date().toISOString()
  // Keep the map bounded.
  const trimmed = Object.fromEntries(Object.entries(devices).slice(-20))
  await writeJSON(PRESENCE_FILE, { devices: trimmed, updatedAt: new Date().toISOString() })
  return { ok: true, device: name, ts: devices[name] }
}

export async function presenceStatus() {
  const current = await readJSON(PRESENCE_FILE, { devices: {} })
  const now = Date.now()
  const devices = Object.fromEntries(
    Object.entries(current.devices ?? {}).map(([name, ts]) => [
      name,
      { ts, minutesAgo: Math.round((now - new Date(ts).getTime()) / 60000) }
    ])
  )
  return { ok: true, devices, updatedAt: current.updatedAt ?? null }
}

// ---------------------------------------------------------------------
// Node scan — detects installed/running sharing apps on this machine
// (Windows: tasklist; Unix: ps). Plus Docker containers.
// ---------------------------------------------------------------------
const NODES = [
  // Bandwidth sharing
  { id: "honeygain", name: "Honeygain", category: "bandwidth", match: "honeygain", container: "honeygain", notes: "Desktop/Android app; container on Pi." },
  { id: "iproyal", name: "IPRoyal Pawns", category: "bandwidth", match: ["pawns", "iproyal"], container: "pawns", notes: "Windows/Android; cli container on Pi." },
  { id: "traffmonetizer", name: "Traffmonetizer", category: "bandwidth", match: ["traffmonetizer", "traff_monetizer"], container: "traffmonetizer", notes: "cli_v2 container recommended (auto-update)." },
  { id: "repocket", name: "Repocket", category: "bandwidth", match: "repocket", container: "repocket", notes: "Container uses RP_EMAIL + RP_API_KEY." },
  { id: "packetstream", name: "PacketStream", category: "bandwidth", match: ["packetstream", "packeter"], container: null, notes: "Desktop app only — no container." },
  { id: "earnapp", name: "EarnApp", category: "bandwidth", match: ["earnapp", "easy earning"], container: null, notes: "Desktop app only — EarnApp ToS prohibits Docker/VMs/home servers (termination + cancelled payouts)." },
  { id: "mysterium", name: "Mysterium", category: "bandwidth", match: ["myst_node", "mysterium"], container: "myst_node", notes: "DePIN VPN node; container on Pi. Settle MYST at ≥5 (20% network fee)." },
  { id: "grass", name: "Grass", category: "bandwidth", match: "grass", container: "grass", notes: "Browser-extension style; app on desktop." },
  { id: "gradient", name: "Gradient", category: "bandwidth", match: "gradient", container: null, notes: "Desktop app." },
  { id: "peer2profit", name: "Peer2Profit", category: "bandwidth", match: "peer2profit", container: "peer2profit", notes: "Registrations closed (2023); existing users still earn via Telegram bot + Android/macOS app." },
  { id: "proxyrack", name: "Proxyrack", category: "bandwidth", match: "proxyrack", container: null, notes: "Desktop app; $0.50/GB residential, $0.05/GB datacenter; min $5 payout via Tremendous." },
  { id: "bitping", name: "Bitping", category: "bandwidth", match: ["bitpingd", "bitping"], container: "bitping", notes: "Node + Docker; Solana-only payout since Jan 2025." },
  { id: "earnfm", name: "EarnFM", category: "bandwidth", match: ["earnfm", "earn_fm"], container: "earnfm", notes: "Desktop/mobile; min $15 via PayPal/crypto/gift cards." },
  { id: "bytelixir", name: "ByteLixir", category: "bandwidth", match: "bytelixir", container: null, notes: "Windows/Android; $0.25–0.85/GB; min $2–5, PayPal/USDT/USDC, no KYC." },
  { id: "blockmesh", name: "BlockMesh", category: "bandwidth", match: ["blockmesh", "obfhoiefijlolgdmphcekifedagnkfjp"], container: "blockmesh", notes: "Browser extension + node; points → $BMH airdrop (unfinalized)." },
  { id: "gridlink", name: "GridLink", category: "bandwidth", match: "gridlink", container: null, notes: "Android relay; testnet prototype as of 2026 — no official app/site, treat as experimental." },
  { id: "openloop", name: "OpenLoop", category: "bandwidth", match: ["openloop", "sentry"], container: "openloop", notes: "Browser Sentry extension; points → $OPL at TGE (not launched)." },
  { id: "hivello", name: "Hivello", category: "bandwidth", match: "hivello", container: null, notes: "DePIN node app discontinued Jan 2026 — pivoted to Bitcoin cloud mining." },
  // Storage & compute sharing
  { id: "storj", name: "Storj Node", category: "storage", match: ["storagenode", "storj"], container: "storagenode", notes: "Monthly payouts (L1/zkSync); first 9 months partially withheld." },
  { id: "filecoin", name: "Filecoin", category: "storage", match: ["lotus", "filecoin"], container: "filecoin", notes: "Sealed-storage node; FIL from deals + block rewards." },
  { id: "ionet", name: "io.net", category: "compute", match: ["ionet", "io_net", "worker"], container: "worker", notes: "GPU/CPU worker; $IO block rewards hourly, job payments daily — rewards must be claimed; staking required for block rewards." },
  // Environmental & data
  { id: "silencio", name: "Silencio", category: "environmental", match: "silencio", container: null, notes: "Mobile noise-mapping; daily recording keeps streak multiplier (up to 250%)." },
  { id: "coin", name: "COIN (XYO)", category: "environmental", match: ["coin", "xyo"], container: null, notes: "Mobile geomining; Auto-Explore built in, weekly Bonus Drop." },
  { id: "rustchain", name: "RustChain", category: "environmental", match: "rustchain", container: "rustchain", notes: "Proof-of-Antiquity miner; hobby-scale (~5 nodes), thin wRTC liquidity." }
]

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      resolve(err ? "" : String(stdout))
    })
  })
}

async function runningProcesses() {
  const out = await (process.platform === "win32" ? run("tasklist", ["/FO", "CSV", "/NH"]) : run("ps", ["-eo", "comm"]))
  const names = new Set()
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/"([^"]+\.exe)"/) // CSV: "name.exe","pid",...
    const name = m?.[1] ?? line.trim().split(/\s+/)[0]
    if (name) names.add(name.toLowerCase().replace(/\.exe$/i, ""))
  }
  return names
}

async function dockerContainers() {
  const out = await run("docker", ["ps", "--format", "{{.Names}}"])
  return out.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}

export async function scanNodes() {
  const [procs, containers] = await Promise.all([runningProcesses(), dockerContainers()])
  return NODES.map((n) => {
    const matches = Array.isArray(n.match) ? n.match : [n.match]
    const process = matches.some((m) => procs.has(m.toLowerCase()))
    const docker = n.container ? containers.includes(n.container.toLowerCase()) : false
    return {
      id: n.id,
      name: n.name,
      category: n.category ?? "bandwidth",
      process,
      docker,
      detected: process || docker,
      notes: n.notes
    }
  })
}

// ---------------------------------------------------------------------
// Daily quest catalog (curated from public provider docs, verified 2026)
// ---------------------------------------------------------------------
export const QUEST_CATALOG = [
  { id: "sil-measure", platform: "Silencio", label: "Daily noise measurement", cadence: "daily", device: "mobile", url: "https://www.silencio.network/app", reward: "Coins + streak", note: "One 1–15 min recording keeps the streak multiplier (up to 250%)." },
  { id: "sil-checkin", platform: "Silencio", label: "Venue check-in", cadence: "daily", device: "mobile", url: "https://www.silencio.network/app", reward: "100 coins", note: "Check in at any mapped venue for ~15s." },
  { id: "sil-spin", platform: "Silencio", label: "Magic Box / daily spin", cadence: "daily", device: "mobile", url: "https://www.silencio.network/app", reward: "Bonus coins", note: "Game-of-chance daily reward in-app." },
  { id: "sil-voice", platform: "Silencio", label: "Voice AI clip", cadence: "daily", device: "mobile", url: "https://www.silencio.network/app", reward: "~500 coins / 30s", note: "Read a short prompt; the highest earner ($10–20/hr). Optional." },
  { id: "coin-geomine", platform: "COIN (XYO)", label: "Geomine 1 tile", cadence: "daily", device: "mobile", url: "https://www.coinapp.co", reward: "COIN", note: "Tap the pickaxe. Requires location services; Auto-Explore is built in." },
  { id: "coin-bonus", platform: "COIN (XYO)", label: "Collect weekly Bonus Drop", cadence: "weekly", device: "mobile", url: "https://www.coinapp.co", reward: "COIN Geodrop", note: "Power it up by using the app; Plus/Pro get multipliers." },
  { id: "coin-geoclaim", platform: "COIN (XYO)", label: "Review Geoclaim areas", cadence: "weekly", device: "mobile", url: "https://www.coinapp.co", reward: "COIN", note: "Re-buy claims where you earned; watch premium 10% cut." },
  { id: "hg-lucky", platform: "Honeygain", label: "Spin the daily Lucky Pot", cadence: "daily", device: "web", url: "https://dashboard.honeygain.com", reward: "Credits", note: "Auto-spinnable by PICC (opt-in, safe in-app reward)." },
  { id: "hg-uptime", platform: "Honeygain", label: "Keep a device online", cadence: "daily", device: "web", url: "https://dashboard.honeygain.com", reward: "Credits / MB", note: "More stable uptime = more credits. Check device status." },
  { id: "hg-payout", platform: "Honeygain", label: "Request payout at $20", cadence: "weekly", device: "web", url: "https://dashboard.honeygain.com", reward: "PayPal / JMPT", note: "Threshold $20 (or 0.5 JMPT). PICC alerts when ready." },
  { id: "pw-devices", platform: "Pawns", label: "Confirm devices are earning", cadence: "daily", device: "web", url: "https://pawns.app", reward: "$ / GB", note: "Min payout $5; device count affects earnings." },
  { id: "tm-uptime", platform: "Traffmonetizer", label: "Keep node accepting traffic", cadence: "daily", device: "web", url: "https://app.traffmonetizer.com", reward: "$ / GB", note: "Node must stay connected to earn. Min payout $10." },
  { id: "rp-status", platform: "Repocket", label: "Check dashboard status", cadence: "daily", device: "web", url: "https://repocket.com", reward: "$ / GB", note: "Min payout $10; API key lives in the bandwidth-earnings page. VPS ok at lower rates." },
  { id: "ea-status", platform: "EarnApp", label: "Check dashboard status", cadence: "daily", device: "web", url: "https://earnapp.com", reward: "$ / hour", note: "Min payout ~$5. Desktop app only — ToS bans Docker/VMs/home servers." },
  { id: "ps-status", platform: "PacketStream", label: "Check dashboard status", cadence: "daily", device: "web", url: "https://packetstream.io", reward: "$ / GB", note: "Min payout $5 (3% cashout fee)." },
  { id: "gen-payout", platform: "All", label: "Weekly payout sweep", cadence: "weekly", device: "web", url: "https://repocket.com", reward: "Cash out", note: "Request any balance above its threshold. PICC flags these." },
  // DePIN — verified 2026 monitors
  { id: "mys-settle", platform: "Mysterium", label: "Settle MYST earnings", cadence: "weekly", device: "web", url: "https://mystnodes.com", reward: "MYST", note: "≥5 MYST settles automatically minus a 20% network fee; manual settle anytime." },
  { id: "bit-uptime", platform: "Bitping", label: "Keep node online", cadence: "daily", device: "web", url: "https://app.bitping.com", reward: "$ / job", note: "Payouts are Solana-only; keep ≥ $0.10 SOL for withdrawal rent." },
  { id: "prx-online", platform: "Proxyrack", label: "Confirm device is routing", cadence: "daily", device: "web", url: "https://www.proxyrack.com", reward: "$ / GB", note: "Residential $0.50/GB vs datacenter $0.05/GB; min $5 via Tremendous." },
  { id: "efm-balance", platform: "EarnFM", label: "Check balance + request payout", cadence: "weekly", device: "web", url: "https://earn.fm", reward: "$ / GB", note: "Min $15 via PayPal, Litecoin/USDT, or gift cards." },
  { id: "bxl-status", platform: "ByteLixir", label: "Check dashboard bandwidth", cadence: "daily", device: "web", url: "https://bytelixir.com", reward: "$ / GB", note: "$0.25–0.85/GB depending on IP type; min $2–5, no KYC for sharers." },
  { id: "stj-payout", platform: "Storj", label: "Check monthly node payout", cadence: "weekly", device: "web", url: "http://127.0.0.1:14002/", reward: "STORJ", note: "Monthly payout on Ethereum L1 / zkSync; first 9 months partially withheld." },
  { id: "ion-claim", platform: "io.net", label: "Claim worker rewards", cadence: "daily", device: "web", url: "https://worker.io.net", reward: "$IO", note: "Block rewards accrue hourly and must be claimed; staking is required for block rewards." },
  { id: "hlm-claim", platform: "Helium", label: "Claim HNT rewards", cadence: "weekly", device: "mobile", url: "https://world.helium.com", reward: "HNT", note: "Rewards accrue on hotspots and must be claimed (small SOL fee) — not auto-deposited." },
  { id: "rc-uptime", platform: "RustChain", label: "Keep miner online", cadence: "daily", device: "web", url: "https://rustchain.org", reward: "RTC", note: "Epoch rewards (1.5 RTC/10 min) split by antiquity weight; hobby-scale network." },
  // Agent economy — bounty boards worth a regular scan
  { id: "agora-board", platform: "Agora ($THREE)", label: "Scan the labor-market board", cadence: "weekly", device: "web", url: "https://three.ws/labor-market", reward: "$THREE", note: "On-chain job board for agents + humans; escrow-verified deliverables." },
  { id: "aigen-board", platform: "AIGEN Protocol", label: "Check the bounty board", cadence: "weekly", device: "web", url: "https://github.com/Aigen-Protocol/aigen-protocol", reward: "USDC / ETH / AIGEN", note: "Public board is intermittent (was unreachable in Aug 2026) — verify before committing." },
  // Crypto yield — reference checks (read-only)
  { id: "yield-review", platform: "DeFiLlama", label: "Review top yields", cadence: "weekly", device: "web", url: "https://defillama.com/yields", reward: "Optimization", note: "Keyless aggregator covering Lido, Jito, Aave, Compound, Pendle, Yearn APYs." },
  { id: "eig-restake", platform: "EigenLayer", label: "Review restaked positions", cadence: "weekly", device: "web", url: "https://app.eigenlayer.xyz", reward: "Extra yield", note: "Blended ~3.8–6% APY (base staking + AVS fees); looped leverage adds real liquidation risk." }
]

// ---------------------------------------------------------------------
// Rule engine — deterministic, honest "helpers" derived from status + node
// scan. Powers the health panel and the local fallback of the assistant.
// ---------------------------------------------------------------------
const NODE_TO_PROVIDER = {
  honeygain: "honeygain",
  iproyal: "pawns",
  traffmonetizer: "traffmonetizer",
  repocket: "repocket",
  earnapp: "earnapp"
}

export function automatorIssuesFrom(status, nodes = []) {
  const issues = []
  for (const p of Object.values(status?.providers ?? {})) {
    const balance = Number(p.balance) || 0
    const threshold = Number(p.payoutThreshold) || 0
    if (p.status === "error") {
      issues.push({
        severity: "danger",
        topic: "collector",
        platform: p.platform,
        message: p.error ?? "Collector failed on the last check."
      })
    } else if (p.status === "ok" && threshold > 0) {
      if (balance >= threshold) {
        issues.push({
          severity: "success",
          topic: "payout",
          platform: p.platform,
          message: `Balance ${fmtUsd(balance)} meets the ${fmtUsd(threshold)} threshold — request the payout manually.`
        })
      } else if ((Number(p.estimatedDaily) || 0) <= 0) {
        issues.push({
          severity: "info",
          topic: "eta",
          platform: p.platform,
          message: "No ETA yet — needs at least 3 days of balance history."
        })
      }
    }
    if (p.tokenExpiresInDays != null) {
      if (p.tokenExpiresInDays < 0) {
        issues.push({
          severity: "danger",
          topic: "credential",
          platform: p.platform,
          message: "Session token has expired — paste a fresh one."
        })
      } else if (p.tokenExpiresInDays <= 7) {
        issues.push({
          severity: "warn",
          topic: "credential",
          platform: p.platform,
          message: `Session token expires in ${Math.max(1, Math.ceil(p.tokenExpiresInDays))} day(s) — refresh before then.`
        })
      }
    }
  }
  for (const n of nodes ?? []) {
    const slug = NODE_TO_PROVIDER[n.id]
    if (!slug || !status?.providers?.[slug]?.configured) continue
    issues.push(
      n.detected
        ? { severity: "success", topic: "node", platform: n.name, message: "Node is running on this machine." }
        : { severity: "info", topic: "node", platform: n.name, message: "Configured but not detected locally — check the Pi or other devices." }
    )
  }
  return issues
}

export function automatorTotals(status, nodes = []) {
  const providers = Object.values(status?.providers ?? {})
  const ready =
    providers.filter(
      (p) => p.status === "ok" && Number(p.payoutThreshold) > 0 && (Number(p.balance) || 0) >= Number(p.payoutThreshold)
    ).length +
    (status?.manual ?? []).filter((m) => Number(m.payoutThreshold) > 0 && Number(m.balance) >= Number(m.payoutThreshold)).length
  return {
    configured: providers.filter((p) => p.configured).length,
    ready,
    nodesDetected: (nodes ?? []).filter((n) => n.detected).length,
    nodesTotal: (nodes ?? []).length
  }
}

// ---------------------------------------------------------------------
// Provider detail helper for a single platform (used by overlays)
// ---------------------------------------------------------------------
export async function providerDetail(slug) {
  const status = await automatorStatus()
  const provider = status.providers?.[slug] ?? null
  const manual = (status.manual ?? []).filter(
    (s) => s.platform.toLowerCase() === slug.toLowerCase()
  )
  return { ok: true, provider, manual, updatedAt: status.updatedAt }
}
