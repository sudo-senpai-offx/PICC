// Cloud LLM orchestrator with automatic failover across providers.
// Order and per-provider keys/models come from the runtime settings store
// (Settings page) merged over .env defaults. All calls are decision-support
// text/JSON only — no tool execution. If every provider fails, callers fall
// back to the local rule engine (see handlers.mjs).
import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"
import { env } from "../config.mjs"
import {
  llmProviderConfig,
  llmConfigured,
  configuredLLMProviders
} from "./llmSettings.mjs"

const JSON_SYSTEM =
  "You are PICC, a decision-support assistant. Always reply with a single valid JSON object. Never use markdown fences."

let lastProviderId = null

/** Id of the provider that succeeded on the most recent call (for badges). */
export const provider = () => lastProviderId

/** Summary for /api/health. */
export function llmStatus() {
  return {
    configured: configuredLLMProviders().map((id) => ({ id, model: llmProviderConfig(id).model })),
    lastUsed: lastProviderId,
    failoverOrder: configuredLLMProviders()
  }
}

/** Ask the first working provider for structured JSON. Returns the parsed object. */
export function chatJSON(system, user, opts = {}) {
  return runAll("json", system, user, opts)
}

/** Ask the first working provider for free-form text. */
export function chatText(system, user, opts = {}) {
  return runAll("text", system, user, opts)
}

async function runAll(mode, system, user, opts) {
  const order = configuredLLMProviders()
  if (!order.length) {
    throw new Error(
      "no LLM provider configured (set a key in Settings or GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY, CEREBRAS_API_KEY, OPENAI_API_KEY or CUSTOM_LLM_* in .env)"
    )
  }
  const errors = []
  for (const id of order) {
    try {
      const out = await PROVIDERS[id](mode, system, user, opts)
      lastProviderId = id
      return out
    } catch (err) {
      errors.push(`${id}: ${err.message}`)
      console.warn(`[picc] llm "${id}" failed, trying next:`, err.message)
    }
  }
  throw new Error(errors.join(" | "))
}

// ---------------------------------------------------------------------
// Gemini (free tier — API key on AI Studio, or a Vertex service account)
//
// Auth modes:
//  1. GEMINI_API_KEY set                         -> x-goog-api-key on AI Studio
//  2. GEMINI_SERVICE_ACCOUNT_FILE + GEMINI_PROJECT_ID
//     + GEMINI_LOCATION set                      -> signed JWT exchanged for an
//     OAuth2 access token, then called via Vertex AI. The AI Studio API
//     rejects service accounts, so this is the only valid service-account path.
// ---------------------------------------------------------------------

function readServiceAccount() {
  const p = env.geminiServiceAccountFile
  if (!p) throw new Error("GEMINI_SERVICE_ACCOUNT_FILE not set")
  const path = isAbsolute(p) ? p : fileURLToPath(new URL(`../../${p}`, import.meta.url))
  return JSON.parse(readFileSync(path, "utf8"))
}

async function geminiOAuthToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const header = b64({ alg: "RS256", typ: "JWT" })
  const claims = b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  })
  const unsigned = `${header}.${claims}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    })
  })
  if (!res.ok) throw new Error(`Gemini token exchange HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  if (!json.access_token) throw new Error("Gemini token exchange returned no access_token")
  return json.access_token
}

async function geminiProvider(mode, system, user, opts) {
  const cfg = llmProviderConfig("gemini")
  const generationConfig = {
    temperature: mode === "json" ? 0.5 : 0.6,
    maxOutputTokens: opts.maxTokens ?? (mode === "json" ? 1200 : 700)
  }
  if (mode === "json") generationConfig.responseMimeType = "application/json"

  let url
  let headers
  if (cfg.apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`
    headers = { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey }
  } else {
    if (!cfg.projectId || !cfg.location) throw new Error("Gemini service-account auth needs GEMINI_PROJECT_ID + GEMINI_LOCATION")
    const token = await geminiOAuthToken(readServiceAccount())
    url = `https://${cfg.location}-aiplatform.googleapis.com/v1/projects/${cfg.projectId}/locations/${cfg.location}/publishers/google/models/${encodeURIComponent(cfg.model)}:generateContent`
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig
    })
  })
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`)
  const json = await res.json()
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  if (!text.trim()) throw new Error("Gemini returned empty output")
  return mode === "json" ? JSON.parse(stripFences(text)) : text.trim()
}

// ---------------------------------------------------------------------
// OpenAI-compatible providers (Groq / Mistral / Cerebras / OpenAI / Custom)
// ---------------------------------------------------------------------

const COMPAT_BASE_URLS = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  openai: "https://api.openai.com/v1"
}

function baseUrlFor(id) {
  const cfg = llmProviderConfig(id)
  if (cfg.baseUrl) return cfg.baseUrl.replace(/\/+$/, "")
  return COMPAT_BASE_URLS[id]
}

async function openaiCompatProvider(id, mode, system, user, opts) {
  const cfg = llmProviderConfig(id)
  const url = `${baseUrlFor(id)}/chat/completions`
  const payload = {
    model: cfg.model,
    temperature: mode === "json" ? 0.5 : 0.6,
    max_tokens: opts.maxTokens ?? (mode === "json" ? 1200 : 700),
    messages:
      mode === "json"
        ? [
            { role: "system", content: JSON_SYSTEM },
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        : [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
  }
  if (mode === "json") payload.response_format = { type: "json_object" }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey ?? ""}` },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error(`${id} HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`)
  const json = await res.json()
  const text = json.choices?.[0]?.message?.content ?? ""
  if (!text.trim()) throw new Error(`${id} returned empty output`)
  return mode === "json" ? JSON.parse(stripFences(text)) : text.trim()
}

const PROVIDERS = {
  gemini: geminiProvider,
  groq: (m, s, u, o) => openaiCompatProvider("groq", m, s, u, o),
  mistral: (m, s, u, o) => openaiCompatProvider("mistral", m, s, u, o),
  cerebras: (m, s, u, o) => openaiCompatProvider("cerebras", m, s, u, o),
  openai: (m, s, u, o) => openaiCompatProvider("openai", m, s, u, o),
  custom: (m, s, u, o) => openaiCompatProvider("custom", m, s, u, o)
}

/**
 * Quick connectivity + latency check for the Settings "Test" button.
 * Tests exactly the requested provider — no failover — so the result is
 * honest about that provider. Returns { ok, latencyMs, model } or
 * { ok:false, error }.
 */
export async function testLLMProvider(id) {
  const cfg = llmProviderConfig(id)
  if (!cfg.hasKey) {
    return { ok: false, provider: id, error: `not configured — add ${id === "custom" ? "a base URL" : "an API key"} first` }
  }
  const started = Date.now()
  try {
    const out = await PROVIDERS[id]("text", "You are a connectivity test. Reply with exactly one word: OK.", "Ping", {
      maxTokens: 8
    })
    lastProviderId = id
    return { ok: true, provider: id, model: cfg.model, latencyMs: Date.now() - started, reply: String(out).slice(0, 60) }
  } catch (err) {
    return { ok: false, provider: id, error: err.message, latencyMs: Date.now() - started }
  }
}

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
}

// ---------------------------------------------------------------------
// Shared output validation
// ---------------------------------------------------------------------

/** Verify a JSON array-of-objects shape survived the model. */
export function asSuggestionArray(value) {
  if (!Array.isArray(value)) throw new Error("model did not return a list")
  return value
    .filter((s) => s && typeof s === "object")
    .map((s, i) => ({
      id: String(s.id ?? `ai-${i}`),
      title: String(s.title ?? "Suggestion"),
      body: String(s.body ?? ""),
      confidence: Math.min(1, Math.max(0, Number(s.confidence) || 0.5))
    }))
    .filter((s) => s.body)
}

export { llmConfigured, configuredLLMProviders }
