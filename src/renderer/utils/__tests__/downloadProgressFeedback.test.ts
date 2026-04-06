import type { Progress } from '../../../shared/types';
import {
  buildDownloadProgressIncident,
  getDownloadProgressLogEntries,
} from '../downloadProgressFeedback';

function createProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    isRunning: false,
    phase: 'complete',
    currentStep: 'Ready',
    progress: 0,
    total: 0,
    current: 0,
    statusLevel: 'info',
    issueCount: 0,
    retryAttempts: 0,
    failedItems: 0,
    recoveredAfterRetry: 0,
    lastIssue: undefined,
    ...overrides,
  };
}

describe('downloadProgressFeedback', () => {
  it('creates a warning incident for a running download issue', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: true,
        phase: 'download',
        currentStep: 'Downloading user photos...',
        issueCount: 1,
        retryAttempts: 1,
        lastIssue:
          'Issue downloading image1.jpg: timeout of 15000ms exceeded. Retry 1/3 will start now.',
      })
    );

    expect(incident).not.toBeNull();
    expect(incident?.severity).toBe('warning');
    expect(incident?.title).toBe('Download issues detected');
    expect(incident?.guidance).toContain('The app is retrying the affected file now.');
  });

  it('creates a recovery incident that says the download is continuing', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: true,
        phase: 'download',
        currentStep: 'Downloading user photos...',
        issueCount: 1,
        retryAttempts: 1,
        recoveredAfterRetry: 1,
        lastIssue: 'Recovered image1.jpg after 1 retry. Download is continuing.',
      })
    );

    expect(incident).not.toBeNull();
    expect(incident?.title).toBe('Download recovered and is continuing');
    expect(incident?.detail).toContain('Recovered image1.jpg after 1 retry.');
  });

  it('creates an error incident with retry guidance after retries are exhausted', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: false,
        phase: 'complete',
        currentStep: 'Complete',
        issueCount: 4,
        retryAttempts: 3,
        failedItems: 1,
        lastIssue:
          'Download failed for image1.jpg: timeout of 15000ms exceeded.',
      })
    );

    expect(incident).not.toBeNull();
    expect(incident?.severity).toBe('error');
    expect(incident?.title).toBe('Some images could not be downloaded');
    expect(incident?.guidance).toContain(
      'Run the same download again to grab any missed images.'
    );
  });

  it('does not misclassify cancellation as a network issue', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: false,
        phase: 'cancelled',
        currentStep: 'Cancelled',
      })
    );

    expect(incident).not.toBeNull();
    expect(incident?.category).toBe('cancelled');
    expect(incident?.title).toBe('Download cancelled');
  });

  it('emits log entries for issue and recovery transitions', () => {
    const previous = createProgress({
      isRunning: true,
      phase: 'download',
      currentStep: 'Downloading user photos...',
    });
    const warningProgress = createProgress({
      isRunning: true,
      phase: 'download',
      currentStep: 'Downloading user photos...',
      issueCount: 1,
      retryAttempts: 1,
      lastIssue: 'Issue downloading image1.jpg: Temporary outage. Retry 1/3 will start now.',
    });
    const recoveredProgress = createProgress({
      isRunning: true,
      phase: 'download',
      currentStep: 'Downloading user photos...',
      issueCount: 1,
      retryAttempts: 1,
      recoveredAfterRetry: 1,
      lastIssue: 'Recovered image1.jpg after 1 retry. Download is continuing.',
    });

    expect(getDownloadProgressLogEntries(previous, warningProgress)).toEqual([
      {
        message:
          'Issue downloading image1.jpg: Temporary outage. Retry 1/3 will start now.',
        type: 'warning',
      },
    ]);
    expect(
      getDownloadProgressLogEntries(warningProgress, recoveredProgress)
    ).toEqual([
      {
        message: 'Recovered image1.jpg after 1 retry. Download is continuing.',
        type: 'success',
      },
    ]);
  });

  it('does not create a lingering incident after a clean recovered completion', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: false,
        phase: 'complete',
        currentStep: 'Complete',
        issueCount: 1,
        retryAttempts: 1,
        recoveredAfterRetry: 1,
        failedItems: 0,
        lastIssue: 'Recovered image1.jpg after 1 retry. Download is continuing.',
      })
    );

    expect(incident).toBeNull();
  });

  it('does not create an incident while waiting on confirmation', () => {
    const incident = buildDownloadProgressIncident(
      createProgress({
        isRunning: false,
        phase: 'confirm',
        currentStep: 'Metadata is ready.',
      })
    );

    expect(incident).toBeNull();
  });
});
