import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, BarChart3, ArrowUp } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DownloadPanel } from './components/DownloadPanel';
import { PhotoViewer } from './components/PhotoViewer';
import { ProgressDisplay } from './components/ProgressDisplay';
import { DebugMenu } from './components/DebugMenu';
import { StatsDialog } from './components/StatsDialog';
import { ThemeToggle } from './components/ThemeToggle';
import { UpdateNotification } from './components/UpdateNotification';
import {
  RecNetSettings,
  Progress,
  BulkDataRefreshOptions,
} from '../shared/types';
import { FavoritesProvider } from './contexts/FavoritesContext';

function App() {
  const [settings, setSettings] = useState<RecNetSettings>({
    outputRoot: 'output',
    cdnBase: 'https://img.rec.net/',
    globalMaxConcurrentDownloads: 1,
    interPageDelayMs: 500,
  });

  const [progress, setProgress] = useState<Progress>({
    isRunning: false,
    currentStep: 'Ready',
    progress: 0,
    total: 0,
    current: 0,
  });

  const [currentAccountId, setCurrentAccountId] = useState<string>('');
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [headerMode, setHeaderMode] = useState<'full' | 'compact' | 'hidden'>(
    'full'
  );
  const [hasScrolledDown, setHasScrolledDown] = useState(false);
  const [showProgressPanel, setShowProgressPanel] = useState(true);
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
      // Failed to load settings
    }
  };

  const setupProgressMonitoring = () => {
    if (window.electronAPI) {
      window.electronAPI.onProgress((event, progressData) => {
        setProgress(progressData);
      });
    }
  };

  const loadPhotosForAccount = async (accountId: string) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadPhotos(accountId);
        if (result.success && result.data) {
          // Photos loaded successfully
        }
      }
    } catch (error) {
      // Failed to load photos
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
      addLog(`Failed to update settings: ${error}`, 'error');
    }
  };

  const addLog = (
    message: string,
    type: 'info' | 'success' | 'error' | 'warning' = 'info'
  ) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-99), { message, type, timestamp }]);
  };

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
  };

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
    const { forceAccountsRefresh = false, forceRoomsRefresh = false } =
      refreshOptions;

    setIsDownloading(true);
    addLog(`Starting download for username: ${username}`, 'info');
    setProgress({
      isRunning: true,
      currentStep: 'Starting download...',
      progress: 0,
      total: 0,
      current: 0,
    });

    try {
      // Update settings with new file path
      if (window.electronAPI) {
        await window.electronAPI.updateSettings({ outputRoot: filePath });
        setSettings(prev => ({ ...prev, outputRoot: filePath }));
        addLog(`Output path set to: ${filePath}`, 'info');

        // Search for account by username
        addLog(`Searching for account: ${username}`, 'info');
        const searchResult = await window.electronAPI.searchAccounts(username);
        if (
          !searchResult.success ||
          !searchResult.data ||
          searchResult.data.length === 0
        ) {
          throw new Error('Account not found');
        }

        const account = searchResult.data[0];
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

        // Step 1: Collect photos & feed metadata
        addLog('Step 1: Collecting photos metadata...', 'info');
        const collectPhotosResult = await window.electronAPI.collectPhotos({
          accountId,
          token: token.trim() || undefined,
          forceAccountsRefresh,
          forceRoomsRefresh,
        });

        addLog('Step 1b: Collecting feed photos metadata...', 'info');
        const collectFeedResult = await window.electronAPI.collectFeedPhotos({
          accountId,
          token: token.trim() || undefined,
          incremental: true,
          forceAccountsRefresh,
          forceRoomsRefresh,
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
        });

        if (!downloadResult.success) {
          throw new Error(downloadResult.error || 'Failed to download photos');
        }

        const downloadStats = downloadResult.data?.downloadStats;
        if (downloadStats) {
          addLog(
            `Download complete: ${downloadStats.newDownloads} new, ${downloadStats.alreadyDownloaded} existing, ${downloadStats.failedDownloads} failed`,
            'success'
          );
          addResult('Download', downloadResult.data, 'success');
        }

        // Step 3: Download feed photos
        addLog('Step 3: Downloading feed photos...', 'info');
        const downloadFeedResult = await window.electronAPI.downloadFeedPhotos({
          accountId,
        });

        if (!downloadFeedResult.success) {
          throw new Error(
            downloadFeedResult.error || 'Failed to download feed photos'
          );
        }

        const downloadFeedStats = downloadFeedResult.data?.downloadStats;
        if (downloadFeedStats) {
          addLog(
            `Feed download complete: ${downloadFeedStats.newDownloads} new, ${downloadFeedStats.alreadyDownloaded} existing, ${downloadFeedStats.failedDownloads} failed`,
            'success'
          );
          addResult('Feed Download', downloadFeedResult.data, 'success');
        }

        // Reload photos after download completes
        setTimeout(() => {
          loadPhotosForAccount(accountId);
        }, 1000);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Download failed';
      addLog(`Download failed: ${errorMessage}`, 'error');
      addResult('Download', { error: errorMessage }, 'error');
    } finally {
      setIsDownloading(false);
      setProgress({
        isRunning: false,
        currentStep: 'Complete',
        progress: 100,
        total: 0,
        current: 0,
      });
    }
  };

  const handleViewerAccountChange = useCallback(
    (accountId?: string) => {
      // Only update if not downloading (to avoid conflicts)
      if (!isDownloading) {
        setCurrentAccountId(accountId || '');
      }
    },
    [isDownloading]
  );

  const handleCancelDownload = async () => {
    try {
      if (window.electronAPI) {
        const cancelled = await window.electronAPI.cancelOperation();
        if (cancelled) {
          addLog('Download cancelled', 'warning');
          setIsDownloading(false);
          setProgress({
            isRunning: false,
            currentStep: 'Cancelled',
            progress: 0,
            total: 0,
            current: 0,
          });
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
        <div className="container mx-auto px-4 py-4 max-w-7xl h-screen flex flex-col overflow-hidden">
          {/* Header */}
          <header
            className={`sticky top-0 z-20 bg-background/95 backdrop-blur transition-[max-height,transform,opacity] duration-300 overflow-hidden ${
              headerMode === 'hidden'
                ? '-translate-y-full opacity-0 pointer-events-none max-h-0'
                : 'translate-y-0 opacity-100 max-h-[800px]'
            }`}
          >
            {headerMode === 'full' && (
              <div className="space-y-3 px-3 sm:px-4 lg:px-6 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <h1 className="text-4xl font-bold leading-tight">
                      Photo Viewer
                    </h1>
                  </div>
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <Button
                      variant="outline"
                      onClick={() => setStatsDialogOpen(true)}
                      disabled={!currentAccountId}
                    >
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Stats
                    </Button>
                    <Button onClick={() => setDownloadPanelOpen(true)}>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* Download Panel Modal */}
          <DownloadPanel
            open={downloadPanelOpen}
            onOpenChange={setDownloadPanelOpen}
            onDownload={handleDownload}
            onCancel={handleCancelDownload}
            isDownloading={isDownloading}
            settings={settings}
          />

          {/* Stats Dialog */}
          <StatsDialog
            open={statsDialogOpen}
            onOpenChange={setStatsDialogOpen}
            accountId={currentAccountId}
            filePath={settings.outputRoot}
          />

          {/* Progress Display */}
          {!isProgressIdle && showProgressPanel && (
            <div className="mb-4">
              <ProgressDisplay
                progress={progress}
                onClose={() => setShowProgressPanel(false)}
              />
            </div>
          )}

          {/* Photo Viewer */}
          <div className="flex-1 min-h-0 relative">
            {hasScrolledDown && headerMode === 'hidden' && (
              <div
                className="absolute left-0 right-0 top-0 h-3 z-30"
                onMouseEnter={() => setHeaderMode('compact')}
              />
            )}
            <PhotoViewer
              filePath={settings.outputRoot}
              accountId={isDownloading ? currentAccountId : undefined}
              isDownloading={isDownloading}
              onAccountChange={handleViewerAccountChange}
              onScrollPositionChange={handlePhotoScroll}
              scrollContainerRef={photoScrollRef}
              headerMode={headerMode}
            />
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

          {/* Debug Menu */}
          <DebugMenu
            settings={settings}
            onUpdateSettings={updateSettings}
            logs={logs}
            results={results}
            onClearLogs={clearLogs}
          />

          {/* Update Notification */}
          <UpdateNotification />
        </div>
      </div>
    </FavoritesProvider>
  );
}

export default App;
