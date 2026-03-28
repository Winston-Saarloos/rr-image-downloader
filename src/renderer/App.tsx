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
  UserFacingIncident,
} from '../shared/types';
import { FavoritesProvider } from './contexts/FavoritesContext';
import {
  createUserIncident,
  classifyError,
  toOperationErrorData,
} from './utils/errorPresentation';
import { ErrorRecoveryBanner } from './components/ErrorRecoveryBanner';

interface DownloadRequestState {
  username: string;
  token: string;
  filePath: string;
  refreshOptions: BulkDataRefreshOptions;
}

function App() {
  const [settings, setSettings] = useState<RecNetSettings>({
    outputRoot: 'output',
    cdnBase: DEFAULT_CDN_BASE,
    interPageDelayMs: 500,
  });

  const [progress, setProgress] = useState<Progress>({
    isRunning: false,
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
  const [downloadDraft, setDownloadDraft] = useState<DownloadRequestState | null>(
    null
  );
  const [lastDownloadRequest, setLastDownloadRequest] =
    useState<DownloadRequestState | null>(null);
  const [activeIncident, setActiveIncident] = useState<UserFacingIncident | null>(
    null
  );

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
      const msg =
        error instanceof Error ? error.message : 'Unknown error';
      addLog(`Failed to load settings: ${msg}`, 'error');
      setActiveIncident(createUserIncident('settings', msg));
    }
  };

  const setupProgressMonitoring = () => {
    if (window.electronAPI) {
      window.electronAPI.onProgress((event, progressData) => {
        setProgress(progressData);
        if (progressData.statusLevel !== 'info' || progressData.issueCount > 0) {
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
      const msg =
        error instanceof Error ? error.message : 'Unknown error';
      addLog(
        `Failed to load photos for account ${accountId}: ${msg}`,
        'error'
      );
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

  const addLog = (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning' = 'info'
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-99), { message, type, timestamp }]);
  };

  const dismissIncident = useCallback(() => setActiveIncident(null), []);

  const clearPhotosIncident = useCallback(() => {
    setActiveIncident(prev => (prev?.source === 'photos' ? null : prev));
  }, []);

  const handleOpenPathInExplorer = useCallback(
    async (folderPath: string) => {
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
    },
    []
  );

  const addResult = (
    operation: string,
    data: unknown,
    type: 'success' | 'error'
  ) => {
    const timestamp = new Date().toLocaleString();
    setResults(prev => [
      { operation, data, type, timestamp },
      ...prev.slice(0, 9),
    ]);
  };

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

  const handleDownload = async (
    username: string,
    token: string,
    filePath: string,
    refreshOptions: BulkDataRefreshOptions = {}
  ) => {
    if (!username.trim() || !filePath.trim()) {
      return;
    }

    setActiveIncident(null);

    const {
      forceAccountsRefresh = false,
      forceRoomsRefresh = false,
      forceEventsRefresh = false,
    } = refreshOptions;
    const requestState: DownloadRequestState = {
      username,
      token,
      filePath,
      refreshOptions: {
        forceAccountsRefresh,
        forceRoomsRefresh,
        forceEventsRefresh,
      },
    };

    setLastDownloadRequest(requestState);

    setIsDownloading(true);
    addLog(`Starting download for username: ${username}`, 'info');
    setProgress({
      isRunning: true,
      currentStep: 'Starting download...',
      progress: 0,
      total: 0,
      current: 0,
      statusLevel: 'info',
      issueCount: 0,
      retryAttempts: 0,
      failedItems: 0,
      recoveredAfterRetry: 0,
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
        if (
          !searchResult.success ||
          !searchResult.data
        ) {
          throw new Error('Account not found');
        }

        const account = searchResult.data;
        const accountId = account.accountId.toString();
        setCurrentAccountId(accountId);
        addLog(
          `Found account: ${account.displayName} (ID: ${accountId})`,
          'success'
        );
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

        // Step 1: Collect photos & feed metadata
        addLog('Step 1: Collecting photos metadata...', 'info');
        const collectPhotosResult = await window.electronAPI.collectPhotos({
          accountId,
          token: token.trim() || undefined,
          forceAccountsRefresh,
          forceRoomsRefresh,
          forceEventsRefresh,
        });

        addLog('Step 1b: Collecting feed photos metadata...', 'info');
        const collectFeedResult = await window.electronAPI.collectFeedPhotos({
          accountId,
          token: token.trim() || undefined,
          incremental: true,
          forceAccountsRefresh,
          forceRoomsRefresh,
          forceEventsRefresh,
        });

        if (!collectPhotosResult.success) {
          throw new Error(
            collectPhotosResult.error || 'Failed to collect photos'
          );
        }
        if (!collectFeedResult.success) {
          throw new Error(
            collectFeedResult.error || 'Failed to collect feed photos'
          );
        }

        const totalPhotos = collectPhotosResult.data?.totalPhotos || 0;
        addLog(`Collected ${totalPhotos} photos metadata`, 'success');
        const totalFeedPhotos = collectFeedResult.data?.totalPhotos || 0;
        addLog(`Collected ${totalFeedPhotos} feed photos metadata`, 'success');

        // Reload photos immediately after collection so they're visible
        loadPhotosForAccount(accountId);

        // Step 2: Download photos
        addLog('Step 2: Downloading photos...', 'info');
        const downloadResult = await window.electronAPI.downloadPhotos({
          accountId,
          token: token.trim() || undefined,
        });

        if (!downloadResult.success) {
          throw new Error(downloadResult.error || 'Failed to download photos');
        }

        const downloadStats = downloadResult.data?.downloadStats;
        if (downloadStats) {
          addLog(
            downloadStats.failedDownloads > 0
              ? `Download complete with warnings: ${downloadStats.newDownloads} new, ${downloadStats.alreadyDownloaded} existing, ${downloadStats.failedDownloads} missed after retries`
              : `Download complete: ${downloadStats.newDownloads} new, ${downloadStats.alreadyDownloaded} existing, ${downloadStats.failedDownloads} failed`,
            downloadStats.failedDownloads > 0 ? 'warning' : 'success'
          );
          if (downloadStats.retryAttempts > 0) {
            addLog(
              downloadStats.failedDownloads > 0
                ? `Retried user photo downloads ${downloadStats.retryAttempts} time(s) across failed attempts. ${downloadStats.recoveredAfterRetry} photo(s) recovered automatically.`
                : `Retried user photo downloads ${downloadStats.retryAttempts} time(s) and recovered ${downloadStats.recoveredAfterRetry} photo(s) automatically.`,
              downloadStats.failedDownloads > 0 ? 'warning' : 'info'
            );
          }
          if (downloadResult.data?.photosDirectory) {
            addLog(
              `User photos saved to: ${downloadResult.data.photosDirectory}`,
              'info'
            );
          }
          downloadResult.data?.guidance?.forEach(message =>
            addLog(message, 'warning')
          );
          addResult('Download', downloadResult.data, 'success');
        }

        // Step 3: Download feed photos
        addLog('Step 3: Downloading feed photos...', 'info');
        const downloadFeedResult = await window.electronAPI.downloadFeedPhotos({
          accountId,
          token: token.trim() || undefined,
        });

        if (!downloadFeedResult.success) {
          throw new Error(
            downloadFeedResult.error || 'Failed to download feed photos'
          );
        }

        const downloadFeedStats = downloadFeedResult.data?.downloadStats;
        if (downloadFeedStats) {
          addLog(
            downloadFeedStats.failedDownloads > 0
              ? `Feed download complete with warnings: ${downloadFeedStats.newDownloads} new, ${downloadFeedStats.alreadyDownloaded} existing, ${downloadFeedStats.failedDownloads} missed after retries`
              : `Feed download complete: ${downloadFeedStats.newDownloads} new, ${downloadFeedStats.alreadyDownloaded} existing, ${downloadFeedStats.failedDownloads} failed`,
            downloadFeedStats.failedDownloads > 0 ? 'warning' : 'success'
          );
          if (downloadFeedStats.retryAttempts > 0) {
            addLog(
              downloadFeedStats.failedDownloads > 0
                ? `Retried feed photo downloads ${downloadFeedStats.retryAttempts} time(s) across failed attempts. ${downloadFeedStats.recoveredAfterRetry} photo(s) recovered automatically.`
                : `Retried feed photo downloads ${downloadFeedStats.retryAttempts} time(s) and recovered ${downloadFeedStats.recoveredAfterRetry} photo(s) automatically.`,
              downloadFeedStats.failedDownloads > 0 ? 'warning' : 'info'
            );
          }
          if (downloadFeedResult.data?.feedPhotosDirectory) {
            addLog(
              `Feed photos saved to: ${downloadFeedResult.data.feedPhotosDirectory}`,
              'info'
            );
          }
          downloadFeedResult.data?.guidance?.forEach(message =>
            addLog(message, 'warning')
          );
          addResult('Feed Download', downloadFeedResult.data, 'success');
        }

        // Reload photos after download completes
        loadPhotosForAccount(accountId);
        setActiveIncident(null);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Download failed';

      if (errorMessage === 'Operation cancelled') {
        addLog('Download cancelled by user.', 'warning');
        setProgress(prev => ({
          ...prev,
          isRunning: false,
          currentStep: 'Cancelled',
          total: 0,
          current: 0,
          statusLevel: 'info',
          issueCount: 0,
          failedItems: 0,
          lastIssue: undefined,
        }));
        setActiveIncident(
          createUserIncident('download', errorMessage, { severity: 'warning' })
        );
      } else {
        addLog(`Download failed: ${errorMessage}`, 'error');
        classifyError(errorMessage, 'download').guidance.forEach(message =>
          addLog(message, 'warning')
        );
        setShowProgressPanel(true);
        setProgress(prev => ({
          ...prev,
          isRunning: false,
          currentStep: 'Failed',
          progress: 100,
          total: 0,
          current: 0,
          statusLevel: 'error',
          issueCount: Math.max(prev.issueCount, 1),
          failedItems: Math.max(prev.failedItems, 1),
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
      setProgress(prev => ({
        ...prev,
        isRunning: false,
        currentStep:
          prev.currentStep === 'Cancelled'
            ? 'Cancelled'
            : prev.currentStep === 'Failed'
              ? 'Failed'
              : 'Complete',
        progress:
          prev.currentStep === 'Cancelled' ? prev.progress : 100,
        total: 0,
        current: 0,
      }));
    }
  };

  const handleRetryDownload = useCallback(async () => {
    if (!retryRequest || isDownloading) {
      return;
    }

    await handleDownload(
      retryRequest.username,
      retryRequest.token,
      retryRequest.filePath,
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
          setIsDownloading(false);
          setProgress(prev => ({
            ...prev,
            isRunning: false,
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
              isDownloading={isDownloading}
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
