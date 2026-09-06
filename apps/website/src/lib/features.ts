/**
 * Registry of the feature landing pages under `/features/`. The hub, the
 * per-page switcher, the homepage cards and the build test all read from
 * here, so adding a page means adding one entry and one `.astro` file.
 */

export type FeatureSlug =
  | 'm3u-player'
  | 'xtream-codes-player'
  | 'stalker-portal-player'
  | 'epg'
  | 'remote-control';

export interface FeatureGuide {
  href: string;
  label: string;
}

export interface FeatureEntry {
  slug: FeatureSlug;
  /** Short name used in breadcrumbs, cards and the switcher. */
  label: string;
  /** Mono eyebrow above the page title. */
  eyebrow: string;
  /** One sentence for cards. */
  summary: string;
  /** Site-relative href including the GitHub Pages base. */
  href: string;
  /** 24×24 stroke icon path (Heroicons outline style). */
  icon: string;
  guide: FeatureGuide;
}

export const FEATURES: readonly FeatureEntry[] = [
  {
    slug: 'm3u-player',
    label: 'M3U playlist player',
    eyebrow: 'Feature · M3U playlists',
    summary:
      'Load M3U and M3U8 playlists from a link, a file or text, and browse tens of thousands of channels with groups, favorites and search.',
    href: '/iptvnator/features/m3u-player/',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
    guide: { href: '/iptvnator/blog/m3u-playlist-epg-setup-guide/', label: 'M3U and EPG setup guide' },
  },
  {
    slug: 'xtream-codes-player',
    label: 'Xtream Codes player',
    eyebrow: 'Feature · Xtream Codes API',
    summary:
      'Sign in with server URL, username and password for live TV, movies and series with posters, details, catch-up and offline downloads.',
    href: '/iptvnator/features/xtream-codes-player/',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    guide: { href: '/iptvnator/blog/xtream-codes-setup-guide/', label: 'Xtream Codes setup guide' },
  },
  {
    slug: 'stalker-portal-player',
    label: 'Stalker portal player',
    eyebrow: 'Feature · Stalker / Ministra portals',
    summary:
      'Connect Stalker and Ministra portals by MAC address, the way a MAG box does, with live TV, radio, movies, series and an account page.',
    href: '/iptvnator/features/stalker-portal-player/',
    icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0',
    guide: { href: '/iptvnator/blog/stalker-portal-setup-guide/', label: 'Stalker portal setup guide' },
  },
  {
    slug: 'epg',
    label: 'TV guide (EPG)',
    eyebrow: 'Feature · Program guide',
    summary:
      'XMLTV files and portal schedules become a program guide: now and next in every list, a timeline under the player, and catch-up for archived programs.',
    href: '/iptvnator/features/epg/',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    guide: { href: '/iptvnator/blog/m3u-playlist-epg-setup-guide/', label: 'M3U and EPG setup guide' },
  },
  {
    slug: 'remote-control',
    label: 'Phone remote control',
    eyebrow: 'Feature · Remote control',
    summary:
      'The desktop app serves a web remote to any phone on your network: channel up and down, direct numbers, volume, and a now-playing panel.',
    href: '/iptvnator/features/remote-control/',
    icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z',
    guide: { href: '/iptvnator/blog/remote-control-guide/', label: 'Phone remote control guide' },
  },
];

export const FEATURES_HUB_HREF = '/iptvnator/features/';

export function featureBySlug(slug: FeatureSlug): FeatureEntry {
  const entry = FEATURES.find((feature) => feature.slug === slug);
  if (!entry) {
    throw new Error(`Unknown feature slug: ${slug}`);
  }
  return entry;
}
