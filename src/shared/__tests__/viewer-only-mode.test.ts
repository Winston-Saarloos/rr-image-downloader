import { isViewerOnlyMode } from '../viewer-only-mode';

describe('viewer-only mode', () => {
  it('is always active', () => {
    expect(isViewerOnlyMode()).toBe(true);
    expect(isViewerOnlyMode(new Date(2027, 5, 5, 23, 59, 59, 999))).toBe(true);
  });
});
