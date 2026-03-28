import React, { useEffect, useRef, useState } from 'react';
import { Progress } from '../components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { DownloadStats, Progress as ProgressType } from '../../shared/types';
import {
  Loader2,
  CheckCircle2,
  X,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../components/ui/button';

const formatElapsedDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

interface ProgressDisplayProps {
  progress: ProgressType;
  startedAt?: number | null;
  durationMs?: number | null;
  onClose?: () => void;
  onCancel?: () => void | Promise<void>;
  onOpenOperationResults?: () => void;
  onOpenDownloadPanel?: () => void;
  onRetryDownload?: () => void | Promise<void>;
  canRetryDownload?: boolean;
  isRetrying?: boolean;
  summary?: {
    username: string;
    accountId: string;
    userPhotos?: DownloadStats;
    feedPhotos?: DownloadStats;
  } | null;
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progress,
  startedAt = null,
  durationMs = null,
  onClose,
  onCancel,
  onOpenOperationResults,
  onOpenDownloadPanel,
  onRetryDownload,
  canRetryDownload = false,
  isRetrying = false,
  summary = null,
}) => {
  const phase = progress.progressPhase ?? 'metadata';
  const fileTargetPercent = Math.min(
    Math.max(progress.progress ?? 0, 0),
    100
  );
  const percent = Math.round(fileTargetPercent);
  const showLinearBar = phase === 'files' && progress.total > 0;
  const isMetadataRunning = progress.isRunning && phase === 'metadata';
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
  const smoothRef = useRef(fileTargetPercent);
  const [smoothPercent, setSmoothPercent] = useState(fileTargetPercent);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [elapsedMs, setElapsedMs] = useState<number>(() =>
    startedAt ? Math.max(Date.now() - startedAt, 0) : (durationMs ?? 0)
  );

  useEffect(() => {
    if (!showLinearBar) {
      smoothRef.current = fileTargetPercent;
      setSmoothPercent(fileTargetPercent);
      return;
    }

    let frame = 0;
    const tick = () => {
      const target = Math.min(
        100,
        Math.max(0, progressRef.current.progress ?? 0)
      );
      const prev = smoothRef.current;
      const next =
        Math.abs(target - prev) < 0.25 ? target : prev + (target - prev) * 0.22;
      smoothRef.current = next;
      setSmoothPercent(next);
      if (Math.abs(target - next) > 0.15) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    showLinearBar,
    fileTargetPercent,
    progress.progress,
    progress.current,
    progress.total,
  ]);

  useEffect(() => {
    if (progress.isRunning && startedAt) {
      setElapsedMs(Math.max(Date.now() - startedAt, 0));

      const interval = setInterval(() => {
        setElapsedMs(Math.max(Date.now() - startedAt, 0));
      }, 1000);

      return () => clearInterval(interval);
    }

    setElapsedMs(
      durationMs ?? (startedAt ? Math.max(Date.now() - startedAt, 0) : 0)
    );
    return undefined;
  }, [durationMs, progress.isRunning, startedAt]);

  const isIdle =
    !progress.isRunning &&
    percent === 0 &&
    (!progress.currentStep || progress.currentStep === 'Ready');
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
  const hasElapsed = startedAt !== null || durationMs !== null;
  const elapsedLabel = hasElapsed ? formatElapsedDuration(elapsedMs) : null;
  const totalNewDownloads =
    (summary?.userPhotos?.newDownloads ?? 0) +
    (summary?.feedPhotos?.newDownloads ?? 0);
  const hasSummary =
    !progress.isRunning &&
    !!summary &&
    (summary.userPhotos !== undefined || summary.feedPhotos !== undefined);

  const renderDownloadSummary = (
    label: string,
    stats: DownloadStats | undefined
  ) => {
    if (!stats) {
      return null;
    }

    return (
      <div className="rounded-md border bg-background/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {stats.totalPhotos} total checked
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {stats.newDownloads} downloaded
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.alreadyDownloaded} skipped existing
            </p>
          </div>
        </div>
        {stats.failedDownloads > 0 && (
          <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
            {stats.failedDownloads} failed after retries
          </p>
        )}
      </div>
    );
  };

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
              : isMetadataRunning
                ? 'Gathering metadata and related data'
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
                  {canOpenIssueDetails && onOpenOperationResults && (
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

        {elapsedLabel && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              Elapsed Time: {elapsedLabel}
            </span>
          </div>
        )}

        {hasSummary && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Last Download Summary
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              @{summary.username} ({summary.accountId})
            </p>
            {totalNewDownloads === 0 && (
              <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                No new photos were downloaded. Existing saved photos were
                skipped.
              </p>
            )}
            <div className="mt-3 space-y-2">
              {renderDownloadSummary('User photos', summary.userPhotos)}
              {renderDownloadSummary('Feed photos', summary.feedPhotos)}
            </div>
          </div>
        )}

        {isMetadataRunning && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {progress.currentStep || 'Working…'}
            </p>
          </div>
        )}

        {showLinearBar && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="text-muted-foreground">
                {progress.current} / {progress.total} ({percent}%)
              </span>
            </div>
            <Progress
              value={smoothPercent}
              className={`h-2 ${progressToneClass}`}
            />
            {progress.currentStep ? (
              <div className="text-sm text-muted-foreground">
                {progress.currentStep}
              </div>
            ) : null}
          </>
        )}

        {progress.isRunning && onCancel && (
          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
            <Button variant="destructive" size="sm" onClick={() => void onCancel()}>
              Cancel download
            </Button>
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
                {isRetrying ? 'Starting…' : 'Run download again'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
