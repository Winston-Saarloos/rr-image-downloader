import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Download,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';

interface UpdateInfo {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export const UpdateIndicator: React.FC = () => {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(
    null
  );
  const [updateDownloaded, setUpdateDownloaded] = useState<UpdateInfo | null>(
    null
  );
  const [downloadProgress, setDownloadProgress] =
    useState<UpdateProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');

  useEffect(() => {
    // Get current app version
    if (window.electronAPI?.getAppVersion) {
      window.electronAPI.getAppVersion().then(setCurrentVersion);
    }

    // Listen for update events
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable((info: UpdateInfo) => {
        setUpdateAvailable(info);
        setError(null);
      });

      window.electronAPI.onUpdateNotAvailable(() => {
        // Silently handle - no update available
      });

      window.electronAPI.onUpdateDownloadProgress(
        (progress: UpdateProgress) => {
          setDownloadProgress(progress);
          setIsDownloading(true);
        }
      );

      window.electronAPI.onUpdateDownloaded((info: UpdateInfo) => {
        setUpdateDownloaded(info);
        setUpdateAvailable(null);
        setIsDownloading(false);
        setDownloadProgress(null);
      });

      window.electronAPI.onUpdateError((errorData: { message: string }) => {
        setError(errorData.message);
        setIsDownloading(false);
        setDownloadProgress(null);
      });
    }

    return () => {
      // Cleanup listeners
      if (window.electronAPI?.removeUpdateListeners) {
        window.electronAPI.removeUpdateListeners();
      }
    };
  }, []);

  const handleDownload = async () => {
    if (window.electronAPI?.downloadUpdate) {
      try {
        setIsDownloading(true);
        setError(null);
        await window.electronAPI.downloadUpdate();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to start download'
        );
        setIsDownloading(false);
      }
    }
  };

  const handleInstall = async () => {
    if (window.electronAPI?.installUpdate) {
      await window.electronAPI.installUpdate();
    }
  };

  // Don't render anything if no update state
  if (!updateAvailable && !updateDownloaded && !error) {
    return null;
  }

  const getIcon = () => {
    if (updateDownloaded) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    }
    if (error) {
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
    if (isDownloading) {
      return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
    }
    return <RefreshCw className="h-4 w-4 text-blue-500" />;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 relative"
          aria-label="Update status"
        >
          {getIcon()}
          {(updateAvailable || updateDownloaded) && (
            <span className="absolute top-0 right-0 h-2 w-2 bg-blue-500 rounded-full" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="p-3 space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2">
            {getIcon()}
            <h3 className="font-semibold text-sm">
              {updateDownloaded
                ? 'Update Ready'
                : error
                  ? 'Update Error'
                  : 'Update Available'}
            </h3>
          </div>

          {/* Content */}
          {error ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => {
                  setError(null);
                  if (window.electronAPI?.checkForUpdates) {
                    window.electronAPI.checkForUpdates();
                  }
                }}
              >
                Try Again
              </Button>
            </div>
          ) : updateDownloaded ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium">
                  Version {updateDownloaded.version} is ready to install
                </p>
                {currentVersion && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Current version: {currentVersion}
                  </p>
                )}
                {updateDownloaded.releaseNotes && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs max-h-24 overflow-y-auto">
                    {updateDownloaded.releaseNotes}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleInstall} className="flex-1">
                  Install & Restart
                </Button>
              </div>
            </div>
          ) : updateAvailable ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium">
                  Version {updateAvailable.version} is available
                </p>
                {currentVersion && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Current version: {currentVersion}
                  </p>
                )}
                {updateAvailable.releaseNotes && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs max-h-24 overflow-y-auto">
                    {updateAvailable.releaseNotes}
                  </div>
                )}
              </div>

              {/* Download Progress */}
              {isDownloading && downloadProgress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Downloading...</span>
                    <span>{Math.round(downloadProgress.percent)}%</span>
                  </div>
                  <Progress value={downloadProgress.percent} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {formatBytes(downloadProgress.transferred)} /{' '}
                      {formatBytes(downloadProgress.total)}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              {!isDownloading && (
                <Button size="sm" onClick={handleDownload} className="w-full">
                  <Download className="mr-2 h-3 w-3" />
                  Download Update
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

