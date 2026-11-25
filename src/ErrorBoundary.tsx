import { Component, type ReactNode } from "react";

/** Shows a recoverable message instead of a blank page if rendering fails. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("App error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div className="login" style={{ textAlign: "left" }}>
          <div className="brand big">
            <span className="logo">½M</span>
            <span>Half Million</span>
          </div>
          <h1>Something went wrong</h1>
          <p>The page hit an unexpected problem. Your data is safe — reload to continue.</p>
          <p className="muted small" style={{ wordBreak: "break-word" }}>
            {this.state.error.message}
          </p>
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
