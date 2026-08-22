import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.warn("[PICC] render error:", error.message)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          fontFamily: "inherit",
          color: "#eef0ff"
        }}>
          <strong style={{ fontSize: 16 }}>Something went wrong</strong>
          <div style={{ fontSize: 12, color: "#ff6b6b", maxWidth: 560, wordBreak: "break-word" }}>
            {this.state.error.message || "An unexpected render error occurred."}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              border: "1px solid rgba(42,42,74,0.8)",
              borderRadius: 6,
              background: "rgba(108,99,255,0.2)",
              color: "#eef0ff",
              cursor: "pointer"
            }}
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "4px 12px",
              fontSize: 11,
              border: "none",
              background: "none",
              color: "#9aa0c0",
              cursor: "pointer"
            }}
          >
            Reload app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
