import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { i18n } from "@/lib/i18n";

interface Props {
  /** Changing this value (e.g. the active section) clears a caught error. */
  resetKey?: unknown;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Contains a render crash to this subtree instead of unmounting the whole app.
 * Without it, a single view throwing (e.g. a bad API payload) tears down the
 * entire React root — the console goes blank and every click stops responding.
 * Resets automatically when `resetKey` changes, so navigating away recovers.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for debugging; the boundary keeps the rest of the app alive.
    console.error("View crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 px-5 py-6 text-sm">
          <h2 className="text-base font-semibold text-foreground">{i18n.t("shared.errorTitle")}</h2>
          <p className="text-muted-foreground">
            {i18n.t("shared.errorBody")}
          </p>
          <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 font-mono text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
          <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
            {i18n.t("shared.tryAgain")}
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
