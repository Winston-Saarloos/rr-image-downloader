import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from './components/ui/button';
import { PhotoViewer } from './components/PhotoViewer';
import { StatsDialog } from './components/StatsDialog';
import { CustomTitleBar } from './components/CustomTitleBar';
import { LibraryMoveDialog } from './components/LibraryMoveDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DEFAULT_CDN_BASE } from '../shared/cdnUrl';
import {
  LibraryMode,
  RecNetSettings,
  UserFacingIncident,
} from '../shared/types';
import { FavoritesProvider } from './contexts/FavoritesContext';
import {
  createOutputFolderUnavailableIncident,
  createUserIncident,
} from './utils/errorPresentation';
import { ErrorRecoveryBanner } from './components/ErrorRecoveryBanner';

/** Set to false to hide the library move entry in the debug menu. */
const LIBRARY_MOVE_ENABLED = true;

function App() {
  const [settings, setSettings] = useState<RecNetSettings>({
    outputRoot: '',
    cdnBase: DEFAULT_CDN_BASE,
    interPageDelayMs: 100,
    maxConcurrentDownloads: 3,
    backgroundMetadataSyncEnabled: false,
  });
  const [currentAccountId, setCurrentAccountId] = useState('');
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('user');
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);
  const [libraryMoveDialogOpen, setLibraryMoveDialogOpen] = useState(false);
  const [resultsScrollRequestId, setResultsScrollRequestId] = useState(0);
  const [headerMode, setHeaderMode] = useState<'full' | 'compact' | 'hidden'>(
    'full'
  );
  const [hasScrolledDown, setHasScrolledDown] = useState(false);
  const [hasScrolledPhotos, setHasScrolledPhotos] = useState(false);
  const [activeIncident, setActiveIncident] =
    useState<UserFacingIncident | null>(null);
  const [logs, setLogs] = useState<
    Array<{
      message: string;
      type: 'info' | 'success' | 'error' | 'warning';
      timestamp: string;
    }>
  >([]);
  const scrollPositionRef = useRef(0);
  const photoScrollRef = useRef<HTMLDivElement | null>(null);

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

  const loadSettings = useCallback(async () => {
    try {
      const loadedSettings = await window.electronAPI.getSettings();
      const offlineSettings = {
        ...loadedSettings,
        backgroundMetadataSyncEnabled: false,
      };
      setSettings(offlineSettings);
      if (loadedSettings.backgroundMetadataSyncEnabled) {
        void window.electronAPI.updateSettings({
          backgroundMetadataSyncEnabled: false,
        });
      }
      if (loadedSettings.outputRootUnavailableMessage) {
        addLog(
          `Saved output folder unavailable: ${loadedSettings.outputRootUnavailableMessage}`,
          'warning'
        );
        setActiveIncident(
          createOutputFolderUnavailableIncident(
            loadedSettings.outputRoot,
            loadedSettings.outputRootUnavailableMessage
          )
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addLog(`Failed to load settings: ${msg}`, 'error');
      setActiveIncident(createUserIncident('settings', msg));
    }
  }, [addLog]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const updateSettings = useCallback(
    async (newSettings: Partial<RecNetSettings>) => {
      try {
        const updatedSettings = await window.electronAPI.updateSettings({
          ...newSettings,
          backgroundMetadataSyncEnabled: false,
        });
        setSettings({
          ...updatedSettings,
          backgroundMetadataSyncEnabled: false,
        });
        if (!updatedSettings.outputRootUnavailableMessage) {
          setActiveIncident(prev =>
            prev?.title === 'Saved output folder unavailable' ? null : prev
          );
        }
        addLog('Settings updated', 'success');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        addLog(`Failed to update settings: ${msg}`, 'error');
        setActiveIncident(createUserIncident('updateSettings', msg));
      }
    },
    [addLog]
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    setActiveIncident(null);
  }, []);

  const openOperationResults = useCallback(() => {
    setDebugMenuOpen(true);
    setResultsScrollRequestId(prev => prev + 1);
  }, []);

  const dismissIncident = useCallback(() => setActiveIncident(null), []);

  const clearPhotosIncident = useCallback(() => {
    setActiveIncident(prev => (prev?.source === 'photos' ? null : prev));
  }, []);

  const handleOpenPathInExplorer = useCallback(
    async (folderPath: string) => {
      const r = await window.electronAPI.openPathInExplorer(folderPath);
      if (!r.success) {
        addLog(r.error ?? 'Could not open folder', 'error');
      }
    },
    [addLog]
  );

  const handleViewerAccountChange = useCallback((accountId?: string) => {
    setCurrentAccountId(accountId || '');
  }, []);

  const handleOpenActivityMenu = useCallback(() => {
    setDebugMenuOpen(true);
  }, []);

  const effectiveOutputExplorerPath =
    (settings.resolvedOutputRoot ?? '').trim() || settings.outputRoot.trim();

  const handleRevealOutputFolder = useCallback(() => {
    if (effectiveOutputExplorerPath) {
      void handleOpenPathInExplorer(effectiveOutputExplorerPath);
    }
  }, [effectiveOutputExplorerPath, handleOpenPathInExplorer]);

  const handlePhotosLoadError = useCallback((message: string) => {
    setActiveIncident(createUserIncident('photos', message));
  }, []);

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
    photoScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <FavoritesProvider>
      <div className="min-h-screen bg-background">
        <LibraryMoveDialog
          open={libraryMoveDialogOpen}
          onOpenChange={setLibraryMoveDialogOpen}
          settings={settings}
          onCompleted={loadSettings}
        />

        <CustomTitleBar
          onStatsClick={() => setStatsDialogOpen(true)}
          settings={settings}
          onUpdateSettings={updateSettings}
          logs={logs}
          onClearLogs={clearLogs}
          currentAccountId={currentAccountId}
          debugMenuOpen={debugMenuOpen}
          onDebugMenuOpenChange={setDebugMenuOpen}
          resultsScrollRequestId={resultsScrollRequestId}
          outputExplorerPath={effectiveOutputExplorerPath}
          libraryMode={libraryMode}
          onLibraryModeChange={setLibraryMode}
          libraryMoveEnabled={LIBRARY_MOVE_ENABLED}
          onOpenLibraryMove={() => setLibraryMoveDialogOpen(true)}
        />

        <div className="container mx-auto px-4 py-4 max-w-7xl h-screen flex flex-col overflow-hidden pt-14">
          <ErrorRecoveryBanner
            incident={activeIncident}
            outputExplorerPath={effectiveOutputExplorerPath}
            onDismiss={dismissIncident}
            onOpenOperationResults={openOperationResults}
            onOpenPathInExplorer={handleOpenPathInExplorer}
          />

          <ErrorBoundary sectionName="Stats">
            <StatsDialog
              open={statsDialogOpen}
              onOpenChange={setStatsDialogOpen}
              accountId={currentAccountId}
              filePath={effectiveOutputExplorerPath}
            />
          </ErrorBoundary>

          <div className="flex-1 min-h-0 relative">
            {hasScrolledDown && headerMode === 'hidden' && (
              <div
                className="absolute left-0 right-0 top-0 z-30 h-3"
                onMouseEnter={() => setHeaderMode('compact')}
              />
            )}
            <ErrorBoundary sectionName="Photo viewer">
              <PhotoViewer
                filePath={effectiveOutputExplorerPath}
                accountId={undefined}
                roomId={undefined}
                eventCreatorId={undefined}
                libraryMode={libraryMode}
                isDownloading={false}
                onAccountChange={handleViewerAccountChange}
                onScrollPositionChange={handlePhotoScroll}
                scrollContainerRef={photoScrollRef}
                headerMode={headerMode}
                onOpenActivityMenu={handleOpenActivityMenu}
                onRevealOutputFolder={handleRevealOutputFolder}
                onPhotosLoadError={handlePhotosLoadError}
                onPhotosLoadSuccess={clearPhotosIncident}
                cdnBase={settings.cdnBase}
                viewerOnlyMode
              />
            </ErrorBoundary>
          </div>

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
