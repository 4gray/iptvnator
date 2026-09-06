/**
 * Canonical site location. The site is served from a GitHub Pages project
 * path, so every absolute URL has to carry the `/iptvnator` base.
 */
export const SITE_ORIGIN = 'https://4gray.github.io';
export const SITE_BASE = '/iptvnator';

/** Absolute URL for a site-relative path such as `/download/windows/`. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${SITE_BASE}${path}`;
}

/** Site-relative href with the GitHub Pages base prefix. */
export function siteHref(path: string): string {
  return `${SITE_BASE}${path}`;
}
