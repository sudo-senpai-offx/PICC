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

/**
 * Loading placeholder block. Render these (grouped, with aria-busy on the
 * surrounding container) instead of a single line of "Loading…" text so the
 * panel keeps its shape while data is in-flight.
 */
export function Skeleton({
  width = "100%",
  height = 14,
  style,
  className
}: {
  width?: number | string
  height?: number | string
  style?: CSSProperties
  className?: string
}) {
  return (
    <span
      className={cn("skeleton", className)}
      aria-hidden
      style={{ width, height, ...style }}
    />
  )
}
