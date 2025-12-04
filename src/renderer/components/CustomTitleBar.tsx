import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Download, BarChart3, Settings } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ThemeToggle } from './ThemeToggle';
import { UpdateIndicator } from './UpdateIndicator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { SettingsPanel } from './SettingsPanel';
import { LogPanel } from './LogPanel';
import { ResultsPanel } from './ResultsPanel';
import { RecNetSettings } from '../../shared/types';
import packageJson from '../../../package.json';

interface CustomTitleBarProps {
  onDownloadClick: () => void;
  onStatsClick: () => void;
  settings: RecNetSettings;
  onUpdateSettings: (settings: Partial<RecNetSettings>) => Promise<void>;
  logs: Array<{
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
    timestamp: string;
  }>;
  results: Array<{
    operation: string;
    data: unknown;
    type: 'success' | 'error';
    timestamp: string;
  }>;
  onClearLogs: () => void;
  currentAccountId?: string;
}

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  onDownloadClick,
  onStatsClick,
  settings,
  onUpdateSettings,
  logs,
  results,
  onClearLogs,
  currentAccountId,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [debugMenuOpen, setDebugMenuOpen] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI) {
        const maximized = await window.electronAPI.windowIsMaximized();
        setIsMaximized(maximized);
      }
    };
    checkMaximized();

    // Check periodically for maximize/unmaximize state changes
    const interval = setInterval(checkMaximized, 500);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      await window.electronAPI.windowMaximize();
      const maximized = await window.electronAPI.windowIsMaximized();
      setIsMaximized(maximized);
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.windowClose();
    }
  };

  return (
    <>
      <div
        className="h-10 bg-background border-b border-border flex items-center justify-between px-2 fixed top-0 left-0 right-0 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Center - Icon and App Name */}
        <div className="flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2 pointer-events-none">
          <img
            src="/assets/icon.png"
            alt="App Icon"
            className="w-5 h-5"
            onError={e => {
              // Hide icon if it fails to load
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <span className="text-sm font-semibold text-foreground">
            Photo Downloader & Viewer
          </span>
        </div>

        {/* Right side - Window Controls */}
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
              disabled={!currentAccountId}
              aria-label="Stats"
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onDownloadClick}
              aria-label="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
            <UpdateIndicator />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setDebugMenuOpen(true)}
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
            onClick={handleMaximize}
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

      {/* Debug Menu Dialog */}
      <Dialog open={debugMenuOpen} onOpenChange={setDebugMenuOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              <span>Debug Menu</span>
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
                // Logging handled by parent component
              }}
            />
            <LogPanel logs={logs} onClearLogs={onClearLogs} />
            <ResultsPanel results={results} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
