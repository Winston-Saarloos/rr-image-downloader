import React, { useState } from 'react';
import { FolderOpen } from 'lucide-react';
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

  const handleDelayChange = async (value: number) => {
    await onUpdateSettings({ interPageDelayMs: value });
  };

  return (
    <div className="panel">
      <h2 className="text-2xl font-bold text-terminal-text mb-6 pb-3 border-b-2 border-terminal-border font-mono">
        SYSTEM_CONFIG
      </h2>

      <div className="space-y-6">
        {/* Output Folder */}
        <div>
          <label className="form-label font-mono">OUTPUT_PATH:</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={settings.outputRoot}
              readOnly
              className="form-input flex-1 bg-terminal-bg font-mono"
            />
            <button
              onClick={handleSelectFolder}
              disabled={isSelectingFolder}
              className="btn btn-primary flex items-center gap-2 font-mono"
            >
              <FolderOpen size={16} />
              {isSelectingFolder ? 'SELECTING...' : 'BROWSE'}
            </button>
          </div>
        </div>

        {/* Delay Between Pages */}
        <div>
          <label className="form-label font-mono">REQUEST_DELAY:</label>
          <input
            type="number"
            value={settings.interPageDelayMs}
            onChange={e => handleDelayChange(parseInt(e.target.value))}
            min="0"
            max="5000"
            className="form-input font-mono"
          />
          <p className="text-sm text-terminal-textMuted mt-1 font-mono">
            &gt; Milliseconds between requests (minimum 500ms)
          </p>
        </div>
      </div>
    </div>
  );
};
