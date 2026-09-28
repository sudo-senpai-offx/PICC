// PICC local auth — fully self-hosted accounts.
// Users and session tokens live in server/data as JSON (scrypt-hashed
// passwords). No external identity provider is required.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { mkdirSync } from "node:fs"
import { chmod, readFile, rename, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DATA_DIR = process.env.PICC_AUTH_DATA_DIR || fileURLToPath(new URL("../data", import.meta.url))
const USERS_FILE = join(DATA_DIR, "users.json")
const SESSIONS_FILE = join(DATA_DIR, "sessions.json")
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

try {
  mkdirSync(DATA_DIR, { recursive: true })
} catch {
  /* already exists */
}

// ── Write lock per file — prevents concurrent JSON writes from clobbering data
const locks = new Map()
async function withLock(file, fn) {
  while (locks.get(file)) await locks.get(file)
  let release
  const p = new Promise((r) => { release = r })
  locks.set(file, p)
  try {
    return await fn()
  } finally {
    locks.delete(file)
    release()
  }
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

// ── Store faults are NOT "no such session" ──────────────────────────────
// readJSON() above folds EVERY error into an empty fallback. For a store that
// merely answers "is this list empty", that is a harmless convenience, but for
// session/user lookup it is a lie: a transient I/O fault (a locked or renamed
// file on Windows, a short read, a truncated write) becomes "this token is
// unknown", and the browser — which treats /api/auth/me as authoritative —
// DELETES a perfectly valid session and bounces the user to /login.
//
// That is not hypothetical: it is the root cause of the WS-6 T10 terminal
// performance spec flaking on a `page.waitForSelector("[data-room='markets']")`
// timeout. The spec seeds one shared account and then drives ~96 room
// transitions; on a loaded host a single unproven answer from /api/auth/me left
// the app rendering the login page, so the markets room marker could never
// appear and the wait burned its full 30s.
//
// readJSONStrict() keeps the two apart. A file that does not exist yet still
// means "nothing stored" (a fresh install is not a fault), but any other read
// or parse failure is reported as AuthStoreUnavailable so the caller can answer
// 503 "could not tell" instead of a false 401.
export class AuthStoreUnavailable extends Error {
  constructor(message) {
    super(message)
    this.name = "AuthStoreUnavailable"
  }
}

export function isAuthStoreUnavailable(err) {
  return Boolean(err) && err.name === "AuthStoreUnavailable"
}

async function readJSONStrict(file, fallback) {
  let raw
  try {
    raw = await readFile(file, "utf8")
  } catch (err) {
    // A MISSING file is a genuine first run, not a fault, and must not be counted
    // as one. Every other read failure is.
    if (err && err.code === "ENOENT") return fallback
    recordStoreFault("read", file, err)
    throw new AuthStoreUnavailable(`auth store read failed (${file}): ${err?.message ?? err}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    recordStoreFault("read", file, err)
    throw new AuthStoreUnavailable(`auth store parse failed (${file}): ${err?.message ?? err}`)
  }
}

// Atomic tmp+rename persist (repo pattern, cf. notifier.mjs) with a 0600
// mode: users.json/sessions.json hold password hashes and live session
// bearer tokens — a crash mid-write must never truncate the store, and the
// files must not be world-readable on POSIX hosts.
async function writeJSON(file, value) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
    await rename(tmp, file)
    // rename keeps the tmp inode mode on POSIX; chmod the final path so a
    // pre-existing world-readable file from an older version is tightened too.
    try {
      await chmod(file, 0o600)
    } catch {
      /* Windows: mode bits are best-effort */
    }
    return true
  } catch (err) {
    // ENOENT happens when the data dir was created after import time (tests,
    // or a fresh machine where the parent was never made). Ensure it exists
    // and retry once instead of silently dropping the write.
    if (err && err.code === "ENOENT") {
      try {
        mkdirSync(dirname(file), { recursive: true })
        await writeFile(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 })
        await rename(tmp, file)
        try {
          await chmod(file, 0o600)
        } catch {
          /* Windows: best-effort */
        }
        return true
      } catch (retryErr) {
        try {
          await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true }))
        } catch {
          /* ignore cleanup failure */
        }
        console.warn(`[picc-auth] write failed ${file}:`, retryErr.message)
        recordStoreWriteFailure(file, retryErr)
        return false
      }
    }
    try {
      await import("node:fs/promises").then((fs) => fs.rm(tmp, { force: true }))
    } catch {
      /* ignore cleanup failure */
    }
    console.warn(`[picc-auth] write failed ${file}:`, err.message)
    recordStoreWriteFailure(file, err)
    return false
  }
}

/**
 * WS-6 T10 INSTRUMENTATION — store faults, counted on BOTH sides and kept apart.
 *
 * WHY TWO COUNTERS. Round 4 shipped one, and the review found the reason it could
 * not settle the terminal-perf question: a read or shape fault returns from
 * readSessionsStrict()/readUsersStrict() BEFORE writeJSON is ever called, so the
 * write counter read 0 — and a read/shape fault is exactly the mode this
 * machine's own sessions.json was in. "write === 0 eliminates the write-fault
 * mechanism" is true. "0 means the store was healthy" is NOT, and the report's
 * phrasing implied the latter. A single counter cannot express the difference,
 * so there is now no way to read it that does.
 *
 * The discriminator a single failing run can apply:
 *
 *     write > 0                    -> the write-fault mechanism
 *     read  > 0 and write === 0    -> the read/shape-fault mechanism
 *     both === 0                   -> the store was healthy; look elsewhere
 *
 * WHY KEYED ON basename(file). Both counters are returned verbatim in the body of
 * an UNAUTHENTICATED route (`/api/auth/status`). Keyed on the absolute path they
 * disclosed the developer's home directory, the OS user name and the data layout
 * to any anonymous caller. The file NAME is the whole diagnostic value — the
 * question being asked is "which store, and which side" — so nothing is lost.
 *
 * Memory-only and monotonic, so a restart resets them; that is fine, because the
 * question is asked about one run.
 */
const STORE_WRITE_FAILURES = Object.create(null)
const STORE_READ_FAULTS = Object.create(null)

function recordStoreFault(kind, file, err) {
  const counters = kind === "write" ? STORE_WRITE_FAILURES : STORE_READ_FAULTS
  // basename(), never the raw argument: `file` reaches this module as a joined
  // absolute path and this function's output is served over HTTP.
  const key = basename(file)
  counters[key] = (counters[key] ?? 0) + 1
  console.warn(`[picc-auth] ${kind}-fault counter: ${key} = ${counters[key]} (${err?.code ?? err?.message})`)
}

function recordStoreWriteFailure(file, err) {
  recordStoreFault("write", file, err)
}

/** A snapshot of the refused-PERSIST counter, for diagnostics. */
export function storeWriteFailures() {
  return { ...STORE_WRITE_FAILURES }
}

/**
 * A snapshot of the unreadable-or-wrong-shaped counter, for diagnostics.
 *
 * Exported separately rather than folded into storeWriteFailures() because the
 * two answer different questions and conflating them is what made round 4's
 * single counter unreadable.
 */
export function storeReadFaults() {
  return { ...STORE_READ_FAULTS }
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex")
}

function verifyPassword(password, salt, hash) {
  try {
    const a = Buffer.from(hashPassword(password, salt), "hex")
    const b = Buffer.from(hash, "hex")
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name ?? "", createdAt: u.createdAt }
}

async function listUsers() {
  const data = await readJSON(USERS_FILE, { users: [] })
  return Array.isArray(data.users) ? data.users : []
}

/**
 * Persist the user list, reporting whether it was actually written.
 *
 * Returns writeJSON's boolean instead of discarding it. Discarding it is what let
 * createAccount answer "account created" for a store that was never written — the
 * write-side twin of the read-side rule readUsersStrict exists to enforce.
 */
async function saveUsers(users) {
  return writeJSON(USERS_FILE, { users })
}

/** True once at least one local account exists (first-run hint for the UI). */
export async function hasUsers() {
  return (await listUsers()).length > 0
}

/**
 * THE ONE strict reader of users.json.
 *
 * Both strict callers — resolveHasUsers() and resolveAuthUser() — go through
 * here, because they must agree on what counts as a broken store. When they
 * did not, the same input produced two different verdicts: resolveHasUsers()
 * called `{"users":null}` CORRUPTION, while resolveAuthUser() collapsed it to
 * `[]`, missed the user, and returned "not authenticated". /api/auth/me then
 * answered 401, which fetchMe() maps to `rejected`, which
 * shouldClearStoredSession acts on by DELETING A VALID SESSION — the exact
 * WS-6 T10 terminal-performance flake this line of work exists to remove,
 * reintroduced for the newly-classified shapes. One reader, one rule.
 *
 * A MISSING file is not a fault: readJSONStrict's ENOENT fallback is a genuine
 * `{ users: [] }`, so a fresh install still reads as a first run.
 *
 * Throws AuthStoreUnavailable on a read failure, a parse failure, OR a
 * readable-but-wrong shape. The shape guard is null-safe on purpose:
 * `JSON.parse("null")` is `null`, and a bare `data.users` threw a TypeError
 * that escaped isAuthStoreUnavailable (a name check) as an unhandled 500.
 */
async function readUsersStrict() {
  const data = await readJSONStrict(USERS_FILE, { users: [] })
  const users = data && typeof data === "object" ? data.users : undefined
  if (!Array.isArray(users)) {
    const shape = data === null ? "null" : Array.isArray(data) ? "an array" : typeof data
    // A readable-but-wrong-shaped file is the mode that produced NO write fault
    // at all, so it must reach the READ counter or the pair cannot tell it from
    // a healthy store.
    recordStoreFault("read", USERS_FILE, new Error(`expected a users array, got ${shape}`))
    throw new AuthStoreUnavailable(`auth store is corrupt (${USERS_FILE}): expected a users array, got ${shape}`)
  }
  return users
}

/**
 * Whether at least one local account exists, separating a real answer from an
 * unreadable store.
 *
 * hasUsers() keeps its lenient boolean for its one legitimate caller, the
 * first-run signup hint on /api/auth/status, where "probably not" is the right
 * answer to a degraded read.
 *
 * AUTH GATES must not use this. It answers "is the store POPULATED", which is
 * not the gate's question and inverts dangerously: `!resolveHasUsers()` is the
 * first-user bootstrap bypass, and a fault must never read as empty. Ask for
 * the gate's own question with firstRunBootstrapAllowed(), or call
 * requireSessionOrFirstRun() in handlers.mjs. handlers.mjs pins this function
 * to a single occurrence in ws7AuthBootstrapGateGuard, because a second caller
 * is how the fail-open class regrows.
 */
export async function resolveHasUsers() {
  return (await readUsersStrict()).length > 0
}

/**
 * MAY AN UNAUTHENTICATED CALLER THROUGH BECAUSE THE STORE IS GENUINELY EMPTY?
 *
 * This is the answer an auth gate actually needs, stated in the gate's own
 * terms, so the call site reads as the decision it is:
 *
 *     if (!(await verifyUser(auth)) && !(await firstRunBootstrapAllowed())) {
 *       return writeJson(res, 401, { error: "authentication required" })
 *     }
 *
 * It is the ONLY entry point for the first-user bootstrap bypass. Folding
 * resolveHasUsers() into it here means the class of bug - a bootstrap gate
 * reading an answer that cannot distinguish "no accounts" from "the store is
 * unreadable" - is closed at one place instead of at every call site, which is
 * how fourteen routes in handlers.mjs each came to admit an unauthenticated
 * caller whenever users.json was unreadable or corrupt.
 *
 * Throws AuthStoreUnavailable when the store cannot be read or is corrupt. A
 * gate MUST refuse on that, never treat it as "empty": the bypass exists to
 * let the very first account be created, and no legitimate first-run state
 * involves a damaged store.
 */
export async function firstRunBootstrapAllowed() {
  return !(await resolveHasUsers())
}

/**
 * A refusal that is a claim about the SERVER, not about the caller.
 *
 * The `code` is the machine-readable half, and it is what lets the HTTP layer map
 * the refusal to a status WITHOUT string-matching the message. That matters
 * because a store fault is neither "your credentials were wrong" nor "your request
 * was malformed": answering 400 or 401 for it is a false claim about the caller,
 * and a status in this codebase is a claim the client acts on. `/api/auth/me`
 * already answers 503 for exactly this condition, so 400 here and 401 there were
 * inconsistent with the rule established two functions away.
 */
function storeFault(store) {
  return {
    error:
      `The ${store} store could not be read or written, so nothing was changed. ` +
      "Check the server log for the underlying store fault.",
    code: "auth_store_unavailable"
  }
}

export async function createAccount({ email, password, name }) {
  const em = String(email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { error: "A valid email address is required." }
  if (typeof password !== "string" || password.length < 8) {
    return { error: "Password must be at least 8 characters." }
  }

  // STRICT, and the refusal happens BEFORE anything is written. The lenient read
  // is what made this the worst defect in this task: a corrupt users.json is
  // precisely what makes every authenticated route answer 503, so the owner cannot
  // reach the UI to diagnose it — and the one endpoint still reachable is this
  // one, which normalised the file and destroyed every account in it, scrypt
  // password hashes included. A lost session is re-obtainable by logging in; a
  // lost password hash is not.
  let users
  try {
    users = await readUsersStrict()
  } catch (err) {
    if (isAuthStoreUnavailable(err)) return storeFault("user")
    throw err
  }
  if (users.some((u) => u.email === em)) return { error: "An account with this email already exists." }

  const id = randomBytes(12).toString("hex")
  const salt = randomBytes(16).toString("hex")
  users.push({
    id,
    email: em,
    name: String(name ?? "").trim().slice(0, 80),
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString()
  })
  // The write result is CHECKED. A refused write leaves the store exactly as it
  // was, so the honest answer is a store fault — not a token for an account that
  // does not exist on disk.
  const written = await withLock(USERS_FILE, () => saveUsers(users))
  if (!written) return storeFault("user")

  const token = await createSession(id)
  // The account now exists and is usable; only the session could not be issued.
  // That is still a store fault, and it is not the same thing as a rejected signup.
  if (!token) return storeFault("session")
  return { user: publicUser(users[users.length - 1]), token }
}

export async function loginAccount({ email, password }) {
  const em = String(email ?? "").trim().toLowerCase()
  // Strict, for the truthfulness half of the same reason. Login writes nothing, so
  // there is no destruction risk — but the lenient read answered "no account found"
  // on a corrupt store, which is a false 401 about the caller's credentials. Someone
  // who cannot log in deserves to be told the store is at fault.
  let users
  try {
    users = await readUsersStrict()
  } catch (err) {
    if (isAuthStoreUnavailable(err)) return storeFault("user")
    throw err
  }
  const user = users.find((u) => u.email === em)
  if (!user) return { error: "No account found for this email. Create one first." }
  if (typeof password !== "string" || !verifyPassword(password, user.salt, user.passwordHash)) {
    return { error: "Incorrect password." }
  }
  const token = await createSession(user.id)
  if (!token) return storeFault("session")
  return { user: publicUser(user), token }
}

/**
 * Issue a session, REFUSING to write over a store that cannot be read.
 *
 * Returns null on a store fault, and writes NOTHING. This is a writer rule, not
 * a propagation rule, and the distinction is the whole point:
 *
 *   - propagating would surface as an unhandled 500, which is what the lenient
 *     read did for `{"sessions":"x"}` (`TypeError: Cannot create property … on
 *     string 'x'`, escaping isAuthStoreUnavailable's name check);
 *   - swallowing the fault would issue a token that cannot authenticate, and
 *     write a store that no longer holds the sessions it used to;
 *   - REFUSING is the only third option, and it is the safe one. A store this
 *     code cannot read may still be the only record of OTHER users' live
 *     sessions. Overwriting it with `{ sessions: {} }` because one login
 *     happened to arrive first is how a single corrupt file signs everybody out.
 *
 * The read goes through readSessionsStrict(), so a writer and a reader can never
 * disagree about what "broken" means. An ABSENT file is not broken: readJSONStrict
 * substitutes a genuine `{ sessions: {} }`, so a fresh install still bootstraps.
 */
async function createSession(userId) {
  const token = randomBytes(32).toString("hex")
  return withLock(SESSIONS_FILE, async () => {
    let sessions
    try {
      sessions = await readSessionsStrict()
    } catch (err) {
      if (isAuthStoreUnavailable(err)) return null
      throw err
    }
    sessions[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS }
    // The write result is CHECKED. writeJSON reports failure with a boolean and
    // logs it; discarding that boolean is what let login answer 200 {ok:true} with
    // a token that had never been persisted and could never authenticate. A
    // refused write leaves the store exactly as it was, so there is no session to
    // offer — and offering one anyway is the "swallow the fault" branch this
    // function's own docstring says must not be taken.
    const written = await writeJSON(SESSIONS_FILE, { sessions })
    if (!written) {
      console.warn("[picc-auth] createSession refused: sessions store could not be written; no session issued")
      return null
    }
    return token
  })
}

/**
 * THE one strict reader of sessions.json — and therefore the one shape rule
 * every reader AND writer of that file shares.
 *
 * The mirror of readUsersStrict(), for the same reason: one store, one shape
 * rule, so nothing that touches a given file can disagree about what "broken"
 * means. This was NOT true when this function was first added: createSession()
 * and revokeToken() still read through the lenient readJSON() and then wrote
 * the result back, so a writer and a reader could classify the same file
 * differently — and the writer was the dangerous one, because writing destroys
 * whatever the store held. Both now come through here.
 *
 * A wrong-shaped sessions file is a real 401 hazard, independent of anything
 * else: lookupSession() returning null makes /api/auth/me answer 401, and
 * fetchMe() maps 401 to `rejected`, which makes shouldClearStoredSession DELETE
 * A VALID SESSION. No read error is required — a well-formed JSON file of the
 * wrong shape is enough.
 *
 * What is deliberately NOT claimed: that a wrong shape is what causes the
 * WS-6 T10 terminal-performance flake. It does not. writeJSON() persists with an
 * atomic tmp+rename, so a concurrent reader sees the old inode or the new one
 * and never a partial file, and a shape fault cannot be produced by contention.
 * This reader closes a latent second path to the same 401; the flake's actual
 * cause is still unidentified.
 *
 * A MISSING file is not a fault: readJSONStrict's ENOENT fallback is a genuine
 * `{ sessions: {} }`, so a fresh install still reads as "no sessions" and still
 * bootstraps.
 *
 * Throws AuthStoreUnavailable on a read failure, a parse failure, OR a
 * readable-but-wrong shape. The shape guard is null-safe for the same reason as
 * in readUsersStrict(): `JSON.parse("null")` is `null`. The Array.isArray test
 * is NOT redundant with the typeof test — an array is `typeof === "object"`, so
 * without it `[token]` would be a legal-looking lookup on a corrupt store.
 */
async function readSessionsStrict() {
  const data = await readJSONStrict(SESSIONS_FILE, { sessions: {} })
  const sessions = data && typeof data === "object" ? data.sessions : undefined
  const isPlainObject = sessions !== null && typeof sessions === "object" && !Array.isArray(sessions)
  if (!isPlainObject) {
    const got =
      sessions === undefined
        ? "no sessions object"
        : sessions === null
          ? "null"
          : Array.isArray(sessions)
            ? "an array"
            : typeof sessions
    // Same reason as readUsersStrict(): a wrong-shaped sessions file is the
    // documented 401 hazard and it never reaches writeJSON, so the read counter
    // is the only place it can show up.
    recordStoreFault("read", SESSIONS_FILE, new Error(`expected a sessions object, got ${got}`))
    throw new AuthStoreUnavailable(`auth store is corrupt (${SESSIONS_FILE}): expected a sessions object, got ${got}`)
  }
  return sessions
}

/**
 * The one place session lookup + expiry is decided.
 *
 * `prune` is an explicit flag because the two callers genuinely differ and that
 * difference belongs where it is made, not hidden in duplicated logic:
 *
 *   - verifyToken(), prune: true. It is the general store reader and already
 *     takes the write lock, so it garbage-collects the dead row it just found.
 *     This keeps sessions.json from growing for a client that only ever calls
 *     ordinary routes.
 *   - resolveAuthUser() (/api/auth/me), prune: true. Same contract, and the
 *     write costs one locked rewrite per already-dead session rather than one
 *     per check — pruning only runs in the expired branch. Without it a client
 *     that only ever calls /me would never collect its own dead sessions.
 *
 * Both callers pass it explicitly so the read/prune contract is stated at the
 * call site instead of being implied by two divergent copies of this logic.
 *
 * Reads STRICTLY: a store fault raises AuthStoreUnavailable rather than
 * looking like "no such session". verifyToken() maps that fault back to its
 * documented null contract; resolveAuthUser() lets it reach the caller.
 *
 * Returns the live session's userId, or null for unknown/expired.
 */
async function lookupSession(token, { prune }) {
  if (!token) return null
  const sessions = await readSessionsStrict()
  const s = sessions[token]
  if (!s) return null

  // A row with no usable expiresAt counts as DEAD, not as immortal. This is a
  // deliberate TIGHTENING of the previous `Date.now() > s.expiresAt`: with
  // expiresAt undefined that comparison was `undefined > n` → false, so such a
  // row was treated as valid forever. Expiry is the fail-closed direction, so
  // "cannot tell when this ends" is resolved against the session.
  const expired = typeof s.expiresAt !== "number" || Date.now() > s.expiresAt
  if (expired) {
    if (prune) {
      await withLock(SESSIONS_FILE, async () => {
        // Re-read STRICTLY, not leniently. Between the read above and this
        // locked write a concurrent writer can replace the file, and the old
        // `d.sessions ?? {}` would then `delete` from whatever that was and
        // write it straight back — turning a transient shape fault into a
        // PERSISTENT one. The prune is a write; it has to earn that write.
        const sessions = await readSessionsStrict()
        delete sessions[token]
        await writeJSON(SESSIONS_FILE, { sessions })
      })
    }
    return null
  }
  return s.userId
}

export async function verifyToken(token) {
  // Contract: never throws, and null means "cannot vouch for this token". A
  // store fault is simply one more way of not being able to vouch, so it is
  // reported as null. That keeps the fail-CLOSED behaviour every requireAuth
  // caller already depends on, while the shared helper above still tells the
  // callers that care that the store — rather than the token — was at fault.
  try {
    return await lookupSession(token, { prune: true })
  } catch (err) {
    if (isAuthStoreUnavailable(err)) return null
    throw err
  }
}

/**
 * Drop one session, REFUSING to write over a store that cannot be read OR written.
 *
 * The same writer rule as createSession(), for the same reason: `readJSON` +
 * `data.sessions ?? {}` used to read a wrong-shaped store as `{}`, find no
 * matching token, and skip the write — or, worse, read a parse failure as `{}` and
 * treat a store full of live sessions as empty. This version classifies the store
 * with the readers' rule and writes nothing at all when it cannot be read.
 *
 * THREE outcomes, deliberately not collapsed into two:
 *
 *   - `true`   the token existed and the removal was PERSISTED.
 *   - `false`  there was genuinely nothing to do: an unknown or already-expired
 *              token. A clean no-op, and the caller may report success.
 *   - THROWS AuthStoreUnavailable when the store could not be read or the write
 *     was refused. A throw rather than a `false` because `false` would be
 *     indistinguishable from the clean no-op, and the whole point is that a
 *     revocation that did not happen must not be reported as one.
 *
 * An earlier version returned `false` for a store fault and documented that the
 * caller could not tell the cases apart — which is a way of saying the return
 * value carries no information. It does now.
 */
export async function revokeToken(token) {
  if (!token) return false
  return withLock(SESSIONS_FILE, async () => {
    let sessions
    try {
      sessions = await readSessionsStrict()
    } catch (err) {
      if (isAuthStoreUnavailable(err)) {
        console.warn("[picc-auth] revokeToken refused: sessions store could not be read; nothing written")
      }
      throw err
    }
    if (!sessions[token]) return false
    delete sessions[token]
    const written = await writeJSON(SESSIONS_FILE, { sessions })
    if (!written) {
      // Returning true here would tell the caller the token is gone while it is
      // still live for the rest of its TTL — a logout the client believes and the
      // server has not performed.
      console.warn("[picc-auth] revokeToken refused: sessions store could not be written; token NOT revoked")
      throw new AuthStoreUnavailable(`auth store write failed (${SESSIONS_FILE}): the session was not revoked`)
    }
    return true
  })
}

export async function getUserById(id) {
  if (!id) return null
  const users = await listUsers()
  const user = users.find((u) => u.id === id)
  return user ? publicUser(user) : null
}

/**
 * Validate a `Bearer <token>` header against the local session store and
 * return the authenticated user id (or null). Replaces the Supabase verifier.
 */
export async function verifyUser(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) return null
  return verifyToken(authorizationHeader.slice(7))
}

/**
 * Resolve a `Bearer <token>` header to its user, keeping "no such session"
 * separate from "the store could not be read".
 *
 * verifyUser() deliberately keeps its null-on-everything contract for the many
 * callers that only need a boolean and must not start throwing. This entry
 * point is for callers — /api/auth/me above all — that must not convert a store
 * fault into a false "not authenticated", because the browser treats that
 * answer as authoritative enough to delete the session.
 *
 * Returns null only when the token genuinely is not valid. Throws
 * AuthStoreUnavailable when the answer could not be determined.
 */
export async function resolveAuthUser(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) return null
  // prune: true, same as verifyToken(). The earlier draft of this used
  // prune:false to keep /me off the write lock, on the theory that /me is the
  // hot path. That was wrong: the write only happens inside the EXPIRED branch,
  // so it costs one locked rewrite per already-dead session, once — after which
  // the row is gone and later checks write nothing. Leaving it off meant a
  // client that only ever calls /me never garbage-collected its own dead
  // sessions, and sessions.json is re-read in full on every auth check.
  const userId = await lookupSession(authorizationHeader.slice(7), { prune: true })
  if (!userId) return null
  // readUsersStrict(), NOT a local shape check. This is the second strict reader
  // of the same file, and when the two disagreed a readable-but-corrupt store
  // produced a false "not authenticated" here — which /api/auth/me turns into a
  // 401, which the client turns into a deleted session. One rule, one reader.
  const users = await readUsersStrict()
  const user = users.find((u) => u.id === userId)
  return user ? publicUser(user) : null
}

/**
 * The GATE's credential check: same lookup, but a store fault is reported
 * instead of being flattened to "no such session".
 *
 * verifyUser()/verifyToken() deliberately keep their null-on-everything
 * contract, and roughly forty handlers.mjs call sites depend on it — a boolean
 * check must not start throwing. But an auth GATE is not a boolean check: it is
 * the thing that decides whether a caller is let in, and answering 401 there on
 * a store fault is a claim about the TOKEN that was never examined. The gate
 * needs to be able to say "I could not determine", so it uses this.
 *
 * Returns the live session's userId, or null for an unknown/expired token.
 * Throws AuthStoreUnavailable when the store could not be read or parsed.
 */
export async function verifyTokenStrict(token) {
  return lookupSession(token, { prune: true })
}
