import { useCallback, useState } from 'react';
import type { RecNetSettings } from '../../shared/types';

type ElectronFolderApi = {
  selectOutputFolder: () => Promise<string | null | undefined>;
};

/**
 * Opens the native folder picker and persists the chosen path via `onUpdateSettings`.
 */
export function useSelectOutputFolder(
  onUpdateSettings: (partial: Partial<RecNetSettings>) => Promise<void>
) {
  const [isSelectingFolder, setIsSelectingFolder] = useState(false);

  const selectOutputFolderAndPersist = useCallback(
    async (
      onError?: (message: string) => void
    ): Promise<string | null> => {
      const api = (window as unknown as { electronAPI?: ElectronFolderApi })
        .electronAPI;
      if (!api?.selectOutputFolder) {
        return null;
      }

      setIsSelectingFolder(true);
      try {
        const folder = await api.selectOutputFolder();
        if (folder) {
          await onUpdateSettings({ outputRoot: folder });
          return folder;
        }
        return null;
      } catch (e) {
        onError?.(
          e instanceof Error ? e.message : 'Failed to select output folder'
        );
        return null;
      } finally {
        setIsSelectingFolder(false);
      }
    },
    [onUpdateSettings]
  );

  return { selectOutputFolderAndPersist, isSelectingFolder };
}
