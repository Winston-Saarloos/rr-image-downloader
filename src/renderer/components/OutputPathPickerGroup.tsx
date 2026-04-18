import React from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from './lib/utils';
import type { RecNetSettings } from '../../shared/types';
import { useSelectOutputFolder } from '../hooks/useSelectOutputFolder';

export interface OutputPathPickerGroupProps {
  settings: RecNetSettings;
  onUpdateSettings: (partial: Partial<RecNetSettings>) => Promise<void>;
  /** Section title (e.g. download question vs. debug “Output Path”). */
  heading: string;
  /** `htmlFor` on the label and `id` on the read-only input. */
  inputId: string;
  /** When true, show the amber “Output folder required” callout when not configured. */
  showConfigurationCallout: boolean;
  /** Wording for the callout: download dialog vs. debug settings. */
  calloutContext?: 'download' | 'settings';
  /** Disables Browse and click-to-pick (e.g. while a download is running). */
  pickerDisabled?: boolean;
  /** Called immediately before opening the picker (e.g. clear prior errors). */
  onBeforePick?: () => void;
  /** Picker unavailable, user cancelled poorly, or IPC error. */
  onPickerError?: (message: string) => void;
  /** After a folder was chosen and persisted. */
  onFolderChosen?: (path: string) => void;
}

export const OutputPathPickerGroup: React.FC<OutputPathPickerGroupProps> = ({
  settings,
  onUpdateSettings,
  heading,
  inputId,
  showConfigurationCallout,
  calloutContext = 'download',
  pickerDisabled = false,
  onBeforePick,
  onPickerError,
  onFolderChosen,
}) => {
  const { selectOutputFolderAndPersist, isSelectingFolder } =
    useSelectOutputFolder(onUpdateSettings);

  const headingDomId = `${inputId}-heading`;

  const handlePick = async () => {
    if (pickerDisabled || isSelectingFolder) {
      return;
    }
    onBeforePick?.();
    const api = (
      window as unknown as {
        electronAPI?: { selectOutputFolder?: () => Promise<unknown> };
      }
    ).electronAPI;
    if (!api?.selectOutputFolder) {
      onPickerError?.('Folder picker is not available in this environment.');
      return;
    }
    const folder = await selectOutputFolderAndPersist(msg =>
      onPickerError?.(
        msg ||
          'Could not open folder picker. Try again or pick a different folder.'
      )
    );
    if (folder) {
      onFolderChosen?.(folder);
    }
  };

  const busy = pickerDisabled || isSelectingFolder;
  const configured = Boolean(settings.outputPathConfiguredForDownload);

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
      role="group"
      aria-labelledby={headingDomId}
    >
      <Label
        id={headingDomId}
        htmlFor={inputId}
        className="text-sm font-medium leading-none"
      >
        {heading}
      </Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          readOnly
          placeholder="Choose a folder with Browse…"
          value={settings.outputRoot}
          onClick={() => void handlePick()}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void handlePick();
            }
          }}
          className={cn(
            'flex-1 cursor-pointer',
            busy && 'cursor-not-allowed opacity-70'
          )}
          title={
            busy
              ? undefined
              : 'Click or press Enter to choose your output folder (same as Browse)'
          }
          tabIndex={busy ? -1 : 0}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void handlePick()}
          disabled={busy}
          aria-busy={isSelectingFolder}
          title="Choose output folder"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        All photos and data are saved under the folder you pick. Use{' '}
        <span className="font-medium">Browse</span> to open File Explorer
      </p>
      {showConfigurationCallout && !configured && (
        <div
          className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-950 dark:text-amber-100"
          role="status"
        >
          <p className="font-medium">Output folder required</p>
          {calloutContext === 'download' ? (
            <p>
              Downloads are disabled until you choose a permanent folder for
              your photo library. Click{' '}
              <span className="font-medium">Browse</span> or this path field to
              open File Explorer
            </p>
          ) : (
            <p>
              Choose where the app stores your photo library. Click{' '}
              <span className="font-medium">Browse</span> or this path field to
              open File Explorer
            </p>
          )}
        </div>
      )}
    </div>
  );
};
