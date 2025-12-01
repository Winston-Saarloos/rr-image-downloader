import React, { useCallback, useEffect, useState } from 'react';
import { Download, BarChart3 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DownloadPanel } from './components/DownloadPanel';
import { PhotoViewer } from './components/PhotoViewer';
import { ProgressDisplay } from './components/ProgressDisplay';
import { DebugMenu } from './components/DebugMenu';
import { StatsDialog } from './components/StatsDialog';
import { ThemeToggle } from './components/ThemeToggle';
import { RecNetSettings, Progress } from '../shared/types';

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

  const handleDownload = async (username: string, token: string, filePath: string) => {
    if (!username.trim() || !filePath.trim()) {
      return;
    }

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
        setSettings((prev) => ({ ...prev, outputRoot: filePath }));
        addLog(`Output path set to: ${filePath}`, 'info');

        // Search for account by username
        addLog(`Searching for account: ${username}`, 'info');
        const searchResult = await window.electronAPI.searchAccounts(username);
        if (!searchResult.success || !searchResult.data || searchResult.data.length === 0) {
          throw new Error('Account not found');
        }

        const account = searchResult.data[0];
        const accountId = account.accountId.toString();
        setCurrentAccountId(accountId);
        addLog(`Found account: ${account.displayName} (ID: ${accountId})`, 'success');

        // Step 1: Collect photos metadata
        addLog('Step 1: Collecting photos metadata...', 'info');
        const collectResult = await window.electronAPI.collectPhotos({
          accountId,
          token: token.trim() || undefined,
        });

        if (!collectResult.success) {
          throw new Error(collectResult.error || 'Failed to collect photos');
        }

        const totalPhotos = collectResult.data?.totalPhotos || 0;
        addLog(`Collected ${totalPhotos} photos metadata`, 'success');

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

        // Reload photos after download completes
        setTimeout(() => {
          loadPhotosForAccount(accountId);
        }, 1000);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Download failed';
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
      // Clear currentAccountId after a delay to allow PhotoViewer to manage its own selection
      // This allows users to switch between accounts after download completes
      setTimeout(() => {
        setCurrentAccountId('');
      }, 2000);
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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <h1 className="text-4xl font-bold">Photo Viewer</h1>
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
          <p className="text-muted-foreground">
            Download and view your Rec Room photos
          </p>
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
        <div className="mb-6">
          <ProgressDisplay progress={progress} />
        </div>

        {/* Photo Viewer */}
        <PhotoViewer
          filePath={settings.outputRoot}
          accountId={isDownloading ? currentAccountId : undefined}
          isDownloading={isDownloading}
          onAccountChange={handleViewerAccountChange}
        />

        {/* Debug Menu */}
        <DebugMenu
          settings={settings}
          onUpdateSettings={updateSettings}
          logs={logs}
          results={results}
          onClearLogs={clearLogs}
        />
      </div>
    </div>
  );
}

export default App;
