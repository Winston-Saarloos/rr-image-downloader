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
  onLog: (
    message: string,
    type?: 'info' | 'success' | 'error' | 'warning'
  ) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
  onLog,
}) => {
  const [isSelectingFolder, setIsSelectingFolder] = useState(false);

  const handleSelectFolder = async () => {
    if (!window.electronAPI) return;

    setIsSelectingFolder(true);
    try {
      const folder = await window.electronAPI.selectOutputFolder();
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
    const value = parseInt(e.target.value);
    if (!isNaN(value)) {
      await onUpdateSettings({ interPageDelayMs: value });
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
          Configure output path and request delays
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
        </div>

        {/* Delay Between Pages */}
        <div className="space-y-2">
          <Label htmlFor="request-delay">Request Delay (ms)</Label>
          <Input
            id="request-delay"
            type="number"
            value={settings.interPageDelayMs}
            onChange={handleDelayChange}
            min="0"
            max="5000"
          />
          <p className="text-sm text-muted-foreground">
            Milliseconds between requests (minimum 500ms recommended)
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
