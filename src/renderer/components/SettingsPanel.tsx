import React from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { RecNetSettings } from '../../shared/types';
import { OutputPathPickerGroup } from './OutputPathPickerGroup';

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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          Settings
        </CardTitle>
        <CardDescription>
          Configure the local photo library path
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <OutputPathPickerGroup
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          heading="Output Path"
          inputId="output-path"
          showConfigurationCallout
          calloutContext="settings"
          onPickerError={msg => onLog(msg, 'error')}
          onFolderChosen={path =>
            onLog(`Output folder set to: ${path}`, 'info')
          }
        />
      </CardContent>
    </Card>
  );
};
