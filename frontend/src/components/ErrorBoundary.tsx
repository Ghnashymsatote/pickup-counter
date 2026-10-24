import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * A render error in one panel should not leave the counter screen blank with
 * no explanation, so the whole app is wrapped in this.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <main className="store-page">
        <section className="welcome-section">
          <h2>Something went wrong on this screen</h2>

          <p>
            Your order is safe — nothing is charged or released by a display
            problem. Reload to continue, or ask at the counter.
          </p>

          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      </main>
    );
  }
}
