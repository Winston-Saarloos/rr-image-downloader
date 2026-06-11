import React, { useEffect, useState } from 'react';
import { BarChart3, Minus, Settings, Square, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { UpdateIndicator } from './UpdateIndicator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { SettingsPanel } from './SettingsPanel';
import { LogPanel } from './LogPanel';
import { RecNetSettings } from '../../shared/types';
import type { LibraryMode } from '../../shared/types';
import packageJson from '../../../package.json';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface CustomTitleBarProps {
  onStatsClick: () => void;
  settings: RecNetSettings;
  onUpdateSettings: (settings: Partial<RecNetSettings>) => Promise<void>;
  logs: Array<{
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
    timestamp: string;
  }>;
  onClearLogs: () => void;
  currentAccountId?: string;
  debugMenuOpen: boolean;
  onDebugMenuOpenChange: (open: boolean) => void;
  resultsScrollRequestId: number;
  outputExplorerPath: string;
  libraryMode: LibraryMode;
  onLibraryModeChange: (mode: LibraryMode) => void;
  libraryMoveEnabled?: boolean;
  onOpenLibraryMove?: () => void;
  viewerOnlyMode?: boolean;
}

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  onStatsClick,
  settings,
  onUpdateSettings,
  logs,
  onClearLogs,
  currentAccountId,
  debugMenuOpen,
  onDebugMenuOpenChange,
  resultsScrollRequestId,
  outputExplorerPath,
  libraryMode,
  onLibraryModeChange,
  libraryMoveEnabled = false,
  onOpenLibraryMove,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await window.electronAPI.windowIsMaximized();
      setIsMaximized(maximized);
    };
    void checkMaximized();

    const interval = window.setInterval(() => void checkMaximized(), 500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void resultsScrollRequestId;
  }, [resultsScrollRequestId]);

  const handleMinimize = () => {
    void window.electronAPI.windowMinimize();
  };

  const handleMaximize = async () => {
    await window.electronAPI.windowMaximize();
    const maximized = await window.electronAPI.windowIsMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = () => {
    void window.electronAPI.windowClose();
  };

  return (
    <>
      <div
        className="h-10 bg-background border-b border-border flex items-center justify-between px-2 fixed top-0 left-0 right-0 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Select
            value={libraryMode}
            onValueChange={(value: LibraryMode) => onLibraryModeChange(value)}
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User Photos</SelectItem>
              <SelectItem value="room">Room Photos</SelectItem>
              <SelectItem value="event">Event Photos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div
          className="flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <img
            src="/icon.png"
            alt="App Icon"
            className="w-5 h-5"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="text-sm font-semibold text-foreground">
            Photo Viewer
          </span>
        </div>

        <div
          className="flex items-center ml-auto"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="mr-4">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onStatsClick}
              disabled={libraryMode !== 'user' || !currentAccountId}
              aria-label="Stats"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <UpdateIndicator />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onDebugMenuOpenChange(true)}
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <button
            onClick={handleMinimize}
            className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={() => void handleMaximize()}
            className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="w-10 h-10 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <Dialog open={debugMenuOpen} onOpenChange={onDebugMenuOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span>Settings</span>
              <span className="text-sm font-normal text-muted-foreground pl-2">
                v{packageJson.version}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <SettingsPanel
              settings={settings}
              onUpdateSettings={onUpdateSettings}
              onLog={() => {
                // Logging handled by parent component.
              }}
            />
            {onOpenLibraryMove && (
              <div
                className={`rounded-md border p-3 space-y-2 ${!libraryMoveEnabled ? 'opacity-80' : ''}`}
              >
                <p className="text-sm font-medium">Move Photo Library</p>
                <p className="text-xs text-muted-foreground">
                  Move the entire photo library to another folder.
                </p>
                {!libraryMoveEnabled && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    Temporarily disabled
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!libraryMoveEnabled}
                  title={
                    libraryMoveEnabled
                      ? undefined
                      : 'Library move is disabled. Enable LIBRARY_MOVE_ENABLED in App.tsx.'
                  }
                  onClick={() => {
                    if (libraryMoveEnabled) {
                      onOpenLibraryMove();
                    }
                  }}
                >
                  Move photo library...
                </Button>
              </div>
            )}
            {outputExplorerPath && (
              <p className="text-xs text-muted-foreground break-all">
                Current library: {outputExplorerPath}
              </p>
            )}
            <LogPanel logs={logs} onClearLogs={onClearLogs} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
