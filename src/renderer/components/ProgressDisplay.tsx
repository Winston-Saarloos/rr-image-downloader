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
  Download,
} from 'lucide-react';
import { Button } from '../components/ui/button';

interface ProgressDisplayProps {
  progress: ProgressType;
  onClose?: () => void;
  onOpenOperationResults?: () => void;
  onOpenDownloadPanel?: () => void;
  onCancelDownload?: () => void | Promise<void>;
  onConfirmDownload?: () => void | Promise<void>;
  onSkipDownload?: () => void;
  onRetryDownload?: () => void | Promise<void>;
  canRetryDownload?: boolean;
  isRetrying?: boolean;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatImageCount(value: number): string {
  return `${formatCount(value)} new image${value === 1 ? '' : 's'}`;
}

function getDownloadPhaseLabel(source?: ProgressType['currentSource']): string {
  switch (source) {
    case 'user-feed':
      return 'Feed';
    case 'user-photos':
      return 'User';
    case 'profile-history':
      return 'Profile History';
    default:
      return 'Image';
  }
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progress,
  onClose,
  onOpenOperationResults,
  onOpenDownloadPanel,
  onCancelDownload,
  onConfirmDownload,
  onSkipDownload,
  onRetryDownload,
  canRetryDownload = false,
  isRetrying = false,
}) => {
  const percent = Math.min(
    Math.max(Math.round(progress.progress ?? 0), 0),
    100
  );
  const isConfirming = progress.phase === 'confirm' && !!progress.confirmation;
  const hasTotals = progress.total > 0 && !isConfirming;
  const isCancelled =
    progress.phase === 'cancelled' ||
    (!progress.isRunning && progress.currentStep === 'Cancelled');
  const isComplete = progress.phase === 'complete' && !progress.isRunning;
  const hasOutstandingFailures =
    !isCancelled &&
    (progress.phase === 'failed' ||
      progress.failedItems > 0 ||
      progress.statusLevel === 'error');
  const hasActiveWarnings =
    progress.isRunning && !hasOutstandingFailures && progress.issueCount > 0;
  const showErrorTone = hasOutstandingFailures;
  const showWarningTone = hasActiveWarnings;
  const [indeterminateValue, setIndeterminateValue] = useState(15);
  const directionRef = useRef<1 | -1>(1);

  useEffect(() => {
    if (!progress.isRunning || hasTotals || isConfirming) {
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
  }, [progress.isRunning, hasTotals, isConfirming]);

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

  if (isIdle) {
    return null;
  }

  const confirmation = progress.confirmation;
  const issueMessage =
    progress.lastIssue ||
    'The app hit a problem and is retrying or waiting for attention.';
  const completionFollowUpMessage =
    'Want to verify the download or grab any new photos later? Just run the download again and the app will only download new content.';
  const downloadPhaseMessage =
    progress.phase === 'download'
      ? `Downloading ${getDownloadPhaseLabel(progress.currentSource)} Images...`
      : undefined;
  const activityMessage = isConfirming
    ? undefined
    : progress.phase === 'download'
      ? undefined
    : isComplete && !showErrorTone && !isCancelled
      ? completionFollowUpMessage
      : progress.recentActivity;
  const canOpenIssueDetails =
    (showErrorTone || showWarningTone) && !!onOpenOperationResults;
  const totalPrivateImagesToDownload =
    confirmation?.sourceSummaries.reduce(
      (sum, source) => sum + (source.privateImagesToDownload ?? 0),
      0
    ) ?? 0;
  const description = isCancelled
    ? 'You cancelled this run. You can start a new download anytime.'
    : isComplete && !showErrorTone
      ? ''
    : isConfirming
      ? ''
      : downloadPhaseMessage
        ? downloadPhaseMessage
      : progress.currentStep || (isComplete ? 'Complete' : 'Ready');
  const titleText =
    isComplete && !showErrorTone && !isCancelled
      ? 'Download Completed'
      : 'Download Progress';
  const statusText = isCancelled
    ? 'Cancelled'
    : isConfirming
      ? 'Ready to download'
      : progress.isRunning
        ? showErrorTone
          ? 'Issues detected'
          : showWarningTone
            ? 'Retrying'
            : progress.phase === 'metadata'
              ? 'Collecting metadata'
              : 'Downloading'
        : showErrorTone
          ? 'Complete with failures'
          : isComplete
            ? 'Complete'
            : 'Idle';

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
            ) : isConfirming ? (
              <Download className="h-5 w-5 text-primary" />
            ) : progress.isRunning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            )}
            {titleText}
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
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto px-6 pb-6 pt-0">
        {(showErrorTone || showWarningTone) && !isCancelled && (
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
                  (onRetryDownload &&
                    canRetryDownload &&
                    !progress.isRunning)) && (
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

        {!isConfirming && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className={statusToneClass}>{statusText}</span>
          </div>
        )}

        {progress.phase === 'metadata' &&
          (progress.pageLabel || progress.currentSource) && (
            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              {progress.currentSource && (
                <div className="rounded border border-border/70 px-2 py-1">
                  Source: {progress.currentSource}
                </div>
              )}
              {progress.pageLabel && (
                <div className="rounded border border-border/70 px-2 py-1">
                  Step: {progress.pageLabel}
                </div>
              )}
              {progress.activeItemLabel && (
                <div className="rounded border border-border/70 px-2 py-1">
                  Item: {progress.activeItemLabel}
                </div>
              )}
            </div>
          )}

        {activityMessage && (
          <div className="rounded border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {activityMessage}
          </div>
        )}

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

        {!hasTotals && progress.isRunning && !isConfirming && (
          <Progress value={barValue} className={`h-2 ${progressToneClass}`} />
        )}

        {progress.isRunning && !isConfirming && onCancelDownload && (
          <div className="flex justify-end border-t border-border/60 pt-3">
            <Button variant="destructive" size="sm" onClick={() => void onCancelDownload()}>
              Cancel Download
            </Button>
          </div>
        )}

        {isConfirming && confirmation && (
          <div className="space-y-4 rounded-2xl bg-muted/20 p-4">
            {totalPrivateImagesToDownload === 0 && (
              <div className="rounded-2xl bg-yellow-50/40 px-4 py-3 text-sm text-yellow-800/80 ring-1 ring-yellow-200/60 dark:bg-yellow-950/20 dark:text-yellow-300/75 dark:ring-yellow-900/50">
                No private photos are included in this download.
              </div>
            )}

            <div className="space-y-3 rounded-2xl bg-background/80 px-5 py-5 shadow-sm ring-1 ring-border/50">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Download Summary
              </p>
              <div className="space-y-1">
                <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  {formatImageCount(confirmation.totalRemainingToDownload)}
                </h3>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  {formatCount(confirmation.totalImages)} total images found
                </p>
                <p>
                  {formatCount(confirmation.totalAlreadyOnDisk)} are already on
                  disk and will be skipped automatically
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {confirmation.sourceSummaries.map(source => (
                <div
                  key={source.source}
                  className="space-y-3 rounded-2xl bg-background/80 px-4 py-4 shadow-sm ring-1 ring-border/50"
                >
                  <div className="space-y-1">
                    <h4 className="text-base font-semibold">{source.label}</h4>
                    <p className="text-2xl font-semibold tracking-tight">
                      {formatImageCount(source.remainingToDownload)}
                    </p>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Total found: {formatCount(source.totalImages)}</p>
                    <p>
                      {formatCount(source.alreadyOnDisk)} already on disk and
                      will be skipped
                    </p>
                  </div>
                  {(source.source === 'user-feed' ||
                    source.source === 'user-photos') &&
                    (source.privateImagesToDownload ?? 0) > 0 && (
                      <p className="text-sm text-yellow-800 dark:text-yellow-300">
                        Includes{' '}
                        {formatCount(source.privateImagesToDownload ?? 0)}{' '}
                        private image
                        {(source.privateImagesToDownload ?? 0) === 1 ? '' : 's'}
                        .
                      </p>
                    )}
                </div>
              ))}
            </div>

            {(onConfirmDownload || onSkipDownload) && (
              <div className="space-y-3 pt-1">
                <p className="text-sm text-muted-foreground">
                  Files already on disk will be skipped automatically.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {onConfirmDownload && (
                    <Button
                      onClick={() => void onConfirmDownload()}
                      className="sm:flex-1"
                    >
                      Download{' '}
                      {formatCount(confirmation.totalRemainingToDownload)} image
                      {confirmation.totalRemainingToDownload === 1 ? '' : 's'}
                    </Button>
                  )}
                  {onSkipDownload && (
                    <Button
                      variant="outline"
                      onClick={onSkipDownload}
                      className="sm:flex-1"
                    >
                      Cancel Download
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
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
                {isRetrying ? 'Starting...' : 'Run download again'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
