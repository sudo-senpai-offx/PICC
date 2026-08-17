import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { signUpLocal, signInLocal, getAuthStatus } from "@/lib/auth"
import { Button, Card, Field, Input } from "@/components/ui"

export function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getAuthStatus().then((s) => {
      if (!s.hasUsers) setMode("signup")
    })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === "signup") await signUpLocal(email, password, name)
      else await signInLocal(email, password)
      navigate("/")
    } catch (err) {
      const msg = (err as Error).message
      setError(msg)
      if (mode === "signin" && /no account/i.test(msg)) setMode("signup")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <Card className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">🧠</span>
          <h1>Passive Income Command Center</h1>
          <p className="muted">
            Simulate, plan, and optimize passive income streams with AI — you stay in control.
          </p>
        </div>

        <form onSubmit={submit} className="stack">
          {mode === "signup" ? (
            <Field label="Display name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
            </Field>
          ) : null}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </Field>
          {error ? <p className="form-error">{error}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        {mode === "signup" ? (
          <p className="muted small">
            Your account and credentials live only on this machine — nothing is sent to a cloud service.
          </p>
        ) : null}

        <p className="muted text-center">
          {mode === "signin" ? "No account yet?" : "Already have an account?"}{" "}
          <button type="button" className="link-btn" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </Card>
    </div>
  )
}
