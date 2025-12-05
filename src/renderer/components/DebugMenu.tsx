import React, { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { SettingsPanel } from './SettingsPanel';
import { LogPanel } from './LogPanel';
import { ResultsPanel } from './ResultsPanel';
import { RecNetSettings } from '../../shared/types';
import packageJson from '../../../package.json';

interface DebugMenuProps {
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
}

export const DebugMenu: React.FC<DebugMenuProps> = ({
  settings,
  onUpdateSettings,
  logs,
  results,
  onClearLogs,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4"
      >
        <Settings className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
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
