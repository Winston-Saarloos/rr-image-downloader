import React, { useEffect, useRef, useState } from 'react';
import { Progress } from '../components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Progress as ProgressType } from '../../shared/types';
import {
  Loader2,
  CheckCircle2,
  X,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';

interface ProgressDisplayProps {
  progress: ProgressType;
  onClose?: () => void;
  onOpenOperationResults?: () => void;
  onOpenDownloadPanel?: () => void;
  onRetryDownload?: () => void | Promise<void>;
  canRetryDownload?: boolean;
  isRetrying?: boolean;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progress,
  onClose,
  onOpenOperationResults,
  onOpenDownloadPanel,
  onRetryDownload,
  canRetryDownload = false,
  isRetrying = false,
}) => {
  const percent = Math.min(
    Math.max(Math.round(progress.progress ?? 0), 0),
    100
  );
  const hasTotals = progress.total > 0;
  const isComplete = !progress.isRunning && percent >= 100;
  const isCancelled =
    !progress.isRunning && progress.currentStep === 'Cancelled';
  const hasIssues = progress.issueCount > 0;
  const hasFailures =
    !isCancelled &&
    (progress.failedItems > 0 || progress.statusLevel === 'error');
  const isRetryableCompletion =
    !progress.isRunning &&
    progress.currentStep === 'Complete' &&
    progress.failedItems > 0;
  const showErrorTone = hasFailures && !isRetryableCompletion;
  const showWarningTone = hasIssues || isRetryableCompletion;
  const [indeterminateValue, setIndeterminateValue] = useState(15);
  const directionRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (!progress.isRunning || hasTotals) {
      setIndeterminateValue(15);
      directionRef.current = 1;
      return;
    }

    const interval = setInterval(() => {
      setIndeterminateValue(prev => {
        const next = prev + directionRef.current * 6;

        if (next >= 85) {
          directionRef.current = -1;
          return 85;
        }

        if (next <= 15) {
          directionRef.current = 1;
          return 15;
        }

        return next;
      });
    }, 120);

    return () => clearInterval(interval);
  }, [progress.isRunning, hasTotals]);

  const isIdle =
    !progress.isRunning &&
    percent === 0 &&
    (!progress.currentStep || progress.currentStep === 'Ready');
  const barValue = hasTotals
    ? percent
    : progress.isRunning
      ? indeterminateValue
      : percent;
  const cardToneClass = isCancelled
    ? 'border-muted-foreground/30 bg-muted/30'
    : showErrorTone
      ? 'border-red-500/70 bg-red-50/70 dark:bg-red-950/20'
      : showWarningTone
        ? 'border-yellow-500/70 bg-yellow-50/70 dark:bg-yellow-950/20'
        : '';
  const progressToneClass = showErrorTone
    ? '[&>div]:bg-red-500'
    : showWarningTone
      ? '[&>div]:bg-yellow-500'
      : '';
  const statusToneClass = showErrorTone
    ? 'text-red-700 dark:text-red-300'
    : showWarningTone
      ? 'text-yellow-700 dark:text-yellow-300'
      : progress.isRunning
        ? 'text-primary'
        : 'text-muted-foreground';
  const canOpenIssueDetails =
    (showErrorTone || isRetryableCompletion) && !!onOpenOperationResults;
  const issueMessage = isRetryableCompletion
    ? 'The download finished, but some images were missed. Retry the download now to grab any missed images.'
    : progress.lastIssue ||
      'Some files are retrying. The download is still moving, but it is not clean.';

  if (isIdle) {
    return null;
  }

  return (
    <Card className={cardToneClass}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {isCancelled ? (
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            ) : showErrorTone ? (
              <AlertCircle className="h-5 w-5 text-red-500" />
            ) : showWarningTone ? (
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            ) : progress.isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : null}
            {isComplete &&
              !progress.isRunning &&
              !showWarningTone &&
              !isCancelled && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
            Download Progress
          </span>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide download info"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {isCancelled
            ? 'You cancelled this run. You can start a new download anytime.'
            : isRetryableCompletion
              ? 'Download complete. Retry the same download to grab any missed images.'
            : progress.currentStep || (isComplete ? 'Complete' : 'Ready')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {showWarningTone && !isCancelled && (
          <div
            className={
              showErrorTone
                ? `rounded-md border border-red-300 bg-red-100/80 p-3 dark:border-red-900 dark:bg-red-950/40 ${
                    canOpenIssueDetails ? 'cursor-pointer' : ''
                  }`
                : `rounded-md border border-yellow-300 bg-yellow-100/80 p-3 dark:border-yellow-900 dark:bg-yellow-950/40 ${
                    canOpenIssueDetails ? 'cursor-pointer' : ''
                  }`
            }
            onClick={canOpenIssueDetails ? onOpenOperationResults : undefined}
            role={canOpenIssueDetails ? 'button' : undefined}
            tabIndex={canOpenIssueDetails ? 0 : undefined}
            onKeyDown={
              canOpenIssueDetails
                ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenOperationResults?.();
                    }
                  }
                : undefined
            }
          >
            <div className="flex items-start gap-3">
              {showErrorTone ? (
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
              )}
              <div className="space-y-2">
                <div>
                  <p
                    className={
                      showErrorTone
                        ? 'font-medium text-red-800 dark:text-red-200'
                        : 'font-medium text-yellow-800 dark:text-yellow-200'
                    }
                  >
                    {showErrorTone
                      ? 'Download issues need attention'
                      : isRetryableCompletion
                        ? 'Download completed with missed images'
                        : 'Download issues detected'}
                  </p>
                  <p
                    className={
                      showErrorTone
                        ? 'text-sm text-red-700 dark:text-red-300'
                        : 'text-sm text-yellow-700 dark:text-yellow-300'
                    }
                  >
                    {issueMessage}
                  </p>
                  {canOpenIssueDetails && (
                    <p
                      className={
                        showErrorTone
                          ? 'pt-1 text-xs font-medium text-red-700 underline underline-offset-2 dark:text-red-300'
                          : 'pt-1 text-xs font-medium text-yellow-800 underline underline-offset-2 dark:text-yellow-200'
                      }
                    >
                      Click this area to jump to Operation Results.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border border-current/15 px-2 py-1">
                    Issue events: {progress.issueCount}
                  </div>
                  <div className="rounded border border-current/15 px-2 py-1">
                    Retries used: {progress.retryAttempts}
                  </div>
                  <div className="rounded border border-current/15 px-2 py-1">
                    Failed files: {progress.failedItems}
                  </div>
                  <div className="rounded border border-current/15 px-2 py-1">
                    Recovered: {progress.recoveredAfterRetry}
                  </div>
                </div>

                {(onOpenOperationResults ||
                  onOpenDownloadPanel ||
                  (onRetryDownload && canRetryDownload)) && (
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
                    {onOpenOperationResults && (
                      <Button
                        variant={showErrorTone ? 'destructive' : 'outline'}
                        size="sm"
                        onClick={event => {
                          event.stopPropagation();
                          onOpenOperationResults();
                        }}
                        className="w-full sm:w-auto"
                      >
                        Open Operation Messages
                      </Button>
                    )}
                    {onOpenDownloadPanel && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={event => {
                          event.stopPropagation();
                          onOpenDownloadPanel();
                        }}
                        className="w-full sm:w-auto"
                      >
                        Open download
                      </Button>
                    )}
                    {onRetryDownload &&
                      canRetryDownload &&
                      !progress.isRunning && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isRetrying}
                          onClick={event => {
                            event.stopPropagation();
                            void onRetryDownload();
                          }}
                          className="w-full sm:w-auto"
                        >
                          {isRetrying ? 'Retrying...' : 'Retry Download'}
                        </Button>
                      )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className={statusToneClass}>
            {isCancelled
              ? 'Cancelled'
              : progress.isRunning
                ? showErrorTone
                  ? 'Issues detected'
                  : showWarningTone
                    ? 'Retrying with warnings'
                    : 'In progress'
                : isComplete
                  ? isRetryableCompletion
                    ? 'Complete with missed images'
                    : showErrorTone
                      ? 'Complete with failures'
                      : showWarningTone
                      ? 'Complete with warnings'
                      : 'Complete'
                  : 'Idle'}
          </span>
        </div>

        {hasTotals && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-muted-foreground">
                {progress.current} / {progress.total} ({percent}%)
              </span>
            </div>
            <Progress value={barValue} className={`h-2 ${progressToneClass}`} />
          </>
        )}

        {!hasTotals && (
          <>
            <Progress value={barValue} className={`h-2 ${progressToneClass}`} />
            <div className="text-sm text-muted-foreground">
              {progress.currentStep || 'Waiting to start'}
            </div>
          </>
        )}

        {isCancelled && !progress.isRunning && (
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            {onOpenDownloadPanel && (
              <Button variant="outline" size="sm" onClick={onOpenDownloadPanel}>
                Open download
              </Button>
            )}
            {onRetryDownload && canRetryDownload && (
              <Button
                size="sm"
                disabled={isRetrying}
                onClick={() => void onRetryDownload()}
              >
                {isRetrying ? 'Starting…' : 'Run download again'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
