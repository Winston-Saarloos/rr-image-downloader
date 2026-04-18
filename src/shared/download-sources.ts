export interface DownloadSourceSelection {
  downloadUserFeed: boolean;
  downloadUserPhotos: boolean;
  downloadProfileHistory: boolean;
}

export type DownloadSource =
  | 'user-feed'
  | 'user-photos'
  | 'profile-history'
  | 'room-photos';

export const DEFAULT_DOWNLOAD_SOURCE_SELECTION: DownloadSourceSelection = {
  downloadUserFeed: true,
  downloadUserPhotos: true,
  downloadProfileHistory: false,
};

export function hasSelectedDownloadSources(
  selection: DownloadSourceSelection
): boolean {
  return (
    selection.downloadUserFeed ||
    selection.downloadUserPhotos ||
    selection.downloadProfileHistory
  );
}

export function getSelectedDownloadSources(
  selection: DownloadSourceSelection
): DownloadSource[] {
  const sources: DownloadSource[] = [];

  if (selection.downloadUserFeed) {
    sources.push('user-feed');
  }
  if (selection.downloadUserPhotos) {
    sources.push('user-photos');
  }
  if (selection.downloadProfileHistory) {
    sources.push('profile-history');
  }

  return sources;
}
