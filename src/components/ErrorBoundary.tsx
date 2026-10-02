import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";

/**
 * Render-crash insurance. Without this, one throwing component white-screens
 * the whole Mini App; with it, the user gets an honest "something broke" card
 * and a one-tap retry instead of a dead webview.
 *
 * Copy comes from i18n so a Persian user never meets an English error card —
 * a class component can't call useI18n, so the strings are read by an inner
 * function component (the boundary itself stays a class: error boundaries
 * must be classes).
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
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <FallbackCard onRetry={this.reset} />;
  }
}

function FallbackCard({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div role="alert" className="grid min-h-[100svh] place-items-center px-6">
      <div className="w-full max-w-[380px] rounded-card border border-line bg-surface p-5 text-center">
        <p className="text-3xl" aria-hidden="true">
          ⚽
        </p>
        <p className="mt-2 text-base font-bold text-ink">{t("errorBoundary.title")}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">{t("errorBoundary.body")}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 w-full rounded-full bg-volt px-4 text-sm font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"
        >
          {t("errorBoundary.retry")}
        </button>
      </div>
    </div>
  );
}
