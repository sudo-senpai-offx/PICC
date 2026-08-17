import { useState } from "react"
import { Button, Card, Field, Input, Select, Spinner, Badge } from "./ui"
import { HumanReviewGate } from "./HumanReviewGate"
import { generateContent, logAgentAction, SOURCE_LABELS } from "@/lib/api"
import { appendData } from "@/lib/localdata"
import { useUser, useAuth } from "@/hooks/useAuth"
import type { ContentResult } from "@/lib/types"

const KINDS = [
  { value: "blog", label: "Blog post" },
  { value: "youtube_script", label: "YouTube script" },
  { value: "affiliate_review", label: "Affiliate review" },
  { value: "newsletter", label: "Newsletter" },
  { value: "social", label: "Social post" },
  { value: "tiktok_script", label: "TikTok / Shorts script" },
  { value: "short_video", label: "Short video (30-60s)" },
  { value: "x_thread", label: "X / Twitter thread" }
]

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "casual", label: "Casual" },
  { value: "hype", label: "Hype / energetic" },
  { value: "minimal", label: "Minimal" }
]

const LENGTHS = [
  { value: "short", label: "Short" },
  { value: "standard", label: "Standard" },
  { value: "long", label: "Long" }
]

export function ContentStudio() {
  const user = useUser()
  const { session } = useAuth()
  const [kind, setKind] = useState("youtube_script")
  const [topic, setTopic] = useState("")
  const [tone, setTone] = useState("professional")
  const [length, setLength] = useState("standard")
  const [result, setResult] = useState<ContentResult | null>(null)
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    const res = await generateContent({ kind, topic, tone, length }, user?.id, session?.access_token)
    setResult(res)
    setBusy(false)
    await logAgentAction(user?.id, "Content Creator", "generate_content", { kind, topic, tone, length }, res.draft)
    if (user) {
      await appendData("content_drafts", {
        user_id: user.id,
        kind,
        topic,
        draft: res.draft
      }).catch(() => undefined)
    }
  }

  return (
    <div className="stack">
      <Card>
        <form
          className="grid-2"
          onSubmit={(e) => {
            e.preventDefault()
            void generate()
          }}
        >
          <Field label="Content type">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic" hint="e.g. REIT investing in Southeast Asia 2026">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} required placeholder="Your topic…" />
          </Field>
          <Field label="Tone">
            <Select value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Length">
            <Select value={length} onChange={(e) => setLength(e.target.value)}>
              {LENGTHS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Generating content…" : "Generate draft"}
            </Button>
          </div>
        </form>
      </Card>

      {busy ? <Spinner label="Researching and drafting…" /> : null}

      {result ? (
        <Card className="stack">
          <h2 className="h2">
            {result.draft.headline}
            <Badge tone={SOURCE_LABELS[result.source]?.real ? "success" : "muted"}>
              {SOURCE_LABELS[result.source]?.label ?? result.source}
            </Badge>
          </h2>

          {result.research?.length ? (
            <div className="research-strip">
              <span className="metric-label">Live research sources</span>
              <div className="row wrap">
                {result.research.slice(0, 4).map((r, i) => (
                  <a key={i} href={r.link} target="_blank" rel="noreferrer" className="chip">
                    {r.title.slice(0, 48)}
                    {r.source ? <span className="muted small"> · {r.source}</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="draft-section">
            <div className="row space-between">
              <h3 className="h3">Script</h3>
              <HumanReviewGate
                surface="content_studio.script"
                suggestionId={`draft-${result.kind}-script`}
                confirmLabel="📋 Copy script"
                meta={{ topic: result.topic }}
                onConfirm={() => navigator.clipboard.writeText(result.draft.script)}
              />
            </div>
            <pre className="pre">{result.draft.script}</pre>
          </div>

          <div className="draft-section">
            <div className="row space-between">
              <h3 className="h3">SEO tags</h3>
              <HumanReviewGate
                surface="content_studio.tags"
                suggestionId={`draft-${result.kind}-tags`}
                confirmLabel="📋 Copy tags"
                meta={{ topic: result.topic }}
                onConfirm={() => navigator.clipboard.writeText(result.draft.tags.join(", "))}
              />
            </div>
            <p className="muted">{result.draft.tags.join(" · ")}</p>
          </div>

          <div className="draft-section">
            <div className="row space-between">
              <h3 className="h3">Call to action</h3>
              <HumanReviewGate
                surface="content_studio.cta"
                suggestionId={`draft-${result.kind}-cta`}
                confirmLabel="📋 Copy CTA"
                meta={{ topic: result.topic }}
                onConfirm={() => navigator.clipboard.writeText(result.draft.cta)}
              />
            </div>
            <p className="muted">{result.draft.cta}</p>
          </div>

          <p className="muted small">
            PICC does not auto-publish. Copy the draft and paste it into your own platform — the
            human-review gate above keeps you (and the law) in control.
          </p>
        </Card>
      ) : null}
    </div>
  )
}
