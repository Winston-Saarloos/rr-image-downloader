export const VIEWER_ONLY_MODE_ERROR =
  'Offline viewer mode is active. Downloads and network fetches are disabled.';

export function isViewerOnlyMode(_now = new Date()): boolean {
  return true;
}
