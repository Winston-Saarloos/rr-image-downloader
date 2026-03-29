import {
  DEFAULT_DOWNLOAD_SOURCE_SELECTION,
  getSelectedDownloadSources,
  hasSelectedDownloadSources,
} from '../download-sources';

describe('download source selection helpers', () => {
  it('defaults to feed and user photos only', () => {
    expect(DEFAULT_DOWNLOAD_SOURCE_SELECTION).toEqual({
      downloadUserFeed: true,
      downloadUserPhotos: true,
      downloadProfileHistory: false,
    });
  });

  it('returns sources in feed, photos, profile history order', () => {
    expect(
      getSelectedDownloadSources({
        downloadUserFeed: true,
        downloadUserPhotos: true,
        downloadProfileHistory: true,
      })
    ).toEqual(['user-feed', 'user-photos', 'profile-history']);
  });

  it('supports feed-only and photos-only selections', () => {
    expect(
      getSelectedDownloadSources({
        downloadUserFeed: true,
        downloadUserPhotos: false,
        downloadProfileHistory: false,
      })
    ).toEqual(['user-feed']);

    expect(
      getSelectedDownloadSources({
        downloadUserFeed: false,
        downloadUserPhotos: true,
        downloadProfileHistory: false,
      })
    ).toEqual(['user-photos']);
  });

  it('detects whether at least one source is selected', () => {
    expect(
      hasSelectedDownloadSources({
        downloadUserFeed: false,
        downloadUserPhotos: false,
        downloadProfileHistory: false,
      })
    ).toBe(false);

    expect(
      hasSelectedDownloadSources({
        downloadUserFeed: false,
        downloadUserPhotos: false,
        downloadProfileHistory: true,
      })
    ).toBe(true);
  });
});
