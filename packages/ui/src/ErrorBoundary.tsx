import React from "react";

interface ErrorBoundaryProps {
  /** Scope label, shown in the fallback UI and logged alongside the error. */
  scope?: string;
  /** Called with the thrown error + React info on every catch. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Render prop for a custom fallback. Defaults to a minimal panel. */
  fallback?: (args: { error: Error; reset: () => void }) => React.ReactNode;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * React error boundary for the renderer. Wrap routes and the detail panel
 * so a render-time throw inside one subtree doesn't unmount the whole app.
 *
 * React requires error boundaries to be class components — there's no hook
 * equivalent for `componentDidCatch`.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.scope ? `:${this.props.scope}` : ""}]`, error, info);
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return (
        <div
          style={{
            padding: 24,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            height: "100%",
            color: "rgba(255,255,255,0.9)",
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ fontSize: 14, opacity: 0.7 }}>Something went wrong</div>
          <div style={{ fontSize: 12, opacity: 0.5, maxWidth: 360 }}>
            {this.state.error.message || "An unexpected error occurred while rendering this view."}
          </div>
          <button
            onClick={this.reset}
            style={{
              marginTop: 8,
              padding: "6px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.9)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
