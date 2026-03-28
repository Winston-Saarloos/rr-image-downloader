import type { Progress, UserFacingIncident } from '../../shared/types';

export interface DownloadProgressLogEntry {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

function createIncident(
  title: string,
  detail: string,
  guidance: string[],
  options?: {
    severity?: 'error' | 'warning';
    category?: UserFacingIncident['category'];
  }
): UserFacingIncident {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    source: 'download',
    severity: options?.severity ?? 'warning',
    category: options?.category ?? 'network',
    title,
    detail,
    guidance,
    technicalDetail: detail,
  };
}

function trimMessage(message?: string): string {
  return (message || '').trim();
}

export function buildDownloadProgressIncident(
  progress: Progress
): UserFacingIncident | null {
  const detail = trimMessage(progress.lastIssue);

  if (progress.currentStep === 'Cancelled') {
    return createIncident(
      'Download cancelled',
      'You stopped the download.',
      [
        'Run Download again anytime; files already saved are kept and skipped automatically.',
      ],
      { severity: 'warning', category: 'cancelled' }
    );
  }

  if (
    progress.issueCount === 0 &&
    progress.recoveredAfterRetry === 0 &&
    progress.failedItems === 0
  ) {
    return null;
  }

  if (!progress.isRunning && progress.failedItems > 0) {
    return createIncident(
      'Some images could not be downloaded',
      detail || 'The download gave up on one or more files after retrying.',
      [
        'Run the same download again to grab any missed images.',
        'Anything already saved on disk is kept and skipped automatically.',
        'You do not need to delete the output folder to resume.',
      ],
      { severity: 'error' }
    );
  }

  if (detail.toLowerCase().startsWith('recovered ')) {
    return createIncident(
      progress.isRunning
        ? 'Download recovered and is continuing'
        : 'Download recovered after retrying',
      detail,
      progress.isRunning
        ? [
            'The app recovered automatically and the download is still running.',
            'You can keep this run going or cancel it at any time.',
          ]
        : [
            'The app recovered automatically and finished the download.',
            'Anything already saved on disk stays in place.',
          ]
    );
  }

  if (progress.isRunning) {
    return createIncident(
      'Download issues detected',
      detail || 'The app hit a connection problem and is retrying now.',
      [
        'The app is retrying the affected file now.',
        'The download is still running and you can cancel it if needed.',
        'If retries run out, run the same download again; existing files will be skipped.',
      ]
    );
  }

  if (!progress.isRunning && progress.issueCount > 0) {
    return createIncident(
      'Download finished after retrying',
      detail || 'The app hit issues during the download but recovered.',
      [
        'The app recovered from the issue and completed the run.',
        'Anything already saved on disk stays in place.',
      ]
    );
  }

  return null;
}

export function getDownloadProgressLogEntries(
  previous: Progress,
  next: Progress
): DownloadProgressLogEntry[] {
  const entries: DownloadProgressLogEntry[] = [];
  const nextIssue = trimMessage(next.lastIssue);

  if (
    next.issueCount > previous.issueCount &&
    nextIssue &&
    nextIssue !== trimMessage(previous.lastIssue)
  ) {
    entries.push({
      message: nextIssue,
      type: next.failedItems > previous.failedItems ? 'error' : 'warning',
    });
  }

  if (
    next.recoveredAfterRetry > previous.recoveredAfterRetry &&
    nextIssue &&
    nextIssue !== trimMessage(previous.lastIssue)
  ) {
    entries.push({
      message: nextIssue,
      type: 'success',
    });
  }

  return entries;
}
