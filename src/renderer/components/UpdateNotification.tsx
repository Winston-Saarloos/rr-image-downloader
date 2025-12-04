import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';
import { Card } from '../../components/ui/card';

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

interface UpdateNotificationProps {
  onClose?: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  onClose,
}) => {
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

  const handleDismiss = () => {
    setUpdateAvailable(null);
    setUpdateDownloaded(null);
    setError(null);
    setDownloadProgress(null);
    setIsDownloading(false);
    if (onClose) {
      onClose();
    }
  };

  // Don't render anything if no update state
  if (!updateAvailable && !updateDownloaded && !error) {
    return null;
  }

  return (
    <Card className="fixed bottom-4 right-4 w-96 shadow-lg z-50 border-2">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {updateDownloaded ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : error ? (
              <AlertCircle className="h-5 w-5 text-red-500" />
            ) : (
              <RefreshCw className="h-5 w-5 text-blue-500" />
            )}
            <h3 className="font-semibold text-lg">
              {updateDownloaded
                ? 'Update Ready'
                : error
                  ? 'Update Error'
                  : 'Update Available'}
            </h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {error ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button
              variant="outline"
              size="sm"
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
              <p className="text-sm font-medium">
                Version {updateDownloaded.version} is ready to install
              </p>
              {currentVersion && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current version: {currentVersion}
                </p>
              )}
              {updateDownloaded.releaseNotes && (
                <div className="mt-2 p-2 bg-muted rounded text-xs max-h-32 overflow-y-auto">
                  {updateDownloaded.releaseNotes}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleInstall} className="flex-1">
                Install & Restart
              </Button>
              <Button variant="outline" size="sm" onClick={handleDismiss}>
                Later
              </Button>
            </div>
          </div>
        ) : updateAvailable ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">
                Version {updateAvailable.version} is available
              </p>
              {currentVersion && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current version: {currentVersion}
                </p>
              )}
              {updateAvailable.releaseNotes && (
                <div className="mt-2 p-2 bg-muted rounded text-xs max-h-32 overflow-y-auto">
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
              <div className="flex gap-2">
                <Button size="sm" onClick={handleDownload} className="flex-1">
                  <Download className="mr-2 h-4 w-4" />
                  Download Update
                </Button>
                <Button variant="outline" size="sm" onClick={handleDismiss}>
                  Later
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
