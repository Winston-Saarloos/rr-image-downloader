import { isViewerOnlyMode } from '../viewer-only-mode';

describe('viewer-only mode cutoff', () => {
  it('is inactive before June 6, 2027 local time', () => {
    expect(isViewerOnlyMode(new Date(2027, 5, 5, 23, 59, 59, 999))).toBe(false);
  });

  it('activates at local midnight on June 6, 2027', () => {
    expect(isViewerOnlyMode(new Date(2027, 5, 6, 0, 0, 0, 0))).toBe(true);
  });

  it('stays active after June 6, 2027', () => {
    expect(isViewerOnlyMode(new Date(2027, 5, 7, 12, 0, 0, 0))).toBe(true);
  });
});
