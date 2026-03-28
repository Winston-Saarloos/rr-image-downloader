import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Copy, Check, X } from 'lucide-react';
import { Button } from './ui/button';
import type { UserFacingIncident } from '../../shared/types';

export interface ErrorRecoveryBannerProps {
  incident: UserFacingIncident | null;
  outputRoot: string;
  onDismiss: () => void;
  onRetryDownload?: () => void | Promise<void>;
  canRetryDownload?: boolean;
  isRetrying?: boolean;
  onOpenDownloadPanel?: () => void;
  onOpenOperationResults?: () => void;
  onOpenPathInExplorer?: (folderPath: string) => void | Promise<void>;
}

export const ErrorRecoveryBanner: React.FC<ErrorRecoveryBannerProps> = ({
  incident,
  outputRoot,
  onDismiss,
  onRetryDownload,
  canRetryDownload = false,
  isRetrying = false,
  onOpenDownloadPanel,
  onOpenOperationResults,
  onOpenPathInExplorer,
}) => {
  const [copied, setCopied] = useState(false);

  if (!incident) {
    return null;
  }

  const isError = incident.severity === 'error';
  const Icon = isError ? AlertCircle : AlertTriangle;
  const borderTone = isError
    ? 'border-destructive/40 bg-destructive/10'
    : 'border-amber-500/40 bg-amber-500/10';

  const showRetryDownload =
    incident.source === 'download' &&
    canRetryDownload &&
    onRetryDownload &&
    incident.category !== 'cancelled';

  const showRetryAfterCancel =
    incident.source === 'download' &&
    incident.category === 'cancelled' &&
    canRetryDownload &&
    onRetryDownload;

  const showOpenFolder =
    Boolean(outputRoot?.trim()) &&
    onOpenPathInExplorer &&
    (incident.source === 'download' ||
      incident.source === 'photos' ||
      incident.source === 'settings' ||
      incident.source === 'updateSettings' ||
      incident.category === 'disk');

  const handleCopy = async () => {
    const text = [
      incident.title,
      incident.detail,
      incident.technicalDetail && `Technical: ${incident.technicalDetail}`,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={`px-3 py-2.5 ${borderTone} mb-4 rounded-lg`}
      role="alert"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          <Icon
            className={`mt-0.5 h-5 w-5 flex-shrink-0 ${isError ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}
          />
          <div className="min-w-0 space-y-1">
            <p
              className={`text-sm font-semibold ${isError ? 'text-destructive' : 'text-amber-900 dark:text-amber-100'}`}
            >
              {incident.title}
            </p>
            <p className="text-sm text-muted-foreground break-words">
              {incident.detail}
            </p>
            {incident.guidance.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground pt-1 space-y-0.5">
                {incident.guidance.slice(0, 4).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {showRetryDownload && (
              <Button
                size="sm"
                variant={isError ? 'default' : 'secondary'}
                disabled={isRetrying}
                onClick={() => void onRetryDownload()}
              >
                {isRetrying ? 'Retrying…' : 'Retry download'}
              </Button>
            )}
            {showRetryAfterCancel && (
              <Button
                size="sm"
                variant="secondary"
                disabled={isRetrying}
                onClick={() => void onRetryDownload()}
              >
                {isRetrying ? 'Starting…' : 'Run download again'}
              </Button>
            )}
            {onOpenDownloadPanel && (
              <Button size="sm" variant="outline" onClick={onOpenDownloadPanel}>
                Open download
              </Button>
            )}
            {showOpenFolder && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onOpenPathInExplorer(outputRoot)}
              >
                Open output folder
              </Button>
            )}
            {onOpenOperationResults && (
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenOperationResults}
              >
                View details
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={handleCopy}
              type="button"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1"
              onClick={onDismiss}
              aria-label="Dismiss"
              type="button"
            >
              <X className="h-4 w-4" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
