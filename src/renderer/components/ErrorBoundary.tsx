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
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
          role="alert"
        >
          <p className="text-sm text-muted-foreground">
            {name} failed to load.
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            Reload
          </Button>
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
