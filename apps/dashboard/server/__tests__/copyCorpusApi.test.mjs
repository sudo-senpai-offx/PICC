// Task 6 — additive read API: GET /api/research/corpus (§5.4/§6/§9).
//
// Hermetic: handlers is imported FRESH per test with PICC_COPYCORPUS_DATA_DIR
// pointed at a tmp dir (the copyCorpusStore/tradeJournal pattern — server
// modules capture env at IMPORT time, so the redirect must precede import and
// vi.resetModules() must run between tests). PICC_COPYCORPUS_DATA_DIR is not
// on the shared isolation contract, so it is hand-rolled here exactly like
// copyCorpusStore.test.mjs / copyCorpusIngest.test.mjs /
// copyCorpusRetention.test.mjs; no contract variable is hand-rolled.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function makeReq(method, url, headers = {}) {
  return {
    method,
    url,
    headers: { host: "localhost", ...headers },
    socket: { remoteAddress: "127.0.0.1" }, // clientIp() → isLocalhostRequest
    on(evt, cb) {
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    req: { headers: {} },
    setHeader() {},
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(handleApi, method, path) {
  const res = makeRes()
  await handleApi(makeReq(method, path), res, path)
  return res
}

describe("GET /api/research/corpus", () => {
  let dir
  let handleApi
  let store

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "picc-corpus-api-"))
    process.env.PICC_COPYCORPUS_DATA_DIR = dir
    vi.resetModules()
    handleApi = (await import("../handlers.mjs")).handleApi
    store = await import("../services/copyCorpusStore.mjs")
  })

  afterEach(() => {
    delete process.env.PICC_COPYCORPUS_DATA_DIR
    store._resetCopyCorpusForTest()
    vi.resetModules()
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns bias-headed aggregates without touching existing payloads", async () => {
    const res = await call(handleApi, "GET", "/api/research/corpus")
    expect(res.status).toBe(200)
    expect(res.body.bias).toBeDefined()
    expect(typeof res.body.bias.nAccountsObserved).toBe("number")
    expect(typeof res.body.bias.nDormant).toBe("number")
    expect(typeof res.body.bias.nLiquidated).toBe("number")
    expect(Array.isArray(res.body.regimes)).toBe(true)
    expect(res.body.survival).toBeDefined()
    expect(res.body.behaviour).toBeDefined()
    // No existing route changed: the scheduler status shape is intact.
    const sched = await call(handleApi, "GET", "/api/scheduler/status")
    expect(sched.status).toBe(200)
    expect(sched.body.ok).toBe(true)
    expect(Array.isArray(sched.body.jobs)).toBe(true)
  })

  it("reflects seeded external samples with honest counts and regime filter", async () => {
    store.appendExternalSample({
      venue: "hyperliquid",
      accountRef: "a1",
      regime: "trend",
      stateBefore: "drawdown-5pct",
      sizeResponse: "cut"
    })
    store.appendExternalSample({
      venue: "hyperliquid",
      accountRef: "a2",
      regime: "chop",
      stateBefore: "after-2-losses",
      sizeResponse: "halved",
      outcomeKind: "liquidated"
    })
    const res = await call(handleApi, "GET", "/api/research/corpus")
    expect(res.status).toBe(200)
    expect(res.body.bias.nAccountsObserved).toBe(2)
    expect(res.body.bias.nLiquidated).toBe(1)
    expect(res.body.regimes.sort()).toEqual(["chop", "trend"])
    const trend = await call(handleApi, "GET", "/api/research/corpus?regime=trend")
    expect(trend.status).toBe(200)
    expect(trend.body.bias.nAccountsObserved).toBe(2) // header still covers the whole corpus (§5.4)
    expect(trend.body.regimes).toEqual(["trend"])
  })

  it("mixes no owner data by default; ?includeOwner=true labels each block with its origin", async () => {
    store.appendExternalSample({
      venue: "hyperliquid",
      accountRef: "a1",
      regime: "trend",
      stateBefore: "drawdown-5pct",
      sizeResponse: "cut"
    })
    const plain = await call(handleApi, "GET", "/api/research/corpus")
    expect(plain.status).toBe(200)
    expect(plain.body.owner).toBeUndefined() // §6: no mixing without the explicit flag
    const flagged = await call(handleApi, "GET", "/api/research/corpus?includeOwner=true")
    expect(flagged.status).toBe(200)
    expect(flagged.body.external.origin).toBe("external")
    expect(flagged.body.owner.origin).toBe("owner")
    expect(flagged.body.bias).toBeDefined() // §5.4 header present on the mixed path too
    for (const rule of flagged.body.external.behaviour.rules) {
      expect(typeof rule.ownerComparable).toBe("boolean")
    }
  })
})
