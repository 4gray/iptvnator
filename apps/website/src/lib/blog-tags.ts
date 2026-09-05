import { siteHref } from './site';

/**
 * Closed blog tag vocabulary. Every tag is a hub page at `/blog/tag/<tag>/`,
 * so the list stays short on purpose: a tag that would hold one post for a
 * long time is a thin page, not a topic. The content collection schema only
 * accepts these slugs, so a typo in a post's frontmatter fails the build
 * instead of silently creating a new tag.
 */
export interface BlogTagMeta {
  /** Human label used in chips, headings and titles. */
  label: string;
  /** One-sentence description for the tag page's intro and meta description. */
  description: string;
}

export const BLOG_TAGS = {
  release: {
    label: 'Release notes',
    description: 'What changed in every IPTVnator release: new features, fixes and known issues.',
  },
  guide: {
    label: 'Guides',
    description: 'Step-by-step setup guides for playlists, portals and the program guide.',
  },
  troubleshooting: {
    label: 'Troubleshooting',
    description: 'Fixes for streams that refuse to play, installs that fail and other common problems.',
  },
  playback: {
    label: 'Playback',
    description: 'The built-in web players, MPV and VLC, codecs, and what makes a stream play or fail.',
  },
  m3u: {
    label: 'M3U playlists',
    description: 'Loading, refreshing and organizing M3U and M3U8 playlists.',
  },
  'xtream-codes': {
    label: 'Xtream Codes',
    description: 'Connecting Xtream Codes API providers and using their live, movie and series catalogs.',
  },
  'stalker-portal': {
    label: 'Stalker portals',
    description: 'Connecting Stalker and Ministra portals with a MAC address.',
  },
  epg: {
    label: 'EPG',
    description: 'XMLTV program guides, channel mapping and the live timeline.',
  },
  macos: {
    label: 'macOS',
    description: 'Installing and running IPTVnator on Apple Silicon and Intel Macs.',
  },
  security: {
    label: 'Security',
    description: 'Unofficial websites, fake apps and how to get the real IPTVnator.',
  },
} as const satisfies Record<string, BlogTagMeta>;

export type BlogTag = keyof typeof BLOG_TAGS;

/** Tag slugs as a non-empty tuple, the shape `z.enum()` in the content schema needs. */
export const BLOG_TAG_SLUGS = Object.keys(BLOG_TAGS) as [BlogTag, ...BlogTag[]];

export function blogTagLabel(tag: BlogTag): string {
  return BLOG_TAGS[tag].label;
}

/** Site-relative href of a tag hub page. */
export function blogTagHref(tag: BlogTag): string {
  return siteHref(`/blog/tag/${tag}/`);
}
