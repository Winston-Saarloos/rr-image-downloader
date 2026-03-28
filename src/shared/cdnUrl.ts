/** Default Rec Room CDN base (preferred). */
export const DEFAULT_CDN_BASE = 'https://cdn.rec.net/img/';

/** Legacy Rec Room CDN base retained only for migration. */
export const LEGACY_CDN_BASE = 'https://img.rec.net/';

const PLACEHOLDER = '{image_name}';

export const CDN_BASE_OPTIONS = [DEFAULT_CDN_BASE] as const;

export function normalizeCdnBase(cdnBase?: string): string {
  const raw = cdnBase?.trim();
  if (!raw) {
    return DEFAULT_CDN_BASE;
  }

  const withoutPlaceholder = raw.includes(PLACEHOLDER)
    ? raw.replace(PLACEHOLDER, '').replace(/\/+$/, '')
    : raw;
  const candidate = withoutPlaceholder.includes('://')
    ? withoutPlaceholder
    : `https://${withoutPlaceholder}`;

  try {
    const { hostname } = new URL(candidate);
    if (hostname.toLowerCase() === 'img.rec.net') {
      return DEFAULT_CDN_BASE;
    }
  } catch {
    return DEFAULT_CDN_BASE;
  }

  return DEFAULT_CDN_BASE;
}

/**
 * Builds a full image URL by appending `imageName` to a base URL.
 *
 * For backward compatibility, if the stored base includes `{image_name}`,
 * that placeholder (and any trailing slash) is stripped first.
 */
export function buildCdnImageUrl(cdnBase: string, imageName: string): string {
  const name = imageName.trim();
  if (!name) {
    return '';
  }

  return `${normalizeCdnBase(cdnBase)}${name}`;
}

/**
 * Returns true when image requests should include the user token.
 *
 * All supported settings are canonicalized to `cdn.rec.net`, which must not
 * receive auth tokens because it returns 403 when Authorization is present.
 */
export function shouldIncludeTokenForCdnBase(cdnBase: string): boolean {
  return normalizeCdnBase(cdnBase) !== DEFAULT_CDN_BASE;
}
