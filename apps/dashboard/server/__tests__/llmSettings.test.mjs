import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { env } from "../config.mjs"
import {
  saveLLMSettings,
  llmProviderConfig,
  llmFailoverOrder,
  configuredLLMProviders,
  llmConfigured,
  llmSettingsView,
  _setSettingsFile,
  _resetSettingsCache
} from "../services/llmSettings.mjs"

let tmp

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "picc-llmsettings-"))
  _setSettingsFile(join(tmp, "llm-settings.json"))
  env.geminiApiKey = env.geminiServiceAccountFile = env.groqApiKey = env.mistralApiKey = env.cerebrasApiKey = env.openaiApiKey = ""
  env.customLlmBaseUrl = env.customLlmApiKey = env.customLlmModel = ""
  env.llmProviders = ""
})

afterAll(() => {
  _resetSettingsCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe("llmSettings runtime provider store", () => {
  it("reflects .env keys without any saved overrides", () => {
    env.groqApiKey = "groq-env"
    env.llmProviders = "groq,gemini"
    expect(configuredLLMProviders()).toEqual(["groq"])
    expect(llmProviderConfig("groq").hasKey).toBe(true)
    expect(llmProviderConfig("groq").model).toBe("llama-3.3-70b-versatile")
  })

  it("persists a model override and merges it over env", () => {
    saveLLMSettings({ providers: { groq: { model: "llama-3.1-8b-instant" } } })
    expect(llmProviderConfig("groq").model).toBe("llama-3.1-8b-instant")
    expect(llmProviderConfig("groq").hasKey).toBe(true)
  })

  it("a saved apiKey overrides env and a blank apiKey clears it again", () => {
    saveLLMSettings({ providers: { groq: { apiKey: "saved-key" } } })
    expect(llmProviderConfig("groq").apiKey).toBe("saved-key")
    saveLLMSettings({ providers: { groq: { apiKey: "" } } })
    expect(llmProviderConfig("groq").apiKey).toBe("groq-env")
  })

  it("saved failover order wins over LLM_PROVIDERS", () => {
    saveLLMSettings({ order: ["mistral", "groq"] })
    env.mistralApiKey = "m"
    expect(llmFailoverOrder()).toEqual(["mistral", "groq"])
    expect(configuredLLMProviders()).toEqual(["mistral", "groq"])
    expect(llmConfigured()).toBe(true)
  })

  it("custom provider requires a base URL and honors enabled", () => {
    expect(llmProviderConfig("custom").hasKey).toBe(false)
    saveLLMSettings({
      providers: {
        custom: { baseUrl: "https://example.com/v1", apiKey: "k", model: "my-model", enabled: true }
      }
    })
    const c = llmProviderConfig("custom")
    expect(c.hasKey).toBe(true)
    expect(c.baseUrl).toBe("https://example.com/v1")
    expect(c.model).toBe("my-model")
    saveLLMSettings({ providers: { custom: { enabled: false } } })
    expect(llmProviderConfig("custom").hasKey).toBe(false)
  })

  it("settings view never exposes key material", () => {
    const v = llmSettingsView()
    expect(v.order.length).toBeGreaterThan(0)
    for (const p of Object.values(v.providers)) {
      expect(p).not.toHaveProperty("apiKey")
    }
    expect(v.providers.groq.apiKeySet).toBe(true)
  })
})
