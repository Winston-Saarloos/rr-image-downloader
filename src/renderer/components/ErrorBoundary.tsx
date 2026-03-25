import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/button';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fallback UI when an error is caught. Receives onRetry to reset and remount. */
  fallback?: ReactNode | ((onRetry: () => void) => ReactNode);
  /** Label for the section (e.g. "Photo viewer") used in default fallback message. */
  sectionName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

/**
 * Catches synchronous render errors in the child tree so a failure in one
 * section doesn't unmount the entire app. Provides a Reload action to remount.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', this.props.sectionName ?? 'Section', error, errorInfo.componentStack);
  }

  handleRetry = (): void => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryKey: prev.retryKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const fallback = this.props.fallback;
      if (typeof fallback === 'function') {
        return fallback(this.handleRetry);
      }
      if (fallback) {
        return fallback;
      }
      const name = this.props.sectionName ?? 'This section';
      const err = this.state.error;
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
          role="alert"
        >
          <p className="text-sm font-medium text-foreground">
            {name} had a problem and was stopped so the rest of the app keeps working.
          </p>
          <p className="text-xs text-muted-foreground max-w-sm">
            You can reload this section. If it happens again, try restarting the app.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="default" size="sm" onClick={this.handleRetry}>
              Reload this section
            </Button>
          </div>
          <details className="w-full max-w-md text-left text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none text-foreground/80">
              Technical details
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 font-mono">
              {err.message}
            </pre>
          </details>
        </div>
      );
    }

    return (
      <React.Fragment key={this.state.retryKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}
