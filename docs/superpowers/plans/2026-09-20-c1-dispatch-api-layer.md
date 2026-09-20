# C1 — Dispatch + API Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the copilot's notification spine — a dispatch inbox service, its additive API endpoints, additive realtime sections, the on-demand v3.2 engine register endpoint, and the frontend Dispatch bell + room.

**Architecture:** Additive-only (ADR-0005). New `dispatch` service mirrors the proven `alertEngine` pattern (module store + `PICC_DISPATCH_DATA_DIR` persistence + subscribe/emit). New endpoints ride the existing `requireAuth` + `writeJson` handler flow. The realtime `suite` snapshot gains one additive `dispatch` section; the SSE stream gains an additive `dispatch` event (clients ignore unknown names — verified tolerant). The v3.2 register endpoint is composed by a new pure, injectable `v32Register` and needs NO live engine data to be tested. Everything is additive: existing payload bytes and tests stay untouched.

**Tech Stack:** Node 22 ESM (`server/services/*.mjs`), Vitest, Express-less `handlers.mjs` (method+path if-chain), React 19 + TS, RTL via Vitest/jsdom.

**Spec:** `docs/specs/PICC_COPILOT_REDESIGN_v1.md` (§2 API layer, §3 IA spine) + `docs/adr/0005-additive-api-contract.md`.

## Global Constraints

- Additive-only API contract (ADR-0005): new endpoints + additive keys only; existing payload bytes never change while v3.2 is OFF; the 2527-test floor + byte-identity tests stay green.
- Never fabricate data: soak digits with no honest source return `null` + a `reason` (honesty tokens). Flip-gate numbers come from `constitution.flipGate`;
- Hermetic service/API tests: SFresh-import `handlers.mjs` + `PICC_*_DATA_DIR` env redirect + `vi.resetModules()` per test (the `accountMetricsApi.test.mjs` pattern at `:56-74`).
- Existing tokens/classes only on the frontend (no new styling deps, no inline hex).
- Targeted vitest filters are relative paths from `apps/dashboard` workdir. Lazy room chunks + `rememberRoom` behavior preserved.
- Commits: one per task, message style that matches the repo (`feat(copilot): ...`).

---

### Task 1: Dispatch service (`server/services/dispatch.mjs`)

**Files:**
- Create: `apps/dashboard/server/services/dispatch.mjs`
- Test: `apps/dashboard/server/__tests__/dispatch.test.mjs`

**Interfaces:**
- Produces (later tasks + handlers consume these):
  - `pushDispatch({ kind, severity, title, body, ref })` → entry `{ id, kind, severity, title, body, ref, ts, read }` (id = `dispatch_${Date.now()}_${rand}`; kinds `decision|milestone|venue|system`; severities `info|warning|critical`, unknown → `info`). Inbox caps at 500 (oldest dropped). Returns the entry.
  - `listDispatch({ limit = 50, unreadOnly = false } = {})` → newest-first array.
  - `unreadDispatchCount()` → number.
  - `markDispatchRead(id)` → boolean (false if missing).
  - `onDispatch(cb)` → unsubscribe fn (subscribe/emit like `alertEngine.onAlert`).
  - `_resetDispatchForTest()` → clears store + listeners, no persistence write.
- Consumes: `PICC_DISPATCH_DATA_DIR` env (default `join(__dirname, "..", "data")`), `dispatch.json` persistence (best-effort, swallow on failure — mirror `alertEngine` `loadAlerts/saveAlerts`).

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/server/__tests__/dispatch.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("dispatch inbox", () => {
  let dir
  let mod
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    mod = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    mod._resetDispatchForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("defaults an entry (unknown kind/severity coerce to info)", () => {
    const e = mod.pushDispatch({ title: "hello", kind: "nope", severity: "loud" })
    expect(e.kind).toBe("info")
    expect(e.severity).toBe("info")
    expect(e.title).toBe("hello")
    expect(e.read).toBe(false)
    expect(typeof e.id).toBe("string")
  })

  it("lists newest-first and counts unread", () => {
    mod.pushDispatch({ title: "a", kind: "decision" })
    mod.pushDispatch({ title: "b", kind: "venue" })
    const all = mod.listDispatch()
    expect(all.map((e) => e.title)).toEqual(["b", "a"])
    expect(mod.unreadDispatchCount()).toBe(2)
  })

  it("marks one entry read without touching the rest", () => {
    const a = mod.pushDispatch({ title: "a", kind: "decision" })
    const b = mod.pushDispatch({ title: "b", kind: "decision" })
    expect(mod.markDispatchRead(a.id)).toBe(true)
    expect(mod.markDispatchRead("missing")).toBe(false)
    expect(mod.unreadDispatchCount()).toBe(1)
    expect(mod.listDispatch().find((e) => e.id === b.id).read).toBe(false)
  })

  it("filters by unreadOnly and truncates to limit", () => {
    for (let i = 0; i < 6; i++) mod.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(mod.listDispatch({ limit: 3 }).length).toBe(3)
    mod.markDispatchRead(mod.listDispatch()[0].id)
    expect(mod.listDispatch({ unreadOnly: true }).length).toBe(5)
  })

  it("notifies subscribers on push", () => {
    const seen = []
    const off = mod.onDispatch((e) => seen.push(e.title))
    mod.pushDispatch({ title: "ping", kind: "milestone" })
    off()
    mod.pushDispatch({ title: "after-unsub", kind: "milestone" })
    expect(seen).toEqual(["ping"])
  })

  it("caps the inbox at 500", () => {
    for (let i = 0; i < 510; i++) mod.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(mod.listDispatch().length).toBe(500)
  })

  it("persists and reloads from disk", async () => {
    mod.pushDispatch({ title: "durable", kind: "venue" })
    mod._resetDispatchForTest()
    const reloaded = await import("../services/dispatch.mjs")
    expect(reloaded.listDispatch().map((e) => e.title)).toContain("durable")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/dispatch.test.mjs` (workdir `apps/dashboard`)
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Write minimal implementation**

`apps/dashboard/server/services/dispatch.mjs`:

```js
// Dispatch inbox — the copilot's notification spine (PICC_COPILOT_REDESIGN_v1 §2).
// In-memory store + JSON persistence (PICC_DISPATCH_DATA_DIR), subscribe/emit like
// alertEngine. Additive service; nothing else imports it until the API layer lands.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.PICC_DISPATCH_DATA_DIR || join(__dirname, "..", "data")
const DISPATCH_FILE = join(DATA_DIR, "dispatch.json")
const MAX_INBOX = 500

let inbox = []
let listeners = new Set()

const KINDS = new Set(["decision", "milestone", "venue", "system"])
const SEVERITIES = new Set(["info", "warning", "critical"])

function load() {
  try {
    if (existsSync(DISPATCH_FILE)) inbox = JSON.parse(readFileSync(DISPATCH_FILE, "utf-8"))
  } catch { inbox = [] }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(DISPATCH_FILE, JSON.stringify(inbox, null, 2))
  } catch { /* ignore */ }
}

load()

export function pushDispatch({ kind = "info", severity = "info", title = "", body = "", ref = null } = {}) {
  const entry = {
    id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: KINDS.has(String(kind)) ? String(kind) : "info",
    severity: SEVERITIES.has(String(severity)) ? String(severity) : "info",
    title: String(title || ""),
    body: String(body || ""),
    ref: ref == null ? null : String(ref),
    ts: Date.now(),
    read: false
  }
  inbox.unshift(entry)
  if (inbox.length > MAX_INBOX) inbox.length = MAX_INBOX
  save()
  for (const cb of listeners) {
    try { cb(entry) } catch { /* one bad listener never kills the push */ }
  }
  return entry
}

export function listDispatch({ limit = 50, unreadOnly = false } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500)
  const rows = unreadOnly ? inbox.filter((e) => e.read === false) : inbox
  return rows.slice(0, n)
}

export function unreadDispatchCount() {
  return inbox.reduce((n, e) => n + (e.read === false ? 1 : 0), 0)
}

export function markDispatchRead(id) {
  const entry = inbox.find((e) => e.id === id)
  if (!entry) return false
  entry.read = true
  save()
  return true
}

export function onDispatch(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function _resetDispatchForTest() {
  inbox = []
  listeners = new Set()
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/dispatch.test.mjs`
Expected: PASS (all 8).

- [ ] **Step 5: Run the floor (+ typecheck untouched)**

Run: `npx vitest run server/__tests__/adaptiveConfluence.test.mjs server/__tests__/adaptiveConfluence.v32.test.mjs server/__tests__/u4faPayload.test.mjs --maxWorkers=3`
Expected: PASS — legacy decision bytes untouched.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/services/dispatch.mjs apps/dashboard/server/__tests__/dispatch.test.mjs
git commit -m "feat(copilot): dispatch inbox service"
```

---

### Task 2: Dispatch API endpoints

**Files:**
- Modify: `apps/dashboard/server/handlers.mjs` (add `dispatch` import + two route branches near `/api/trading/ledger` at `:1259`)
- Test: `apps/dashboard/server/__tests__/dispatchApi.test.mjs`

**Interfaces:**
- Consumes: `dispatch.mjs` exports from Task 1; `requireAuth`, `writeJson` (already in `handlers.mjs`).
- Produces:
  - `GET /api/trading/dispatch?limit=&unreadOnly=` → `{ ok: true, unread, entries: listDispatch({ limit, unreadOnly }) }`
  - `POST /api/trading/dispatch/read` body `{ id }` → `{ ok: true, id, read: true }`; missing id → 404 `{ ok: false, error }`; invalid body → 400 `{ ok: false, error }`.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/server/__tests__/dispatchApi.test.mjs` (hermetic harness copied from `accountMetricsApi.test.mjs:15-47`):

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method, url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    socket: { remoteAddress: "127.0.0.1" },
    raw,
    on(evt, cb) { if (evt === "data" && raw != null) cb(raw); if (evt === "end") cb() }
  }
}
function makeRes() {
  return {
    status: null, body: null,
    writeHead(status) { this.status = status },
    end(body) { this.body = body ? JSON.parse(body) : null }
  }
}
async function call(handleApi, method, path, body, headers) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body, headers), res, path)
  return res
}

describe("dispatch API", () => {
  let dir, handleApi, dispatch
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-api-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    dispatch = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    dispatch._resetDispatchForTest()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("GET dispatch returns the empty inbox honestly", async () => {
    const res = await call(handleApi, "GET", "/api/trading/dispatch")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.unread).toBe(0)
    expect(res.body.entries).toEqual([])
  })

  it("GET dispatch returns pushed entries newest-first with unread", async () => {
    dispatch.pushDispatch({ title: "one", kind: "decision" })
    dispatch.pushDispatch({ title: "two", kind: "venue" })
    const res = await call(handleApi, "GET", "/api/trading/dispatch")
    expect(res.body.entries.map((e) => e.title)).toEqual(["two", "one"])
    expect(res.body.unread).toBe(2)
  })

  it("POST dispatch/read marks one entry and reports 200", async () => {
    const e = dispatch.pushDispatch({ title: "one", kind: "milestone" })
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", { id: e.id })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, id: e.id, read: true })
    expect(dispatch.unreadDispatchCount()).toBe(0)
  })

  it("POST dispatch/read with a missing id returns 404", async () => {
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", { id: "nope" })
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it("POST dispatch/read with an invalid body returns 400", async () => {
    const res = await call(handleApi, "POST", "/api/trading/dispatch/read", {})
    expect(res.status).toBe(400)
    expect(res.body.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/dispatchApi.test.mjs`
Expected: FAIL — 404/route mismatch on the new paths.

- [ ] **Step 3: Add the handler branches**

In `handlers.mjs`, add `import { pushDispatch, listDispatch, unreadDispatchCount, markDispatchRead } from "./services/dispatch.mjs"` alongside the existing service imports, then two branches next to the ledger routes (`:1259`):

```js
if (path === "/api/trading/dispatch" && req.method === "GET") {
  if (!(await requireAuth(req, res))) return true
  const limit = Math.min(Math.max(Number(parsed.searchParams.get("limit") ?? 50), 1), 500)
  const unreadOnly = parsed.searchParams.get("unreadOnly") === "true"
  writeJson(res, 200, { ok: true, unread: unreadDispatchCount(), entries: listDispatch({ limit, unreadOnly }) })
  return true
}

if (path === "/api/trading/dispatch/read" && req.method === "POST") {
  if (!(await requireAuth(req, res))) return true
  let body
  try { body = req.body ? JSON.parse(req.body) : null } catch { body = null }
  const id = typeof body?.id === "string" ? body.id.trim() : ""
  if (!id || id.length > 96) return writeJson(res, 400, { ok: false, error: "id required" }) && true
  if (!markDispatchRead(id)) return writeJson(res, 404, { ok: false, error: `no dispatch entry ${id}` }) && true
  writeJson(res, 200, { ok: true, id, read: true })
  return true
}
```

> Note the harness `makeReq` reads `req.body` as a raw JSON string via the `data` event — match however adjacent POST handlers parse the body (verify against the `/api/trading/session-policy` branch at `:257` if the `req.body` shape differs).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/dispatchApi.test.mjs`
Expected: PASS (all 5).

- [ ] **Step 5: Run the floor math**

Run: `npx vitest run server/__tests__/accountMetricsApi.test.mjs server/__tests__/dispatchApi.test.mjs --maxWorkers=3`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/server/handlers.mjs apps/dashboard/server/__tests__/dispatchApi.test.mjs
git commit -m "feat(copilot): dispatch API endpoints"
```

---

### Task 3: Additive realtime dispatch (suite section + SSE event)

**Files:**
- Create: `apps/dashboard/server/services/dispatchSection.mjs`
- Modify: `apps/dashboard/server/services/realtimeSuite.mjs` (`SECTIONS` at `:18-45`)
- Test: `apps/dashboard/server/__tests__/dispatchRealtime.test.mjs`

**Interfaces:**
- Consumes: `listDispatch`, `unreadDispatchCount`, `onDispatch` from Task 1.
- Produces:
  - `dispatchSection()` → `{ unread, entries: listDispatch({ limit: 10 }) }` (fresh, no cache).
  - SSE event: live dispatch entries emitted as `event: dispatch` with the raw entry payload.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/server/__tests__/dispatchRealtime.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("dispatch realtime section", () => {
  let dir, section, dispatch
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-dispatch-rt-"))
    process.env.PICC_DISPATCH_DATA_DIR = dir
    section = await import("../services/dispatchSection.mjs")
    dispatch = await import("../services/dispatch.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_DISPATCH_DATA_DIR
    dispatch._resetDispatchForTest()
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports empty honestly", () => {
    expect(section.dispatchSection()).toEqual({ unread: 0, entries: [] })
  })

  it("reports unread + recent entries", () => {
    dispatch.pushDispatch({ title: "fast", kind: "decision" })
    const s = section.dispatchSection()
    expect(s.unread).toBe(1)
    expect(s.entries.map((e) => e.title)).toEqual(["fast"])
  })

  it("caps the section at 10 entries", () => {
    for (let i = 0; i < 14; i++) dispatch.pushDispatch({ title: `t${i}`, kind: "system" })
    expect(section.dispatchSection().entries.length).toBe(10)
  })

  it("exposes a live subscribe passthrough on the section module", async () => {
    const seen = []
    const off = section.onDispatchLive((e) => seen.push(e.title))
    dispatch.pushDispatch({ title: "live fire", kind: "venue" })
    expect(seen).toEqual(["live fire"])
    off()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/dispatchRealtime.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/dashboard/server/services/dispatchSection.mjs`:

```js
// Additive realtime surface for the dispatch inbox — glued into realtimeSuite's
// SECTIONS and the SSE handler. Additive only; nothing here edits legacy bytes.
import { listDispatch, unreadDispatchCount, onDispatch } from "./dispatch.mjs"

export function dispatchSection() {
  return { unread: unreadDispatchCount(), entries: listDispatch({ limit: 10 }) }
}

export const onDispatchLive = onDispatch
```

In `realtimeSuite.mjs`, import and register the section:

```js
import { dispatchSection } from "./dispatchSection.mjs"
// (add to SECTIONS, after `convergence`)
dispatch: { ttl: 2000, load: () => dispatchSection() }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/dispatchRealtime.test.mjs`
Expected: PASS (all 4).

- [ ] **Step 5: Wire the SSE event into the realtime handler**

In `handlers.mjs` `/api/trading/realtime` branch (`:1133`), after the existing `offCCXT` subscription (`:1195`):

```js
const offDispatch = onDispatchLive((entry) => send("dispatch", entry))
// and detach it in detach(): if (offDispatch) offDispatch()
```

Add the import next to the dispatch service import: `import { onDispatchLive } from "./services/dispatchSection.mjs"`.

- [ ] **Step 6: Run the floor**

Run: `npx vitest run server/__tests__/autopilotRoutes.test.mjs server/__tests__/dispatchRealtime.test.mjs server/__tests__/accountMetricsApi.test.mjs --maxWorkers=3`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/server/services/dispatchSection.mjs apps/dashboard/server/services/realtimeSuite.mjs apps/dashboard/server/handlers.mjs apps/dashboard/server/__tests__/dispatchRealtime.test.mjs
git commit -m "feat(copilot): realtime dispatch section + live event"
```

---

### Task 4: v3.2 engine register endpoint

**Files:**
- Create: `apps/dashboard/server/services/v32Register.mjs`
- Modify: `apps/dashboard/server/handlers.mjs` (import + route)
- Test: `apps/dashboard/server/__tests__/v32Register.test.mjs`

**Interfaces:**
- Consumes: `v32Status` from `adaptiveConfluence.mjs` (`:992`, injectable `rows`/`config`); `loadV32Config` from `v32Config.mjs`; v3.2 decision rows already on the live payload as `decision.strategies.v32.result` (shape from `v32Engine.v32DecisionForAsset`, `v32Engine.mjs:240-259`).
- Produces:
  - `v32Register({ decisions = [], rows = null, config = null, at = Date.now() })` →
    ```js
    {
      ok: true,
      enabled, mode, at,                   // from v32Status
      flipGate: { legacyExpectancy, candidateExpectancy, legacyTrades, candidateTrades, flip, reason },
      assets: [ /* one row per decision with strategies.v32.enabled === true */ ],
      assetCount,
      soak: { resolved: rows?.length ?? 0, breakeven: candideExpectancy-based (see Step 3) }
    }
    ```
    When `enabled === false`: `{ ok: true, enabled: false, mode: "shadow", at, flipGate, assets: [], assetCount: 0, soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" } }`.
  - `GET /api/trading/engine/v32` → requires auth; reads `getDecisions()` from `adaptiveConfluence.mjs`, `v32Status` via default rows, and `loadV32Config`. Response = `v32Register` result. Never emits `assets` fields that weren't on the wire.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/server/__tests__/v32Register.test.mjs`:

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROW = (assetId) => ({
  engine: "v3.2",
  assetId,
  direction: "up",
  expiry: "60",
  ts: 123,
  score: { available: true, score: 0.7, direction: "up" },
  costLine: { ev: 1.2, evRR: 2.1, evRRPass: true },
  confidence: 66,
  verdict: "TRADE",
  gates: { score: true, costLine: true, copilot: true },
  reasons: [],
  copilot: { ok: true, wires: [], blockedBy: [] }
})

describe("v3.2 engine register", () => {
  let dir, reg
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-v32reg-"))
    process.env.PICC_V32_CONFIG_DATA_DIR = dir
    reg = await import("../services/v32Register.mjs")
  })
  afterEach(() => {
    delete process.env.PICC_V32_CONFIG_DATA_DIR
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports shadow mode with an explicit reason when disabled", async () => {
    const out = await reg.v32Register({ decisions: [{ strategies: { v32: { enabled: true, result: ROW("EURUSD") } } }], config: { enabled: false } })
    expect(out.ok).toBe(true)
    expect(out.enabled).toBe(false)
    expect(out.mode).toBe("shadow")
    expect(out.assets).toEqual([])
    expect(out.soak.breakeven).toBeNull()
    expect(out.soak.reason).toContain("powered toggle")
  })

  it("collects v3.2 result rows from enabled decisions only", async () => {
    const out = await reg.v32Register({
      decisions: [
        { strategies: { v32: { enabled: true, result: ROW("EURUSD") } } },
        { strategies: { v32: { enabled: false } } },
        { strategies: { geo: { enabled: true } } }
      ],
      config: { enabled: true },
      at: 99
    })
    expect(out.enabled).toBe(true)
    expect(out.mode).toBe("powered")
    expect(out.assetCount).toBe(1)
    expect(out.assets[0].assetId).toBe("EURUSD")
    expect(out.at).toBe(99)
  })

  it("never fabricates fields: assets mirror the wire rows exactly", async () => {
    const row = ROW("BTCUSD")
    const out = await reg.v32Register({ decisions: [{ strategies: { v32: { enabled: true, result: row } } }], config: { enabled: true } })
    expect(out.assets[0]).toEqual(row)
  })

  it("reports flipGate + resolved count when rows are supplied", async () => {
    const rows = [
      { engine: "v3.2", assetId: "EURUSD", expiry: "60", hits: 3, misses: 1 },
      { engine: "legacy", assetId: "EURUSD", expiry: "60", hits: 5, misses: 5 }
    ]
    const out = await reg.v32Register({ decisions: [], rows, config: { enabled: true } })
    expect(out.soak.resolved).toBe(2)
    expect(out.flipGate).toBeDefined()
    expect(typeof out.flipGate.candidateTrades).toBe("number")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/v32Register.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`apps/dashboard/server/services/v32Register.mjs`:

```js
// Additive v3.2 engine register (PICC_COPILOT_REDESIGN_v1 §2). Composes the
// flip-gate readiness surface with the per-asset v3.2 decision rows already on
// the live payload. Never fabricates: absent data → explicit reason, rows are
// forwarded exactly as the wire produced them.

import { v32Status } from "./adaptiveConfluence.mjs"

export async function v32Register({ decisions = [], rows = null, config = null, at = Date.now() } = {}) {
  const status = await v32Status({ rows, config, at })
  const assets = (Array.isArray(decisions) ? decisions : [])
    .filter((d) => d?.strategies?.v32?.enabled === true && d.strategies.v32.result)
    .map((d) => d.strategies.v32.result)

  const base = {
    ok: true,
    enabled: status.enabled,
    mode: status.mode,
    at,
    flipGate: status.flipGate,
    assets,
    assetCount: assets.length
  }
  if (!status.enabled) {
    return {
      ...base,
      soak: { resolved: 0, breakeven: null, reason: "v3.2 lane off — soak digits require a powered toggle" }
    }
  }
  const ledger = Array.isArray(rows) ? rows : []
  const breakeven = Number.isFinite(status.flipGate?.candidateExpectancy)
    ? Math.round(status.flipGate.candidateExpectancy * 1000) / 1000
    : null
  return {
    ...base,
    soak: {
      resolved: ledger.length,
      breakeven: breakeven == null ? null : breakeven,
      reason: breakeven == null ? "candidate expectancy not computable from supplied rows" : null
    }
  }
}
```

Handler route (next to `/api/trading/ledger` at `:1259`):

```js
if (path === "/api/trading/engine/v32" && req.method === "GET") {
  if (!(await requireAuth(req, res))) return true
  try {
    const [{ getDecisions }, { loadV32Config }] = await Promise.all([
      import("./services/adaptiveConfluence.mjs"),
      import("./services/v32Config.mjs")
    ])
    const { v32Register } = await import("./services/v32Register.mjs")
    const payload = (await getDecisions())?.decisions ?? []
    const { config } = await loadV32Config({})
    writeJson(res, 200, await v32Register({ decisions: payload, config }))
  } catch (err) {
    console.warn("[picc] engine/v32 failed:", err.message)
    writeJson(res, 502, { ok: false, error: err.message })
  }
  return true
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/v32Register.test.mjs`
Expected: PASS (all 4).

- [ ] **Step 5: API-level proof the endpoint is additive**

Append one integration test to `v32Register.test.mjs` (hermetic `call()` harness like Task 2) asserting `GET /api/trading/engine/v32` returns 200 with `{ ok: true, enabled: false, mode: "shadow" }` in an empty temp config dir, and that forcing `config: { enabled: true }` does NOT break the response shape.

- [ ] **Step 6: Run the floor + byte-identity**

Run: `npx vitest run server/__tests__/v32Register.test.mjs server/__tests__/adaptiveConfluence.test.mjs server/__tests__/adaptiveConfluence.v32.test.mjs server/__tests__/u4faPayload.test.mjs --maxWorkers=3`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/server/services/v32Register.mjs apps/dashboard/server/handlers.mjs apps/dashboard/server/__tests__/v32Register.test.mjs
git commit -m "feat(copilot): on-demand v3.2 engine register endpoint"
```

---

### Task 5: Frontend dispatch lib

**Files:**
- Create: `apps/dashboard/src/lib/dispatch.ts`
- Test: `apps/dashboard/src/lib/__tests__/dispatch.test.ts`

**Interfaces:**
- Consumes: frontend fetcher header pattern from `lib/liveTrading.ts:381` (same `BASE`/`headers` construction).
- Produces:
  - `interface DispatchEntry { id: string; kind: "decision" | "milestone" | "venue" | "system"; severity: "info" | "warning" | "critical"; title: string; body: string; ref: string | null; ts: number; read: boolean }`
  - `interface DispatchInbox { ok: boolean; unread: number; entries: DispatchEntry[] }`
  - `fetchDispatch(limit = 50, unreadOnly = false)` → `Promise<DispatchInbox>`
  - `markDispatchRead(id)` → `Promise<{ ok: boolean }>` (throws on non-ok)
  - `KIND_LABEL` / `SEVERITY_LABEL` maps for the room UI.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/lib/__tests__/dispatch.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from "vitest"
import { fetchDispatch, markDispatchRead } from "../dispatch"

afterEach(() => vi.restoreAllMocks())

describe("dispatch lib", () => {
  it("fetchDispatch GETs /api/trading/dispatch and parses the inbox", async () => {
    const stub = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ ok: true, unread: 1, entries: [{ id: "x", kind: "decision", severity: "info", title: "t", body: "", ref: null, ts: 1, read: false }] })
    })
    vi.stubGlobal("fetch", stub)
    const inbox = await fetchDispatch(25, true)
    expect(stub.mock.calls[0][0]).toContain("/api/trading/dispatch?limit=25&unreadOnly=true")
    expect(inbox.unread).toBe(1)
    expect(inbox.entries[0].title).toBe("t")
  })

  it("markDispatchRead POSTs and returns ok", async () => {
    const stub = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, id: "x", read: true }) })
    vi.stubGlobal("fetch", stub)
    const out = await markDispatchRead("x")
    expect(out.ok).toBe(true)
    const [, init] = stub.mock.calls[0]
    expect(init.method).toBe("POST")
  })

  it("markDispatchRead throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ ok: false }) }))
    await expect(markDispatchRead("nope")).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/dispatch.test.ts`
Expected: FAIL — imports don't resolve.

- [ ] **Step 3: Implement**

`apps/dashboard/src/lib/dispatch.ts`:

```ts
export type DispatchKind = "decision" | "milestone" | "venue" | "system"
export type DispatchSeverity = "info" | "warning" | "critical"

export interface DispatchEntry {
  id: string
  kind: DispatchKind
  severity: DispatchSeverity
  title: string
  body: string
  ref: string | null
  ts: number
  read: boolean
}

export interface DispatchInbox {
  ok: boolean
  unread: number
  entries: DispatchEntry[]
}

export const KIND_LABEL: Record<DispatchKind, string> = {
  decision: "Decision",
  milestone: "Milestone",
  venue: "Venue",
  system: "System"
}

export const SEVERITY_LABEL: Record<DispatchSeverity, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical"
}

// Same header construction as lib/liveTrading.ts:381 (auth token when logged in)
function headers(): Record<string, string> {
  const token = localStorage.getItem("picc.session.token")
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function fetchDispatch(limit = 50, unreadOnly = false): Promise<DispatchInbox> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (unreadOnly) q.set("unreadOnly", "true")
  const res = await fetch(`/api/trading/dispatch?${q}`, { headers: headers() })
  if (!res.ok) throw new Error(`dispatch GET failed: ${res.status}`)
  return (await res.json()) as DispatchInbox
}

export async function markDispatchRead(id: string): Promise<{ ok: boolean }> {
  const res = await fetch("/api/trading/dispatch/read", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers() },
    body: JSON.stringify({ id })
  })
  if (!res.ok) throw new Error(`dispatch read failed: ${res.status}`)
  return (await res.json()) as { ok: boolean }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/dispatch.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Typecheck + floor**

Run: `npm run typecheck`
Expected: clean. Then `npx vitest run src/hooks/__tests__/sseCoalescing.test.ts --maxWorkers=3` (parser tolerance unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/lib/dispatch.ts apps/dashboard/src/lib/__tests__/dispatch.test.ts
git commit -m "feat(copilot): frontend dispatch lib"
```

---

### Task 6: Dispatch bell in the ministry shell

**Files:**
- Modify: `apps/dashboard/src/pages/MinistryShell.tsx` (trading nav)
- Test: `apps/dashboard/src/pages/ministry/__tests__/DispatchBell.test.tsx`

**Interfaces:**
- Consumes: `useRealtimeSuite` snapshot `.dispatch` (Task 3 section: `{ unread, entries }`); `fetchDispatch` fallback.
- Produces: a trading-suite nav entry "Dispatch" with an unread badge; falls back to `fetchDispatch()` when the snapshot section is null; clicking routes to `../dispatch`.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/pages/ministry/__tests__/DispatchBell.test.tsx` — follow the `MinistryRoom.studio.test.tsx` RTL style (mock `useRealtimeSuite`):

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DispatchBell } from "../DispatchBell"

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({
    snapshot: { dispatch: { unread: 3, entries: [] } },
    live: null, connected: true, error: null
  })
}))

describe("DispatchBell", () => {
  it("renders the Dispatch nav link with the unread count", () => {
    render(<DispatchBell />)
    expect(screen.getByText("Dispatch")).toBeTruthy()
    expect(screen.getByText("3")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/ministry/__tests__/DispatchBell.test.tsx`
Expected: FAIL — `../DispatchBell` not found.

- [ ] **Step 3: Implement**

`apps/dashboard/src/pages/ministry/DispatchBell.tsx`:

```tsx
import { useEffect, useState } from "react"
import { NavLink } from "react-router-dom"
import { useRealtimeSuite } from "@/hooks/useRealtimeSuite"
import { fetchDispatch } from "@/lib/dispatch"

export function DispatchBell() {
  const { snapshot } = useRealtimeSuite()
  const liveUnread = snapshot?.dispatch?.unread ?? null
  const [fallback, setFallback] = useState<number | null>(null)

  useEffect(() => {
    if (liveUnread != null) return
    let alive = true
    fetchDispatch().then((inbox) => { if (alive) setFallback(inbox.unread) }).catch(() => {})
    return () => { alive = false }
  }, [liveUnread])

  const unread = liveUnread ?? fallback ?? 0
  return (
    <NavLink to="dispatch" className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
      <span className="nav-label">Dispatch</span>
      {unread > 0 ? <span className="nav-badge" aria-label={`${unread} unread`}>{unread}</span> : null}
    </NavLink>
  )
}
```

Add `"Dispatch"` to `INNER_NAV.trading` (between `command-centre` and `simulator`) and render the bell via `INNER_NAV` (make the single `dispatch` entry render `<DispatchBell />` inside the map, preserving other entries as plain NavLinks). If the shell map needs a per-entry override, add `render?: () => ReactNode` to the entry type or special-case `e.to === "dispatch"` in the map at `:48-56`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/pages/ministry/__tests__/DispatchBell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Floor**

Run: `npx vitest run src/pages/__tests__/ministryRooms.test.tsx src/pages/ministry/__tests__/MinistryRoom.studio.test.tsx --maxWorkers=3`
Expected: PASS (existing room/nav tests still green with the added entry).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/MinistryShell.tsx apps/dashboard/src/pages/ministry/DispatchBell.tsx apps/dashboard/src/pages/ministry/__tests__/DispatchBell.test.tsx
git commit -m "feat(copilot): dispatch bell in ministry shell"
```

---

### Task 7: Dispatch room

**Files:**
- Create: `apps/dashboard/src/pages/ministry/DispatchRoom.tsx`
- Modify: `apps/dashboard/src/pages/ministry/MinistryRoom.tsx` (`TRADING_ROOMS` at `:16-25`)
- Test: `apps/dashboard/src/pages/ministry/__tests__/DispatchRoom.test.tsx`

**Interfaces:**
- Consumes: `useRealtimeSuite` snapshot `.dispatch`, `fetchDispatch`, `markDispatchRead`, `KIND_LABEL`, `SEVERITY_LABEL` (Task 5/6).
- Produces: `DispatchRoom` lazy page (registered under `TRADING_ROOMS.dispatch`) — renders the dispatch inbox, severity-toned entries, per-entry mark-read (calls `markDispatchRead`, then refetches), honest empty state ("The registers are empty" + next action), stale-guard text when the stream is disconnected.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/pages/ministry/__tests__/DispatchRoom.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { DispatchRoom } from "../DispatchRoom"

vi.mock("@/hooks/useRealtimeSuite", () => ({
  useRealtimeSuite: () => ({ snapshot: { dispatch: null }, live: null, connected: true, error: null })
}))
vi.mock("@/lib/dispatch", () => ({
  fetchDispatch: vi.fn().mockResolvedValue({
    ok: true, unread: 1,
    entries: [{ id: "d1", kind: "decision", severity: "info", title: "EURUSD TRADE", body: "cost line passes", ref: null, ts: 1, read: false }]
  }),
  markDispatchRead: vi.fn().mockResolvedValue({ ok: true }),
  KIND_LABEL: { decision: "Decision" },
  SEVERITY_LABEL: { info: "Info" }
}))

describe("DispatchRoom", () => {
  it("renders the inbox title and entries", async () => {
    render(<DispatchRoom />)
    expect(await screen.findByText("Dispatch")).toBeTruthy()
    expect(await screen.findByText("EURUSD TRADE")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/pages/ministry/__tests__/DispatchRoom.test.tsx`
Expected: FAIL — module not found / no content.

- [ ] **Step 3: Implement**

`apps/dashboard/src/pages/ministry/DispatchRoom.tsx` — a stack room like `DashboardRoom.tsx`: header `<header data-room="dispatch">`, then either an honest empty state (engraved note + "no dispatch yet — decisions, feed losses and venue notices appear here") or a list of entries with `data-severity={severity}` classes, per-entry Read button wiring `markDispatchRead(id)` then `setInbox(await fetchDispatch())`. Disconnected → a muted line "stream reconnecting — showing last known dispatch". Use existing token classes (`stack`, `muted`, `small`, `panel`/`tile` classes already in the app's CSS).

Register in `MinistryRoom.tsx`:

```ts
dispatch: lazy(() => import("./DispatchRoom").then((m) => ({ default: m.DispatchRoom }))),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/pages/ministry/__tests__/DispatchRoom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Floor + routing proof**

Run: `npx vitest run src/pages/__tests__/ministryRooms.test.tsx src/pages/ministry/__tests__/MinistryRoom.studio.test.tsx --maxWorkers=3`
Expected: PASS.

- [ ] **Step 6: Typecheck + full floor**

Run: `npm run typecheck`
Expected: clean. Then `npm test` — note the known order-coupled flake family (`autopilotRoutes`, `useCandleData.freshness`, `TradingSuite.deeplink`) may fail on the aggregate; re-run each in isolation to confirm they are the flake, not regressions.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/pages/ministry/DispatchRoom.tsx apps/dashboard/src/pages/ministry/MinistryRoom.tsx apps/dashboard/src/pages/ministry/__tests__/DispatchRoom.test.tsx
git commit -m "feat(copilot): dispatch room"
```

---

### Task 8: docs ledger + closure

**Files:**
- Modify: `docs/superpowers/plans/2026-09-20-c1-dispatch-api-layer.md` (this file — status header)
- Test: none (documentation)

- [ ] **Step 1: Mark the plan complete**

Add a `**Status:** COMPLETE — date + commit range` line under the header listing the T1–T7 commit hashes (reuse the repo's closure convention from `PICC_FRONTEND_UI_RESKIN_v1.md:3`).

- [ ] **Step 2: Floor + typecheck confirmation**

Run: `npm run typecheck; npm test -- --maxWorkers=3`
Expected: typecheck clean; full floor green apart from the documented order-coupled flake family (confirmed passing isolated).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-09-20-c1-dispatch-api-layer.md
git commit -m "docs(copilot): C1 dispatch layer closure"
```

---

## Self-Review

**Spec coverage vs tasks:** §2 additive endpoints → T1/T2 (dispatch) + T4 (engine/v32); additive SSE dispatch section + richer status.v32 → T3; §3 Dispatch first-class (bell + room) → T6/T7; ADR-0005 additive-only + honesty → threaded into every task's tests and comments. C2 (Command Deck) is deliberately OUT of this plan — it is the next plan.

**Placeholder scan:** no TBD/TODO; every step has real test/implementation code. The POST body-parse note in T2 and the `INNER_NAV` override note in T6 are the only "verify at implementation" points — both give exact fallback instructions and line refs rather than leaving behavior open.

**Type consistency:** `DispatchEntry`/`DispatchInbox` shapes are identical across server entry (`dispatch.mjs` Task 1) and frontend interface (T5). `v32Register` row forwarding is contract-tested in T4 to equal the wire row exactly. `dispatchSection()` return shape used in T3 and consumed in T6/T7 matches field-for-field.