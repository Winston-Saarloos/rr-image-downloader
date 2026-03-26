/** Default Rec Room CDN base (preferred). */
export const DEFAULT_CDN_BASE = 'https://cdn.rec.net/img/';

/** Alternate legacy CDN base. */
export const LEGACY_CDN_BASE = 'https://img.rec.net/';

const PLACEHOLDER = '{image_name}';

export const CDN_BASE_OPTIONS = [DEFAULT_CDN_BASE, LEGACY_CDN_BASE] as const;

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

  const raw = cdnBase.trim();
  const withoutPlaceholder = raw.includes(PLACEHOLDER)
    ? raw.replace(PLACEHOLDER, '').replace(/\/+$/, '')
    : raw;

  const base = withoutPlaceholder.endsWith('/')
    ? withoutPlaceholder
    : `${withoutPlaceholder}/`;
  return `${base}${name}`;
}

/**
 * Returns true when image requests should include the user token.
 *
 * `cdn.rec.net` must not receive auth tokens because it returns 403 when
 * Authorization is present. `img.rec.net` still accepts authenticated requests.
 */
export function shouldIncludeTokenForCdnBase(cdnBase: string): boolean {
  const raw = cdnBase.trim();
  if (!raw) {
    return true;
  }

  const candidate = raw.includes('://') ? raw : `https://${raw}`;

  try {
    const hostname = new URL(candidate).hostname.toLowerCase();
    return hostname !== 'cdn.rec.net';
  } catch {
    // Preserve historical behavior if a custom value cannot be parsed.
    return true;
  }
}
