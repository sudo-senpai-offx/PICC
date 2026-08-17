import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { generateKeyPairSync } from "node:crypto"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "../config.mjs"
import { chatJSON, chatText, llmConfigured, llmStatus, provider, configuredLLMProviders } from "../services/llm.mjs"
import { _setSettingsFile, _resetSettingsCache } from "../services/llmSettings.mjs"

const KEYS = [
  "geminiApiKey",
  "geminiServiceAccountFile",
  "geminiProjectId",
  "geminiLocation",
  "groqApiKey",
  "mistralApiKey",
  "cerebrasApiKey",
  "openaiApiKey",
  "llmProviders"
]

function snapshot() {
  const s = {}
  for (const k of KEYS) s[k] = env[k]
  return s
}

function restore(snap) {
  for (const k of KEYS) env[k] = snap[k]
}

function geminiOk(payload) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: payload }] } }]
    }),
    text: async () => ""
  }))
}

let tmp
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-llm-"))
  _setSettingsFile(join(tmp, "llm-settings.json"))
})
afterAll(() => {
  _resetSettingsCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe("cloud LLM orchestrator", () => {
  let saved
  beforeEach(() => {
    saved = snapshot()
    env.geminiApiKey = env.geminiServiceAccountFile = env.geminiProjectId = env.geminiLocation = env.groqApiKey = env.mistralApiKey = env.cerebrasApiKey = env.openaiApiKey = ""
    env.llmProviders = ""
  })
  afterEach(() => {
    restore(saved)
    vi.unstubAllGlobals()
  })

  it("reports nothing configured without keys", () => {
    expect(llmConfigured()).toBe(false)
    expect(configuredLLMProviders()).toEqual([])
  })

  it("honors LLM_PROVIDERS order and filters missing keys", () => {
    env.geminiApiKey = "g"
    env.cerebrasApiKey = "c"
    env.llmProviders = "cerebras,groq,gemini"
    expect(configuredLLMProviders()).toEqual(["cerebras", "gemini"])
  })

  it("parses JSON from the Gemini provider via stubbed fetch", async () => {
    env.geminiApiKey = "test-key"
    const fetchMock = geminiOk('{"headline":"Hi","tags":["a","b"]}')
    vi.stubGlobal("fetch", fetchMock)

    const out = await chatJSON("sys", "user")
    expect(out).toEqual({ headline: "Hi", tags: ["a", "b"] })
    expect(provider()).toBe("gemini")
    expect(llmStatus().configured[0].id).toBe("gemini")

    const call = fetchMock.mock.calls[0]
    expect(call[0]).toContain("generativelanguage.googleapis.com")
    const body = JSON.parse(call[1].body)
    expect(body.generationConfig.responseMimeType).toBe("application/json")
    expect(call[1].headers["x-goog-api-key"]).toBe("test-key")
  })

  it("strips markdown fences around JSON", async () => {
    env.geminiApiKey = "test-key"
    vi.stubGlobal("fetch", geminiOk('```json\n{"ok":true}\n```'))
    await expect(chatJSON("sys", "user")).resolves.toEqual({ ok: true })
  })

  it("returns plain text from the text mode without json mime", async () => {
    env.geminiApiKey = "test-key"
    vi.stubGlobal("fetch", geminiOk("Short commentary here."))
    const out = await chatText("sys", "user")
    expect(out).toBe("Short commentary here.")
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.generationConfig.responseMimeType).toBeUndefined()
  })

  it("fails over to the next provider when the first errors", async () => {
    env.geminiApiKey = "bad"
    env.groqApiKey = "good"
    env.llmProviders = "gemini,groq"
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
        text: async () => ""
      })
    vi.stubGlobal("fetch", fetchMock)

    const out = await chatJSON("sys", "user")
    expect(out).toEqual({ ok: true })
    expect(provider()).toBe("groq")
    // The second call went to Groq's OpenAI-compatible endpoint with the groq key.
    expect(fetchMock.mock.calls[1][0]).toContain("api.groq.com")
  })

  it("throws a combined error when every provider fails", async () => {
    env.geminiApiKey = "bad"
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network down"))))
    await expect(chatJSON("sys", "user")).rejects.toThrow(/network down/)
  })

  it("authenticates via a Vertex OAuth token exchange when only a service account is set", async () => {
    // Generate a throwaway RSA key so the JWT signature step is real.
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const pem = privateKey.export({ type: "pkcs8", format: "pem" })
    const dir = mkdtempSync(join(tmpdir(), "picc-sa-"))
    const saPath = join(dir, "sa.json")
    writeFileSync(
      saPath,
      JSON.stringify({
        type: "service_account",
        project_id: "test",
        private_key_id: "abc123",
        client_email: "sa@example.iam.gserviceaccount.com",
        token_uri: "https://oauth2.googleapis.com/token",
        private_key: pem
      })
    )
    env.geminiApiKey = ""
    env.geminiServiceAccountFile = saPath
    env.geminiProjectId = "test-project"
    env.geminiLocation = "us-central1"

    const tokenFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "ya29.test-token" }),
      text: async () => ""
    })
    const genFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }),
      text: async () => ""
    })
    vi.stubGlobal(
      "fetch",
      vi.fn((...args) => (String(args[0]).includes("oauth2.googleapis.com/token") ? tokenFetch(...args) : genFetch(...args)))
    )

    const out = await chatJSON("sys", "user")
    expect(out).toEqual({ ok: true })
    expect(provider()).toBe("gemini")

    // First call exchanges the signed service-account JWT for an OAuth token.
    expect(tokenFetch).toHaveBeenCalledTimes(1)
    const tokenBody = Object.fromEntries(tokenFetch.mock.calls[0][1].body.entries())
    expect(tokenBody.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer")
    const [h, c, sig] = tokenBody.assertion.split(".")
    expect(JSON.parse(Buffer.from(h, "base64url"))).toMatchObject({ alg: "RS256" })
    expect(JSON.parse(Buffer.from(c, "base64url"))).toMatchObject({
      iss: "sa@example.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token"
    })
    expect(sig).toBeTruthy()

    // Then the model call goes to the Vertex endpoint with the OAuth bearer.
    expect(genFetch).toHaveBeenCalledTimes(1)
    const genCall = genFetch.mock.calls[0]
    expect(genCall[0]).toContain("aiplatform.googleapis.com")
    expect(genCall[0]).toContain("us-central1")
    expect(genCall[0]).toContain("test-project")
    expect(genCall[1].headers.Authorization).toBe("Bearer ya29.test-token")

    rmSync(dir, { recursive: true, force: true })
  })
})
