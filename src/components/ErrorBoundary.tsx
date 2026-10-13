import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "../lib/errorReporting";

/**
 * Render-crash insurance. Without this, one throwing component white-screens
 * the whole Mini App; with it, the user gets an honest "something broke" card
 * and a one-tap retry instead of a dead webview.
 *
 * The fallback copy is HARDCODED ENGLISH on purpose. This boundary sits
 * OUTSIDE <I18nProvider> (see main.tsx) and React renders a boundary's fallback
 * at the boundary's own position — so the provider is below the fallback, never
 * above it. Reading t() here threw "useI18n must be used inside <I18nProvider>"
 * and the recovery card became the white screen it exists to prevent. English
 * copy on a crashed screen beats a dead webview in Persian; localizing this
 * again means moving the provider ABOVE the boundary, not calling the hook here.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ui] render crash:", error, info.componentStack);
    // Forward to the server so the crash is reviewable after the fact, not
    // lost when the tab closes. Best-effort: see lib/errorReporting.ts.
    reportClientError({
      message: error.message,
      stack: info.componentStack ?? error.stack,
      url: window.location.href,
      source: "react-boundary",
    });
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <FallbackCard onRetry={this.reset} />;
  }
}

/**
 * Exported rather than module-private so this file's export surface is
 * components only: React Fast Refresh keys its HMR boundary off that, and
 * eslint-plugin-react-refresh does not recognise a class export (`ErrorBoundary`)
 * as a component — without this the file trips `only-export-components`.
 */
export function FallbackCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="grid min-h-[100svh] place-items-center px-6">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-surface p-5 text-center">
        <p className="text-3xl" aria-hidden="true">
          ⚽
        </p>
        <p className="mt-2 text-base font-bold text-ink">Something went wrong</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          The screen hit an unexpected error. Retrying usually fixes it.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 w-full rounded-full bg-volt px-4 text-sm font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
