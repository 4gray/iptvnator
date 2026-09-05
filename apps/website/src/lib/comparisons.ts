/**
 * Registry of the comparison pages under `/compare/`. These pages compare
 * IPTVnator's own options against each other — connection types, playback
 * engines, editions — rather than naming other products, so every claim on
 * them can be checked against this repository.
 */

export type ComparisonSlug =
  | 'm3u-vs-xtream-vs-stalker'
  | 'playback-engines'
  | 'desktop-vs-browser';

export interface ComparisonEntry {
  slug: ComparisonSlug;
  /** Short name for breadcrumbs, cards and the switcher. */
  label: string;
  /** Mono eyebrow above the page title. */
  eyebrow: string;
  /** The question the page answers, one sentence. */
  question: string;
  /** Site-relative href including the GitHub Pages base. */
  href: string;
  /** 24×24 stroke icon path. */
  icon: string;
}

export const COMPARISONS: readonly ComparisonEntry[] = [
  {
    slug: 'm3u-vs-xtream-vs-stalker',
    label: 'M3U vs Xtream Codes vs Stalker',
    eyebrow: 'Compare · Connection types',
    question:
      'Your provider gave you a link, a login or a MAC address. Which one should you use, and what does each give you inside the app?',
    href: '/iptvnator/compare/m3u-vs-xtream-vs-stalker/',
    icon: 'M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z',
  },
  {
    slug: 'playback-engines',
    label: 'Playback engines',
    eyebrow: 'Compare · Players',
    question:
      'Built-in web players, MPV, VLC or the embedded MPV engine: which one plays your streams, and what do you give up by switching?',
    href: '/iptvnator/compare/playback-engines/',
    icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    slug: 'desktop-vs-browser',
    label: 'Desktop app vs browser version',
    eyebrow: 'Compare · Editions',
    question:
      'The desktop app and the self-hosted browser version share one codebase. Here is exactly what the browser cannot do.',
    href: '/iptvnator/compare/desktop-vs-browser/',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
];

export const COMPARE_HUB_HREF = '/iptvnator/compare/';

export function comparisonBySlug(slug: ComparisonSlug): ComparisonEntry {
  const entry = COMPARISONS.find((comparison) => comparison.slug === slug);
  if (!entry) {
    throw new Error(`Unknown comparison slug: ${slug}`);
  }
  return entry;
}
