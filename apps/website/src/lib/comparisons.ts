/**
 * Registry of the comparison pages under `/compare/`.
 *
 * Most of them compare IPTVnator's own options against each other — connection
 * types, playback engines, editions — so every claim can be checked against
 * this repository. A page that names other software follows stricter rules:
 * only platform and feature facts that are stable and publicly documented, a
 * dated `ThirdPartyNote`, no logos or brand styling, no download links to the
 * other project, and no claim that a feature is missing unless it was checked.
 * Prefer describing what IPTVnator does and letting the difference speak.
 */

export type ComparisonSlug =
  | 'm3u-vs-xtream-vs-stalker'
  | 'playback-engines'
  | 'desktop-vs-browser'
  | 'iptvnator-vs-vlc'
  | 'iptvnator-vs-kodi'
  | 'computer-vs-tv-box';

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
  {
    slug: 'iptvnator-vs-vlc',
    label: 'IPTVnator vs VLC',
    eyebrow: 'Compare · Other players',
    question:
      'VLC opens an M3U playlist too. When is that enough, and what does a player built around IPTV add on top?',
    href: '/iptvnator/compare/iptvnator-vs-vlc/',
    icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  },
  {
    slug: 'iptvnator-vs-kodi',
    label: 'IPTVnator vs Kodi',
    eyebrow: 'Compare · Other players',
    question:
      'Kodi is a whole media center and reaches IPTV through a PVR add-on. When is that the right shape, and when do you want a player that only does IPTV?',
    href: '/iptvnator/compare/iptvnator-vs-kodi/',
    icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
  },
  {
    slug: 'computer-vs-tv-box',
    label: 'Computer vs TV box',
    eyebrow: 'Compare · Where you watch',
    question:
      'A set-top box in the living room or a computer at a desk: where should IPTV actually run, and what does each make easy?',
    href: '/iptvnator/compare/computer-vs-tv-box/',
    icon: 'M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12z',
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
