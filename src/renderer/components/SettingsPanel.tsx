import React, { useState } from 'react';
import { FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { RecNetSettings } from '../../shared/types';

interface SettingsPanelProps {
  settings: RecNetSettings;
  onUpdateSettings: (settings: Partial<RecNetSettings>) => Promise<void>;
  onOpenLibraryMove?: () => void;
  onLog: (
    message: string,
    type?: 'info' | 'success' | 'error' | 'warning'
  ) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
  onOpenLibraryMove,
  onLog,
}) => {
  const [isSelectingFolder, setIsSelectingFolder] = useState(false);

  const handleSelectFolder = async () => {
    const api = (window as unknown as { electronAPI?: any }).electronAPI;
    if (!api) return;

    setIsSelectingFolder(true);
    try {
      const folder = await api.selectOutputFolder();
      if (folder) {
        await onUpdateSettings({ outputRoot: folder });
        onLog(`Output folder set to: ${folder}`, 'info');
      }
    } catch (error) {
      onLog(`Failed to select folder: ${error}`, 'error');
    } finally {
      setIsSelectingFolder(false);
    }
  };

  const handleDelayChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    if (value === '') {
      await onUpdateSettings({ interPageDelayMs: 100 });
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue)) {
        const clampedValue = Math.min(1000, Math.max(0, numValue));
        await onUpdateSettings({ interPageDelayMs: clampedValue });
      }
    }
  };

  const handleMaxConcurrentChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    if (value === '') {
      await onUpdateSettings({ maxConcurrentDownloads: 3 });
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue)) {
        const clampedValue = Math.min(30, Math.max(1, numValue));
        await onUpdateSettings({ maxConcurrentDownloads: clampedValue });
      }
    }
  };

  const handleMaxPhotosChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value.trim();
    if (value === '') {
      await onUpdateSettings({ maxPhotosToDownload: undefined });
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue) && numValue > 0) {
        await onUpdateSettings({ maxPhotosToDownload: numValue });
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          Settings
        </CardTitle>
        <CardDescription>
          Configure output path and download behavior
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Output Folder */}
        <div className="space-y-2">
          <Label htmlFor="output-path">Output Path</Label>
          <div className="flex gap-2">
            <Input
              id="output-path"
              type="text"
              value={settings.outputRoot}
              readOnly
              className="flex-1"
            />
            <Button
              onClick={handleSelectFolder}
              disabled={isSelectingFolder}
              variant="outline"
              size="icon"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
          {(settings.resolvedOutputRoot ?? '').trim() !== '' && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Files are saved under (resolved path)
              </p>
              <p className="break-all rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                {settings.resolvedOutputRoot}
              </p>
            </div>
          )}
          {settings.legacyDefaultRelativeOutputWarning && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              <p>
                You are using the default relative folder name{' '}
                <span className="font-mono">output</span>. Its real location depends
                on how the app was started. Choose a permanent folder (for example
                under Documents or Pictures) with Browse so your photos always save
                where you expect.
              </p>
              {onOpenLibraryMove && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="border-amber-600/40"
                  onClick={() => onOpenLibraryMove()}
                >
                  Move library to a safe folder…
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Delay Between Pages */}
        <div className="space-y-2">
          <Label htmlFor="request-delay">Request Delay (ms)</Label>
          <p className="text-xs text-muted-foreground">
            Resets to 100 when the app is closed and reopened.
          </p>
          <Input
            id="request-delay"
            type="number"
            value={settings.interPageDelayMs ?? 0}
            onChange={handleDelayChange}
            min="0"
            max="1000"
          />
          <p className="text-sm text-muted-foreground">
            Milliseconds between requests. Set to 0 for unlimited download speed.
          </p>
        </div>

        {/* Concurrent Downloads */}
        <div className="space-y-2">
          <Label htmlFor="concurrent-downloads">Max Concurrent Downloads</Label>
          <p className="text-xs text-muted-foreground">
            Resets to 3 when the app is closed and reopened.
          </p>
          <Input
            id="concurrent-downloads"
            type="number"
            value={settings.maxConcurrentDownloads}
            onChange={handleMaxConcurrentChange}
            min="1"
            max="30"
          />
          <p className="text-sm text-muted-foreground">
            Amount of images that can be downloaded concurrently. 
            Lower this value if your downloads are consistently failing.
          </p>
        </div>

        {/* Max Photos to Download (Testing) */}
        <div className="space-y-2">
          <Label htmlFor="max-photos">Max Photos to Download (Testing)</Label>
          <Input
            id="max-photos"
            type="number"
            value={settings.maxPhotosToDownload || ''}
            onChange={handleMaxPhotosChange}
            min="1"
            placeholder="No limit"
          />
          <p className="text-sm text-muted-foreground">
            Limit the number of new photos to download for testing. Leave empty
            for no limit.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
