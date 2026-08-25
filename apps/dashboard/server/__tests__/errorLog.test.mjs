import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { handleApi } from "../handlers.mjs"
import {
  initErrorLog,
  writeErrorEntry,
  recordClientReport,
  errorLogEnabled,
  _resetErrorLogForTests
} from "../errorLog.mjs"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const LOG_FILE = join(tmpdir(), `picc-errorlog-test-${process.pid}-${Date.now()}.log`)

function makeReq(method, url, body, headers = {}) {
  const raw = body !== undefined ? JSON.stringify(body) : null
  return {
    method,
    url,
    headers: { host: "localhost", "content-type": "application/json", ...headers },
    raw,
    on(evt, cb) {
      if (evt === "data" && raw != null) cb(raw)
      if (evt === "end") cb()
    }
  }
}

function makeRes() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    }
  }
}

async function call(method, path, body) {
  const res = makeRes()
  await handleApi(makeReq(method, path, body), res, path)
  return res
}

function readLines() {
  if (!existsSync(LOG_FILE)) return []
  return readFileSync(LOG_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

/** Fresh launch semantics: clear the once-per-process guard, then init. */
function freshInit() {
  _resetErrorLogForTests()
  initErrorLog()
}

describe("root-level error log (PICC_ERROR_LOG)", () => {
  let flag
  let fileOverride

  beforeEach(() => {
    flag = process.env.PICC_ERROR_LOG
    fileOverride = process.env.PICC_ERROR_LOG_FILE
    process.env.PICC_ERROR_LOG = "1"
    process.env.PICC_ERROR_LOG_FILE = LOG_FILE
    rmSync(LOG_FILE, { force: true })
  })

  afterEach(() => {
    if (flag === undefined) delete process.env.PICC_ERROR_LOG
    else process.env.PICC_ERROR_LOG = flag
    if (fileOverride === undefined) delete process.env.PICC_ERROR_LOG_FILE
    else process.env.PICC_ERROR_LOG_FILE = fileOverride
    rmSync(LOG_FILE, { force: true })
  })

  it("is off unless the flag is exactly '1'", () => {
    expect(errorLogEnabled()).toBe(true)
    process.env.PICC_ERROR_LOG = "0"
    expect(errorLogEnabled()).toBe(false)
    process.env.PICC_ERROR_LOG = ""
    expect(errorLogEnabled()).toBe(false)
    delete process.env.PICC_ERROR_LOG
    expect(errorLogEnabled()).toBe(false)
  })

  it("empties the log and writes a session header on launch", () => {
    writeErrorEntry({ source: "server", message: "stale from a previous run" })
    expect(readLines().length).toBe(1)

    freshInit()
    const lines = readLines()
    expect(lines.length).toBe(1)
    expect(lines[0].type).toBe("session")
    expect(lines[0].event).toBe("launch")
    expect(Number.isInteger(lines[0].pid)).toBe(true)
  })

  it("appends JSON-line entries after initialization", () => {
    freshInit()
    expect(writeErrorEntry({ source: "server", channel: "console.error", message: "boom" })).toBe(true)
    const lines = readLines()
    expect(lines.length).toBe(2)
    expect(lines[1].message).toBe("boom")
    expect(lines[1].channel).toBe("console.error")
    expect(lines[1].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("writes nothing while the flag is off", () => {
    process.env.PICC_ERROR_LOG = "0"
    freshInit()
    expect(writeErrorEntry({ source: "server", message: "ignored" })).toBe(false)
    expect(recordClientReport({ message: "ignored" })).toBe(0)
    expect(existsSync(LOG_FILE)).toBe(false)
  })

  it("persists client reports through the /api/client-logs endpoint", async () => {
    freshInit()
    const res = await call("POST", "/api/client-logs", {
      source: "web",
      context: "dashboard",
      entries: [
        { level: "error", message: "TypeError: x is not a function", stack: "at f (/src/app.tsx:1:1)", ts: Date.now() },
        { level: "warn", message: "degraded provider" }
      ]
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.written).toBe(2)
    expect(res.body.disabled).toBeUndefined()

    const lines = readLines().filter((l) => l.type === "client")
    expect(lines.length).toBe(2)
    expect(lines[0].source).toBe("web")
    expect(lines[0].message).toContain("TypeError")
    expect(lines[0].clientTs).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("acknowledges but drops client reports when disabled", async () => {
    freshInit()
    process.env.PICC_ERROR_LOG = "0"
    const res = await call("POST", "/api/client-logs", {
      entries: [{ level: "error", message: "should be dropped" }]
    })
    expect(res.status).toBe(200)
    expect(res.body.disabled).toBe(true)
    expect(res.body.written).toBe(0)
    expect(readFileSync(LOG_FILE, "utf8").includes("should be dropped")).toBe(false)
  })

  it("rejects malformed client payloads without touching disk", async () => {
    freshInit()
    const before = readLines().length
    const res = await call("POST", "/api/client-logs", { entries: [{ noMessage: true }, "junk", null] })
    expect(res.status).toBe(200)
    expect(res.body.written).toBe(0)
    expect(readLines().length).toBe(before)
  })
})
