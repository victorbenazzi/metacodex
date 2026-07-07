import { Component, type ReactNode, type ErrorInfo } from "react";

import { CMD, invoke } from "@/lib/ipc";
import { recordDiag } from "@/features/diagnostics/diagnostics.store";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * Last-resort safety net wrapped around the whole UI in App.tsx. A render-time
 * throw anywhere below the boundary lands here instead of blanking the WebView;
 * the user gets a "Reload" button + the chance to copy a structured crash blob.
 *
 * We also persist the crash JSON to ~/.metacodex/state/last-crash.json so the
 * user (or support) can read it after the next launch — there's no console
 * once the app crashes.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    recordDiag("error_boundary.caught", {
      detail: {
        message: error.message,
        stack: error.stack ?? null,
        componentStack: info.componentStack ?? null,
      },
    });
    void invoke(CMD.diagWriteCrash, {
      payload: JSON.stringify(
        {
          ts: new Date().toISOString(),
          message: error.message,
          stack: error.stack ?? null,
          componentStack: info.componentStack ?? null,
        },
        null,
        2,
      ),
    }).catch(() => undefined);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopy = () => {
    if (!this.state.error) return;
    const text = [
      this.state.error.message,
      "",
      this.state.error.stack ?? "",
      "",
      this.state.componentStack ?? "",
    ].join("\n");
    void navigator.clipboard.writeText(text).catch(() => undefined);
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas px-8 text-ink">
        <div className="max-w-[560px] rounded-lg border border-hairline bg-surface-card p-8 shadow-elevated">
          <div className="text-caption text-muted">metacodex</div>
          <h1 className="mt-2 text-display-s font-semibold tracking-tight">
            Something broke unexpectedly
          </h1>
          <p className="mt-3 text-content text-body">
            The interface hit an error and stopped rendering. Reload to recover:
            your open files and projects are safe on disk. A crash report has
            been saved to <span className="font-mono text-caption">~/.metacodex/state/last-crash.json</span>.
          </p>
          <pre className="mt-4 max-h-[200px] overflow-auto whitespace-pre-wrap rounded-sm border border-hairline-soft bg-canvas-soft p-3 font-mono text-label text-muted">
            {this.state.error.message}
            {this.state.error.stack ? "\n\n" + this.state.error.stack : ""}
          </pre>
          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex h-9 items-center rounded-sm bg-primary px-4 text-ui font-medium text-on-primary hover:bg-primary-active"
            >
              Reload app
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex h-9 items-center rounded-sm border border-hairline px-4 text-ui text-ink hover:border-hairline-strong"
            >
              Copy error
            </button>
          </div>
        </div>
      </div>
    );
  }
}
