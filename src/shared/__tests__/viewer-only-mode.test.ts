import { isViewerOnlyMode } from '../viewer-only-mode';

describe('viewer-only mode cutoff', () => {
  it('is inactive before June 2, 2026 local time', () => {
    expect(isViewerOnlyMode(new Date(2026, 5, 1, 23, 59, 59, 999))).toBe(false);
  });

  it('activates at local midnight on June 2, 2026', () => {
    expect(isViewerOnlyMode(new Date(2026, 5, 2, 0, 0, 0, 0))).toBe(true);
  });

  it('stays active after June 2, 2026', () => {
    expect(isViewerOnlyMode(new Date(2026, 5, 3, 12, 0, 0, 0))).toBe(true);
  });
});
