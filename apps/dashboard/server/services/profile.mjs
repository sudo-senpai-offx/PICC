// ---------------------------------------------------------------------
// Profile service — settings + linked accounts.
//
// Google / email accounts are "linked" by storing the sign-in details
// in the browser vault (see browserStudio.saveSiteCredentials) and
// recording the link here.
//
// GitHub is linked with a real OAuth Authorization Code flow using
// PKCE (S256). The token stays server-side and is never exposed to the
// browser; the flow needs a publicly reachable dashboard to receive the
// callback, or the embedded-browser redirect capture below.
// ---------------------------------------------------------------------
import { randomBytes, createHash } from "node:crypto"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const DATA_DIR = process.env.PICC_PROFILE_DATA_DIR || process.env.PICC_AUTH_DATA_DIR || join(__dirname, "..", "data")
const FILE = join(DATA_DIR, "profile.json")

const GITHUB_AUTH_ENDPOINT = "https://github.com/login/oauth/authorize"
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token"
const GITHUB_API_ENDPOINT = "https://api.github.com"
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

// state -> { userId, codeVerifier, redirectUri, expiresAt }
const pendingStates = new Map()

async function readStore() {
  try {
    return JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(FILE, "utf8")))
  } catch {
    return { users: {} }
  }
}

async function writeStore(store) {
  try {
    const fs = await import("node:fs/promises")
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(FILE, JSON.stringify(store, null, 2))
  } catch (err) {
    console.error(`[picc-profile] write failed ${FILE}:`, err.message)
    throw err
  }
}

function entryOf(store, userId) {
  if (!store.users[userId]) store.users[userId] = { name: "", links: {}, githubOauth: {} }
  return store.users[userId]
}

function publicGithubOauth(cfg = {}) {
  return { clientId: cfg.clientId ?? "", hasSecret: Boolean(cfg.clientSecret) }
}

// ---------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------
export async function getProfile(userId) {
  const store = await readStore()
  const e = entryOf(store, userId)
  const links = {}
  for (const provider of Object.keys(e.links)) {
    const l = e.links[provider]
    links[provider] = { username: l?.username ?? "", linkedAt: l?.linkedAt ?? null }
  }
  return { ok: true, name: e.name ?? "", links, githubOauth: publicGithubOauth(e.githubOauth) }
}

export async function updateProfileName(userId, name) {
  const store = await readStore()
  const e = entryOf(store, userId)
  e.name = String(name ?? "").slice(0, 120)
  await writeStore(store)
  return { ok: true, name: e.name }
}

// ---------------------------------------------------------------------
// Linked accounts (Google / email / GitHub)
// ---------------------------------------------------------------------
export async function linkIdentity(userId, provider, { username, password } = {}) {
  const store = await readStore()
  const e = entryOf(store, userId)
  const uname = String(username ?? "").trim()
  if (!uname) return { ok: false, error: "username is required" }
  e.links[provider] = {
    username: uname,
    passwordHint: password ? "•••" : "",
    linkedAt: e.links[provider]?.linkedAt ?? new Date().toISOString()
  }
  await writeStore(store)
  return { ok: true, provider, username: uname }
}

export async function unlinkIdentity(userId, provider) {
  const store = await readStore()
  const e = entryOf(store, userId)
  const had = Boolean(e.links[provider])
  delete e.links[provider]
  await writeStore(store)
  return { ok: true, provider, unlinked: had }
}

// ---------------------------------------------------------------------
// GitHub OAuth
// ---------------------------------------------------------------------
export async function saveGithubOauth(userId, { clientId, clientSecret } = {}) {
  const store = await readStore()
  const e = entryOf(store, userId)
  const id = String(clientId ?? "").trim()
  if (!id) return { ok: false, error: "GitHub Client ID is required" }
  const cfg = e.githubOauth ?? {}
  // Blank secret means "keep the stored secret".
  cfg.clientId = id
  if (typeof clientSecret === "string" && clientSecret.length > 0) cfg.clientSecret = clientSecret.trim()
  e.githubOauth = cfg
  await writeStore(store)
  return { ok: true, ...publicGithubOauth(cfg) }
}

async function githubOauthConfig(userId) {
  const store = await readStore()
  const cfg = entryOf(store, userId).githubOauth ?? {}
  if (!cfg.clientId) throw new Error("GitHub OAuth is not configured — set your Client ID/Secret in Profile first")
  if (!cfg.clientSecret) throw new Error("GitHub OAuth Client Secret is not saved")
  return cfg
}

export async function beginGithubOauth(userId, redirectUri) {
  const cfg = await githubOauthConfig(userId)
  const state = randomBytes(18).toString("hex")
  const codeVerifier = Buffer.from(randomBytes(32)).toString("base64url")
  const codeChallenge = Buffer.from(createHash("sha256").update(codeVerifier).digest()).toString("base64url")
  pendingStates.set(state, {
    userId,
    codeVerifier,
    redirectUri,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS
  })
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  })
  return { authorizeUrl: `${GITHUB_AUTH_ENDPOINT}?${params.toString()}`, state, callbackUrl: redirectUri }
}

export async function completeGithubOauth({ code = "", state = "" } = {}) {
  const pending = pendingStates.get(state)
  if (!pending) return { ok: false, error: "This link has expired or was already used — start again from the Profile page." }
  if (Date.now() > pending.expiresAt) {
    pendingStates.delete(state)
    return { ok: false, error: "This link has expired — start again from the Profile page." }
  }
  pendingStates.delete(state)

  const cfg = await githubOauthConfig(pending.userId).catch(() => null)
  if (!cfg) return { ok: false, error: "GitHub OAuth is no longer configured — set it up again in Profile." }

  let tokenResult = {}
  try {
    tokenResult = await fetch(GITHUB_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.codeVerifier
      })
    }).then((r) => r.json())
  } catch {
    /* network failure handled below */
  }
  if (!tokenResult.access_token) {
    return { ok: false, error: tokenResult.error_description || tokenResult.error || "Could not reach GitHub — try again." }
  }

  const ghHeaders = { Authorization: `Bearer ${tokenResult.access_token}`, Accept: "application/vnd.github+json" }
  let ghUser = {}
  try {
    ghUser = await fetch(`${GITHUB_API_ENDPOINT}/user`, { headers: ghHeaders }).then((r) => r.json())
  } catch {
    /* handled below */
  }
  const username = ghUser?.login ?? ""
  let email = ghUser?.email ?? ""
  if (!email) {
    try {
      const emails = await fetch(`${GITHUB_API_ENDPOINT}/user/emails`, { headers: ghHeaders }).then((r) => r.json())
      email = (Array.isArray(emails) ? emails.find((e) => e?.primary && e?.verified)?.email : "") || ""
    } catch {
      /* email is optional */
    }
  }
  if (!username) return { ok: false, error: "GitHub authorized, but we could not read your profile — try again." }

  const store = await readStore()
  const e = entryOf(store, pending.userId)
  e.links.github = {
    username,
    email,
    token: tokenResult.access_token,
    linkedAt: new Date().toISOString()
  }
  await writeStore(store)
  return { ok: true, username, email }
}
