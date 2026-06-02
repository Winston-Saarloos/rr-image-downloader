export const VIEWER_ONLY_CUTOFF_YEAR = 2026;
export const VIEWER_ONLY_CUTOFF_MONTH_INDEX = 5;
export const VIEWER_ONLY_CUTOFF_DAY = 6;

export const VIEWER_ONLY_MODE_ERROR =
  'Viewer-only mode is active. Downloads and network fetches are disabled.';

export function getViewerOnlyCutoffDate(): Date {
  return new Date(
    VIEWER_ONLY_CUTOFF_YEAR,
    VIEWER_ONLY_CUTOFF_MONTH_INDEX,
    VIEWER_ONLY_CUTOFF_DAY
  );
}

export function isViewerOnlyMode(now = new Date()): boolean {
  return now.getTime() >= getViewerOnlyCutoffDate().getTime();
}
