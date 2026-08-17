import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react"

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={cn("btn", `btn-${variant}`, className)} {...props} />
}

export function Card({
  className,
  style,
  children
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={cn("card", className)} style={style}>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input" {...props} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input" {...props} />
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn("toggle", checked && "toggle-on")}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

export function Badge({
  tone = "accent",
  children
}: {
  tone?: "accent" | "success" | "warn" | "danger" | "muted"
  children: ReactNode
}) {
  return <span className={cn("badge", `badge-${tone}`)}>{children}</span>
}

export function Spinner({ label = "Working…" }: { label?: string }) {
  return (
    <div className="spinner-row">
      <span className="spinner" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  )
}
