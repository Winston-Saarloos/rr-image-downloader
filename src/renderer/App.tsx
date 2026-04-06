import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from './components/ui/button';
import { DownloadPanel } from './components/DownloadPanel';
import { PhotoViewer } from './components/PhotoViewer';
import { ProgressDisplay } from './components/ProgressDisplay';
import { StatsDialog } from './components/StatsDialog';
import { CustomTitleBar } from './components/CustomTitleBar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DEFAULT_CDN_BASE } from '../shared/cdnUrl';
import {
  RecNetSettings,
  Progress,
  BulkDataRefreshOptions,
  DownloadPreflightSummary,
  DownloadResult,
  UserFacingIncident,
} from '../shared/types';
import {
  DownloadSourceSelection,
  getSelectedDownloadSources,
} from '../shared/download-sources';
import { FavoritesProvider } from './contexts/FavoritesContext';
import {
  createUserIncident,
  classifyError,
  toOperationErrorData,
} from './utils/errorPresentation';
import { ErrorRecoveryBanner } from './components/ErrorRecoveryBanner';
import {
  buildDownloadProgressIncident,
  getDownloadProgressLogEntries,
} from './utils/downloadProgressFeedback';

interface DownloadRequestState {
  username: string;
  token: string;
  filePath: string;
  downloadSources: DownloadSourceSelection;
  refreshOptions: BulkDataRefreshOptions;
}

interface PendingDownloadPreflight {
  accountId: string;
  request: DownloadRequestState;
  summary: DownloadPreflightSummary;
}

const EMPTY_DOWNLOAD_STEP = 'Nothing to download';
const CLEAN_DOWNLOAD_FOLLOW_UP =
  'If you take more photos in Rec Room, come back and run this download again. The app will only grab anything new.';

function App() {
  const [settings, setSettings] = useState<RecNetSettings>({
    outputRoot: 'output',
    cdnBase: DEFAULT_CDN_BASE,
    interPageDelayMs: 0,
    maxConcurrentDownloads: 30,
  });

  const [progress, setProgress] = useState<Progress>({
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
  });

  const [currentAccountId, setCurrentAccountId] = useState<string>('');
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const [resultsScrollRequestId, setResultsScrollRequestId] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [headerMode, setHeaderMode] = useState<'full' | 'compact' | 'hidden'>(
    'full'
  );
  const [showProgressPanel, setShowProgressPanel] = useState(true);
  const [hasScrolledDown, setHasScrolledDown] = useState(false);
  const [hasScrolledPhotos, setHasScrolledPhotos] = useState(false);
  const scrollPositionRef = useRef(0);
  const photoScrollRef = useRef<HTMLDivElement | null>(null);
  const previousProgressRef = useRef<Progress | null>(null);
  const [logs, setLogs] = useState<
    Array<{
      message: string;
      type: 'info' | 'success' | 'error' | 'warning';
      timestamp: string;
    }>
  >([]);
  const [results, setResults] = useState<
    Array<{
      operation: string;
      data: unknown;
      type: 'success' | 'error';
      timestamp: string;
    }>
  >([]);
  const [downloadDraft, setDownloadDraft] =
    useState<DownloadRequestState | null>(null);
  const [pendingPreflight, setPendingPreflight] =
    useState<PendingDownloadPreflight | null>(null);
  const [lastDownloadRequest, setLastDownloadRequest] =
    useState<DownloadRequestState | null>(null);
  const [activeIncident, setActiveIncident] =
    useState<UserFacingIncident | null>(null);

  useEffect(() => {
    loadSettings();
    setupProgressMonitoring();
  }, []);

  useEffect(() => {
    if (progress.isRunning) {
      setShowProgressPanel(true);
    }
  }, [progress.isRunning]);

  useEffect(() => {
    if (currentAccountId) {
      loadPhotosForAccount(currentAccountId);
    }
  }, [currentAccountId, settings.outputRoot]);

  const loadSettings = async () => {
    try {
      if (window.electronAPI) {
        const loadedSettings = await window.electronAPI.getSettings();
        setSettings(loadedSettings);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Failed to load settings: ${msg}`, 'error');
      setActiveIncident(createUserIncident('settings', msg));
    }
  };

  const setupProgressMonitoring = () => {
    if (window.electronAPI) {
      window.electronAPI.onProgress((event, progressData) => {
        setProgress(progressData);
        if (
          progressData.statusLevel !== 'info' ||
          progressData.issueCount > 0
        ) {
          setShowProgressPanel(true);
        }
      });
    }
  };

  const loadPhotosForAccount = async (accountId: string) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.loadPhotos(accountId);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Failed to load photos for account ${accountId}: ${msg}`, 'error');
      setActiveIncident(createUserIncident('photos', msg));
    }
  };

  const updateSettings = async (newSettings: Partial<RecNetSettings>) => {
    try {
      if (window.electronAPI) {
        const updatedSettings =
          await window.electronAPI.updateSettings(newSettings);
        setSettings(updatedSettings);
        addLog('Settings updated', 'success');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog(`Failed to update settings: ${msg}`, 'error');
      setActiveIncident(createUserIncident('updateSettings', msg));
    }
  };

  const addLog = useCallback(
    (
      message: string,
      type: 'info' | 'success' | 'error' | 'warning' = 'info'
    ) => {
      const timestamp = new Date().toLocaleTimeString();
      setLogs(prev => [...prev.slice(-99), { message, type, timestamp }]);
    },
    []
  );

  const dismissIncident = useCallback(() => setActiveIncident(null), []);

  const clearPhotosIncident = useCallback(() => {
    setActiveIncident(prev => (prev?.source === 'photos' ? null : prev));
  }, []);

  const handleOpenPathInExplorer = useCallback(async (folderPath: string) => {
    if (!window.electronAPI?.openPathInExplorer) {
      return;
    }
    const r = await window.electronAPI.openPathInExplorer(folderPath);
    if (!r.success) {
      const timestamp = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-99),
        {
          message: r.error ?? 'Could not open folder',
          type: 'error' as const,
          timestamp,
        },
      ]);
    }
  }, []);

  const addResult = useCallback(
    (operation: string, data: unknown, type: 'success' | 'error') => {
      const timestamp = new Date().toLocaleString();
      setResults(prev => [
        { operation, data, type, timestamp },
        ...prev.slice(0, 9),
      ]);
    },
    []
  );

  const reportDownloadResult = useCallback(
    (params: {
      operation: string;
      label: string;
      result: DownloadResult;
      directoryPath?: string;
      directoryLabel?: string;
      manifestPath?: string;
    }) => {
      const {
        directoryLabel,
        directoryPath,
        label,
        manifestPath,
        operation,
        result,
      } = params;
      const stats = result.downloadStats;

      addLog(
        stats.failedDownloads > 0
          ? `${label} complete with warnings: ${stats.newDownloads} new, ${stats.alreadyDownloaded} existing, ${stats.failedDownloads} missed after retries`
          : `${label} complete: ${stats.newDownloads} new, ${stats.alreadyDownloaded} existing, ${stats.failedDownloads} failed`,
        stats.failedDownloads > 0 ? 'warning' : 'success'
      );

      if (stats.retryAttempts > 0) {
        addLog(
          stats.failedDownloads > 0
            ? `Retried ${label.toLowerCase()} ${stats.retryAttempts} time(s) across failed attempts. ${stats.recoveredAfterRetry} file(s) recovered automatically.`
            : `Retried ${label.toLowerCase()} ${stats.retryAttempts} time(s) and recovered ${stats.recoveredAfterRetry} file(s) automatically.`,
          stats.failedDownloads > 0 ? 'warning' : 'info'
        );
      }

      if (directoryPath && directoryLabel) {
        addLog(`${directoryLabel}: ${directoryPath}`, 'info');
      }
      if (manifestPath) {
        addLog(`Profile history manifest saved to: ${manifestPath}`, 'info');
      }

      result.guidance?.forEach(message => addLog(message, 'warning'));
      addResult(operation, result, 'success');
    },
    [addLog, addResult]
  );

  const setCleanCompletionProgress = useCallback(
    (currentStep: string, recentActivity = CLEAN_DOWNLOAD_FOLLOW_UP) => {
      setProgress(prev => ({
        ...prev,
        isRunning: false,
        phase: 'complete',
        currentStep,
        progress: 100,
        total: 0,
        current: 0,
        statusLevel: 'info',
        issueCount: 0,
        retryAttempts: 0,
        failedItems: 0,
        recoveredAfterRetry: 0,
        currentSource: undefined,
        pageLabel: undefined,
        activeItemLabel: undefined,
        recentActivity,
        lastIssue: undefined,
        confirmation: undefined,
      }));
    },
    []
  );

  const setConfirmationProgress = useCallback(
    (summary: DownloadPreflightSummary) => {
      setProgress(prev => ({
        ...prev,
        isRunning: false,
        phase: 'confirm',
        currentStep:
          'Metadata is ready. Review this download before continuing.',
        progress: 100,
        total: summary.totalRemainingToDownload,
        current: 0,
        statusLevel: 'info',
        issueCount: 0,
        retryAttempts: 0,
        failedItems: 0,
        recoveredAfterRetry: 0,
        currentSource: undefined,
        pageLabel: undefined,
        activeItemLabel: undefined,
        recentActivity: undefined,
        lastIssue: undefined,
        confirmation: summary,
      }));
    },
    []
  );

  const clearLogs = () => {
    setLogs([]);
    setResults([]);
    setActiveIncident(null);
  };

  const openOperationResults = useCallback(() => {
    setDebugMenuOpen(true);
    setResultsScrollRequestId(prev => prev + 1);
  }, []);

  const handleDownloadDraftChange = useCallback(
    (draft: DownloadRequestState) => {
      setDownloadDraft(draft);
    },
    []
  );

  const retryRequest = downloadDraft ?? lastDownloadRequest;
  const canRetryDownload = Boolean(
    retryRequest?.username.trim() && retryRequest?.filePath.trim()
  );

  const isProgressIdle =
    !progress.isRunning &&
    Math.min(Math.max(Math.round(progress.progress ?? 0), 0), 100) === 0 &&
    (!progress.currentStep || progress.currentStep === 'Ready');

  useEffect(() => {
    const previousProgress = previousProgressRef.current;

    if (previousProgress) {
      getDownloadProgressLogEntries(previousProgress, progress).forEach(
        entry => {
          addLog(entry.message, entry.type);
        }
      );

      const progressChanged =
        progress.issueCount !== previousProgress.issueCount ||
        progress.retryAttempts !== previousProgress.retryAttempts ||
        progress.failedItems !== previousProgress.failedItems ||
        progress.recoveredAfterRetry !== previousProgress.recoveredAfterRetry ||
        progress.lastIssue !== previousProgress.lastIssue ||
        progress.isRunning !== previousProgress.isRunning ||
        progress.currentStep !== previousProgress.currentStep;
      const hasRetryDrivenState =
        progress.retryAttempts > 0 ||
        progress.recoveredAfterRetry > 0 ||
        previousProgress.retryAttempts > 0 ||
        previousProgress.recoveredAfterRetry > 0;

      if (progressChanged && hasRetryDrivenState) {
        const incident = buildDownloadProgressIncident(progress);
        if (incident) {
          setActiveIncident(incident);
        } else {
          setActiveIncident(prev =>
            prev?.source === 'download' ? null : prev
          );
        }
      }
    }

    previousProgressRef.current = progress;
  }, [addLog, progress]);

  const handleDownload = async (
    username: string,
    token: string,
    filePath: string,
    downloadSources: DownloadSourceSelection,
    refreshOptions: BulkDataRefreshOptions = {}
  ) => {
    const selectedSources = getSelectedDownloadSources(downloadSources);
    if (!username.trim() || !filePath.trim() || selectedSources.length === 0) {
      return;
    }

    setActiveIncident(null);
    setPendingPreflight(null);

    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = refreshOptions;
    const requestState: DownloadRequestState = {
      username,
      token,
      filePath,
      downloadSources,
      refreshOptions: {
        forceAccountsRefresh,
        forceRoomsRefresh,
        forceEventsRefresh,
      },
    };

    setLastDownloadRequest(requestState);

    setIsDownloading(true);
    addLog(`Starting metadata collection for username: ${username}`, 'info');
    setProgress({
      isRunning: true,
      phase: 'metadata',
      currentStep: 'Starting metadata collection...',
      progress: 0,
      total: 0,
      current: 0,
      statusLevel: 'info',
      issueCount: 0,
      retryAttempts: 0,
      failedItems: 0,
      recoveredAfterRetry: 0,
      currentSource: undefined,
      pageLabel: undefined,
      activeItemLabel: undefined,
      recentActivity: 'Preparing download metadata...',
      confirmation: undefined,
    });

    try {
      // Update settings with new file path
      if (window.electronAPI) {
        await window.electronAPI.updateSettings({ outputRoot: filePath });
        setSettings(prev => ({ ...prev, outputRoot: filePath }));
        addLog(`Output path set to: ${filePath}`, 'info');

        // Search for account by username
        addLog(`Searching for account: ${username}`, 'info');
        const searchResult = await window.electronAPI.lookupAccountByUsername(
          username,
          token.trim() || undefined
        );
        if (!searchResult.success || !searchResult.data) {
          throw new Error('Account not found');
        }

        const account = searchResult.data;
        const accountId = account.accountId.toString();
        setCurrentAccountId(accountId);
        addLog(
          `Found account: ${account.displayName} (ID: ${accountId})`,
          'success'
        );
        if (
          downloadSources.downloadUserFeed ||
          downloadSources.downloadUserPhotos
        ) {
          addLog(
            forceAccountsRefresh
              ? 'Forcing refresh of user data for this download'
              : 'Using existing user data if present',
            'info'
          );
          addLog(
            forceRoomsRefresh
              ? 'Forcing refresh of room data for this download'
              : 'Using existing room data if present',
            'info'
          );
          addLog(
            forceEventsRefresh
              ? 'Forcing refresh of event data for this download'
              : 'Using existing event data if present',
            'info'
          );
        }

        for (const source of selectedSources) {
          if (source === 'user-feed') {
            addLog('Collecting feed photos metadata...', 'info');
            const collectFeedResult =
              await window.electronAPI.collectFeedPhotos({
                accountId,
                token: token.trim() || undefined,
                incremental: true,
                forceAccountsRefresh,
                forceRoomsRefresh,
                forceEventsRefresh,
              });

            if (!collectFeedResult.success) {
              throw new Error(
                collectFeedResult.error || 'Failed to collect feed photos'
              );
            }

            const totalFeedPhotos = collectFeedResult.data?.totalPhotos || 0;
            addLog(
              `Collected feed metadata for ${totalFeedPhotos} image(s).`,
              'success'
            );
            continue;
          }

          if (source === 'user-photos') {
            addLog('Collecting user photos metadata...', 'info');
            const collectPhotosResult = await window.electronAPI.collectPhotos({
              accountId,
              token: token.trim() || undefined,
              forceAccountsRefresh,
              forceRoomsRefresh,
              forceEventsRefresh,
            });

            if (!collectPhotosResult.success) {
              throw new Error(
                collectPhotosResult.error || 'Failed to collect photos'
              );
            }

            const totalPhotos = collectPhotosResult.data?.totalPhotos || 0;
            addLog(
              `Collected user photo metadata for ${totalPhotos} image(s).`,
              'success'
            );
            continue;
          }

          if (source === 'profile-history') {
            if (!token.trim()) {
              throw new Error(
                'Profile picture history requires a valid access token.'
              );
            }

            addLog('Collecting profile picture history metadata...', 'info');
            const collectProfileHistoryResult =
              await window.electronAPI.collectProfileHistoryManifest({
                accountId,
                token: token.trim(),
              });

            if (
              !collectProfileHistoryResult.success ||
              !collectProfileHistoryResult.data
            ) {
              throw new Error(
                collectProfileHistoryResult.error ||
                  'Failed to collect profile picture history metadata'
              );
            }

            addLog(
              `Collected profile picture history metadata for ${
                collectProfileHistoryResult.data.totalPhotos || 0
              } image(s).`,
              'success'
            );
          }
        }

        const preflightResult = await window.electronAPI.buildDownloadPreflight(
          {
            accountId,
            downloadSources,
          }
        );

        if (!preflightResult.success || !preflightResult.data) {
          throw new Error(
            preflightResult.error || 'Failed to prepare the download summary'
          );
        }

        const summary = preflightResult.data;
        setShowProgressPanel(true);
        setActiveIncident(null);

        if (summary.totalRemainingToDownload === 0) {
          addLog(
            'Metadata saved. Everything selected is already on disk.',
            'success'
          );
          setCleanCompletionProgress(
            'Metadata saved. No new images need downloading.'
          );
          return;
        }

        setPendingPreflight({
          accountId,
          request: requestState,
          summary,
        });
        setConfirmationProgress(summary);
        addLog(
          `Metadata saved. Review ${summary.totalRemainingToDownload} new image(s) before downloading.`,
          'info'
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Download failed';
      const classifiedError = classifyError(errorMessage, 'download');

      if (errorMessage === 'Operation cancelled') {
        addLog('Download cancelled by user.', 'warning');
        setProgress(prev => ({
          ...prev,
          isRunning: false,
          phase: 'cancelled',
          currentStep: 'Cancelled',
          total: 0,
          current: 0,
          statusLevel: 'info',
          issueCount: 0,
          failedItems: 0,
          confirmation: undefined,
          lastIssue: undefined,
        }));
        setActiveIncident(
          createUserIncident('download', errorMessage, { severity: 'warning' })
        );
      } else if (classifiedError.category === 'empty') {
        addLog(classifiedError.detail, 'warning');
        setShowProgressPanel(true);
        setProgress(prev => ({
          ...prev,
          isRunning: false,
          phase: 'complete',
          currentStep: EMPTY_DOWNLOAD_STEP,
          progress: 100,
          total: 0,
          current: 0,
          statusLevel: 'info',
          issueCount: 0,
          failedItems: 0,
          confirmation: undefined,
          lastIssue: classifiedError.detail,
        }));
        setActiveIncident(null);
      } else {
        addLog(`Download failed: ${errorMessage}`, 'error');
        classifiedError.guidance.forEach(message => addLog(message, 'warning'));
        setShowProgressPanel(true);
        setProgress(prev => ({
          ...prev,
          isRunning: false,
          phase: 'failed',
          currentStep: 'Failed',
          progress: 100,
          total: 0,
          current: 0,
          statusLevel: 'error',
          issueCount: Math.max(prev.issueCount, 1),
          failedItems: Math.max(prev.failedItems, 1),
          confirmation: undefined,
          lastIssue: errorMessage,
        }));
        setActiveIncident(createUserIncident('download', errorMessage));
        addResult(
          'Download',
          toOperationErrorData(errorMessage, 'download'),
          'error'
        );
      }
    } finally {
      setIsDownloading(false);
    }
  };

  const handleConfirmDownload = useCallback(async () => {
    if (!pendingPreflight || !window.electronAPI) {
      return;
    }

    const { accountId, request, summary } = pendingPreflight;
    const selectedSources = getSelectedDownloadSources(request.downloadSources);
    let failedDownloads = 0;
    let ranPhotoDownloads = false;

    setPendingPreflight(null);
    setActiveIncident(null);
    setIsDownloading(true);
    setShowProgressPanel(true);
    addLog('Image download confirmed. Starting file downloads...', 'info');

    try {
      for (const source of selectedSources) {
        const sourceSummary = summary.sourceSummaries.find(
          item => item.source === source
        );
        if (!sourceSummary || sourceSummary.totalImages === 0) {
          continue;
        }

        if (source === 'user-feed') {
          addLog('Downloading feed photos...', 'info');
          const downloadFeedResult =
            await window.electronAPI.downloadFeedPhotos({
              accountId,
              token: request.token.trim() || undefined,
            });

          if (!downloadFeedResult.success || !downloadFeedResult.data) {
            throw new Error(
              downloadFeedResult.error || 'Failed to download feed photos'
            );
          }

          ranPhotoDownloads = true;
          failedDownloads +=
            downloadFeedResult.data.downloadStats.failedDownloads;
          reportDownloadResult({
            operation: 'User Feed Download',
            label: 'Feed download',
            result: downloadFeedResult.data,
            directoryPath: downloadFeedResult.data.feedPhotosDirectory,
            directoryLabel: 'Feed photos saved to',
          });
          continue;
        }

        if (source === 'user-photos') {
          addLog('Downloading user photos...', 'info');
          const downloadPhotosResult = await window.electronAPI.downloadPhotos({
            accountId,
            token: request.token.trim() || undefined,
          });

          if (!downloadPhotosResult.success || !downloadPhotosResult.data) {
            throw new Error(
              downloadPhotosResult.error || 'Failed to download photos'
            );
          }

          ranPhotoDownloads = true;
          failedDownloads +=
            downloadPhotosResult.data.downloadStats.failedDownloads;
          reportDownloadResult({
            operation: 'User Photos Download',
            label: 'User photos download',
            result: downloadPhotosResult.data,
            directoryPath: downloadPhotosResult.data.photosDirectory,
            directoryLabel: 'User photos saved to',
          });
          continue;
        }

        if (source === 'profile-history') {
          addLog('Downloading profile picture history...', 'info');
          const downloadProfileHistoryResult =
            await window.electronAPI.downloadProfileHistory({
              accountId,
              token: request.token.trim(),
            });

          if (
            !downloadProfileHistoryResult.success ||
            !downloadProfileHistoryResult.data
          ) {
            throw new Error(
              downloadProfileHistoryResult.error ||
                'Failed to download profile picture history'
            );
          }

          ranPhotoDownloads = true;
          failedDownloads +=
            downloadProfileHistoryResult.data.downloadStats.failedDownloads;
          reportDownloadResult({
            operation: 'Profile Picture History Download',
            label: 'Profile picture history download',
            result: downloadProfileHistoryResult.data,
            directoryPath:
              downloadProfileHistoryResult.data.profileHistoryDirectory,
            directoryLabel: 'Profile picture history saved to',
            manifestPath:
              downloadProfileHistoryResult.data.profileHistoryManifestPath,
          });
        }
      }

      if (
        request.downloadSources.downloadUserFeed ||
        request.downloadSources.downloadUserPhotos
      ) {
        loadPhotosForAccount(accountId);
      }

      if (!ranPhotoDownloads) {
        setCleanCompletionProgress(
          'Metadata saved. No new images needed downloading.'
        );
      } else if (failedDownloads === 0) {
        setActiveIncident(null);
        setCleanCompletionProgress('Completed download');
        addLog(
          'Download complete. Run this again later to pick up anything new from Rec Room.',
          'success'
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Download failed';
      addLog(`Download failed: ${errorMessage}`, 'error');
      setProgress(prev => ({
        ...prev,
        isRunning: false,
        phase: 'failed',
        currentStep: 'Failed',
        progress: 100,
        total: 0,
        current: 0,
        statusLevel: 'error',
        issueCount: Math.max(prev.issueCount, 1),
        failedItems: Math.max(prev.failedItems, 1),
        confirmation: undefined,
        lastIssue: errorMessage,
      }));
      setActiveIncident(createUserIncident('download', errorMessage));
      addResult(
        'Download',
        toOperationErrorData(errorMessage, 'download'),
        'error'
      );
    } finally {
      setIsDownloading(false);
    }
  }, [
    addLog,
    addResult,
    loadPhotosForAccount,
    pendingPreflight,
    reportDownloadResult,
    setCleanCompletionProgress,
  ]);

  const handleSkipDownload = useCallback(() => {
    if (!pendingPreflight) {
      return;
    }

    addLog('Metadata saved. Image download skipped.', 'info');
    setPendingPreflight(null);
    setActiveIncident(null);
    setCleanCompletionProgress(
      'Metadata saved. Image download was skipped for now.'
    );
  }, [addLog, pendingPreflight, setCleanCompletionProgress]);

  const handleRetryDownload = useCallback(async () => {
    if (!retryRequest || isDownloading) {
      return;
    }

    await handleDownload(
      retryRequest.username,
      retryRequest.token,
      retryRequest.filePath,
      retryRequest.downloadSources,
      retryRequest.refreshOptions
    );
  }, [handleDownload, isDownloading, retryRequest]);

  const handleViewerAccountChange = useCallback(
    (accountId?: string) => {
      // Only update if not downloading (to avoid conflicts)
      if (!isDownloading) {
        setCurrentAccountId(accountId || '');
      }
    },
    [isDownloading]
  );

  const handleOpenActivityMenu = useCallback(() => {
    setDebugMenuOpen(true);
  }, []);

  const handleRevealOutputFolder = useCallback(() => {
    void handleOpenPathInExplorer(settings.outputRoot);
  }, [handleOpenPathInExplorer, settings.outputRoot]);

  const handlePhotosLoadError = useCallback((message: string) => {
    setActiveIncident(createUserIncident('photos', message));
  }, []);

  const handleCancelDownload = async () => {
    try {
      if (window.electronAPI) {
        const cancelled = await window.electronAPI.cancelOperation();
        if (cancelled) {
          addLog('Download cancelled', 'warning');
          setProgress(prev => ({
            ...prev,
            isRunning: false,
            phase: 'cancelled',
            currentStep: 'Cancelled',
            progress: 0,
            total: 0,
            current: 0,
          }));
        }
      }
    } catch (error) {
      addLog(`Failed to cancel download: ${error}`, 'error');
    }
  };

  const handlePhotoScroll = useCallback(
    (scrollTop: number) => {
      const last = scrollPositionRef.current;
      const delta = scrollTop - last;
      const isScrollingDown = delta > 6;
      const isScrollingUp = delta < -6;

      if (scrollTop < 24) {
        setHeaderMode('full');
        setHasScrolledPhotos(false);
        setHasScrolledDown(false);
        scrollPositionRef.current = scrollTop;
        return;
      }

      setHasScrolledPhotos(true);
      setHasScrolledDown(true);

      if (isScrollingDown && scrollTop > 48) {
        setHeaderMode('hidden');
      } else if (isScrollingUp && hasScrolledDown) {
        setHeaderMode('compact');
      }

      scrollPositionRef.current = scrollTop;
    },
    [hasScrolledDown]
  );

  const scrollPhotosToTop = useCallback(() => {
    if (photoScrollRef.current) {
      photoScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  return (
    <FavoritesProvider>
      <div className="min-h-screen bg-background">
        {/* Custom Title Bar */}
        <CustomTitleBar
          onDownloadClick={() => setDownloadPanelOpen(true)}
          onStatsClick={() => setStatsDialogOpen(true)}
          settings={settings}
          onUpdateSettings={updateSettings}
          logs={logs}
          results={results}
          onClearLogs={clearLogs}
          currentAccountId={currentAccountId}
          debugMenuOpen={debugMenuOpen}
          onDebugMenuOpenChange={setDebugMenuOpen}
          resultsScrollRequestId={resultsScrollRequestId}
          onRetryDownload={handleRetryDownload}
          canRetryDownload={canRetryDownload}
          isRetryingDownload={isDownloading}
          onOpenDownloadPanel={() => setDownloadPanelOpen(true)}
          onOpenOutputFolder={handleOpenPathInExplorer}
          outputRoot={settings.outputRoot}
        />

        <div className="container mx-auto px-4 py-4 max-w-7xl h-screen flex flex-col overflow-hidden pt-14">
          <ErrorRecoveryBanner
            incident={activeIncident}
            outputRoot={settings.outputRoot}
            onDismiss={dismissIncident}
            onRetryDownload={handleRetryDownload}
            canRetryDownload={canRetryDownload}
            isRetrying={isDownloading}
            onOpenDownloadPanel={() => setDownloadPanelOpen(true)}
            onOpenOperationResults={openOperationResults}
            onOpenPathInExplorer={handleOpenPathInExplorer}
          />
          {/* Header space removed - using custom title bar instead */}

          {/* Download Panel Modal */}
          <ErrorBoundary sectionName="Download panel">
            <DownloadPanel
              open={downloadPanelOpen}
              onOpenChange={setDownloadPanelOpen}
              onDownload={handleDownload}
              onDraftChange={handleDownloadDraftChange}
              onCancel={handleCancelDownload}
              isDownloading={isDownloading || !!pendingPreflight}
              showCancel={isDownloading}
              settings={settings}
            />
          </ErrorBoundary>

          {/* Stats Dialog */}
          <ErrorBoundary sectionName="Stats">
            <StatsDialog
              open={statsDialogOpen}
              onOpenChange={setStatsDialogOpen}
              accountId={currentAccountId}
              filePath={settings.outputRoot}
            />
          </ErrorBoundary>

          {/* Progress Display */}
          {!isProgressIdle && showProgressPanel && (
            <div className="mb-4">
              <ProgressDisplay
                progress={progress}
                onClose={() => setShowProgressPanel(false)}
                onOpenOperationResults={openOperationResults}
                onOpenDownloadPanel={() => setDownloadPanelOpen(true)}
                onCancelDownload={handleCancelDownload}
                onConfirmDownload={handleConfirmDownload}
                onSkipDownload={handleSkipDownload}
                onRetryDownload={handleRetryDownload}
                canRetryDownload={canRetryDownload}
                isRetrying={isDownloading}
              />
            </div>
          )}

          {/* Photo Viewer */}
          <div className="flex-1 min-h-0 relative">
            {hasScrolledDown && headerMode === 'hidden' && (
              <div
                className="absolute left-0 right-0 top-0 z-30 h-3"
                onMouseEnter={() => setHeaderMode('compact')}
              />
            )}
            <ErrorBoundary sectionName="Photo viewer">
              <PhotoViewer
                filePath={settings.outputRoot}
                accountId={isDownloading ? currentAccountId : undefined}
                isDownloading={isDownloading}
                onAccountChange={handleViewerAccountChange}
                onScrollPositionChange={handlePhotoScroll}
                scrollContainerRef={photoScrollRef}
                headerMode={headerMode}
                onOpenActivityMenu={handleOpenActivityMenu}
                onRevealOutputFolder={handleRevealOutputFolder}
                onPhotosLoadError={handlePhotosLoadError}
                onPhotosLoadSuccess={clearPhotosIncident}
                cdnBase={settings.cdnBase}
              />
            </ErrorBoundary>
          </div>

          {/* Scroll To Top */}
          {hasScrolledPhotos && (
            <Button
              variant="secondary"
              size="icon"
              className="fixed bottom-16 right-4 shadow-lg"
              onClick={scrollPhotosToTop}
              aria-label="Scroll to top"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </FavoritesProvider>
  );
}

export default App;
