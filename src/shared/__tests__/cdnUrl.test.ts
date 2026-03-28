import {
  buildCdnImageUrl,
  DEFAULT_CDN_BASE,
  normalizeCdnBase,
  shouldIncludeTokenForCdnBase,
} from '../cdnUrl';

describe('normalizeCdnBase', () => {
  it('always returns the canonical cdn.rec.net base', () => {
    expect(normalizeCdnBase(DEFAULT_CDN_BASE)).toBe(DEFAULT_CDN_BASE);
    expect(normalizeCdnBase('https://cdn.rec.net/img/{image_name}')).toBe(
      DEFAULT_CDN_BASE
    );
    expect(normalizeCdnBase('https://img.rec.net/')).toBe(DEFAULT_CDN_BASE);
    expect(normalizeCdnBase('img.rec.net')).toBe(DEFAULT_CDN_BASE);
  });
});

describe('buildCdnImageUrl', () => {
  it('uses default cdn.rec.net/img base', () => {
    expect(buildCdnImageUrl(DEFAULT_CDN_BASE, 'photo.jpg')).toBe(
      'https://cdn.rec.net/img/photo.jpg'
    );
  });

  it('rewrites legacy img.rec.net base to cdn.rec.net', () => {
    expect(buildCdnImageUrl('https://img.rec.net/', 'foo.png')).toBe(
      'https://cdn.rec.net/img/foo.png'
    );
    expect(buildCdnImageUrl('https://img.rec.net', 'foo.png')).toBe(
      'https://cdn.rec.net/img/foo.png'
    );
  });

  it('strips {image_name} placeholder for backward compatibility', () => {
    expect(buildCdnImageUrl('https://cdn.rec.net/img/{image_name}', 'a.jpg')).toBe(
      'https://cdn.rec.net/img/a.jpg'
    );
  });

  it('returns empty string when image name is empty', () => {
    expect(buildCdnImageUrl(DEFAULT_CDN_BASE, '')).toBe('');
    expect(buildCdnImageUrl(DEFAULT_CDN_BASE, '   ')).toBe('');
  });
});

describe('shouldIncludeTokenForCdnBase', () => {
  it('returns false for cdn.rec.net', () => {
    expect(shouldIncludeTokenForCdnBase('https://cdn.rec.net/img/')).toBe(false);
    expect(shouldIncludeTokenForCdnBase('cdn.rec.net/img')).toBe(false);
  });

  it('returns false for img.rec.net because it is rewritten to cdn.rec.net', () => {
    expect(shouldIncludeTokenForCdnBase('https://img.rec.net/')).toBe(false);
  });
});
