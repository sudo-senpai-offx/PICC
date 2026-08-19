import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ChartErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error) {
    console.warn("[PICC] chart error:", error.message)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{
          padding: "12px 16px",
          background: "rgba(255,107,107,0.08)",
          border: "1px solid rgba(255,107,107,0.3)",
          borderRadius: 6,
          fontSize: 12,
          color: "#ff6b6b"
        }}>
          <strong>Chart error</strong>
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "#a5a0ff" }}>
            {this.state.error?.message ?? "Failed to render chart"}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
