/** Task-based reading order. Article titles and descriptions stay in the blog collection. */
export interface GuideGroup {
  id: string;
  title: string;
  description: string;
  posts: string[];
  includeLatestRelease?: boolean;
}

export const GUIDE_GROUPS: GuideGroup[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    description: 'Connect your first source. Start with the kind of access you already have.',
    posts: ['m3u-playlist-epg-setup-guide', 'xtream-codes-setup-guide', 'stalker-portal-setup-guide'],
  },
  {
    id: 'live-tv-epg',
    title: 'Live TV & EPG',
    description: 'Find what is on, get the schedule right, and change channels from the sofa.',
    posts: ['m3u-programme-guide', 'epg-guide', 'epg-wrong-program-fix', 'remote-control-guide'],
  },
  {
    id: 'playback',
    title: 'Player & playback',
    description: 'Make the player work for you, from subtitles to a stream that will not start.',
    posts: ['fullscreen-channel-episode-guide', 'player-controls-guide', 'stream-info-diagnostics-guide', 'why-external-players-help'],
  },
  {
    id: 'library',
    title: 'Your library',
    description: 'Organize your sources, keep your place, and take your library with you.',
    posts: ['library-organization-guide', 'playlist-backup-restore-guide', 'offline-downloads-guide', 'alternative-sources-guide', 'tmdb-metadata-guide'],
  },
  {
    id: 'updates',
    title: 'Updates',
    description: 'Choose an update channel and catch up on what changed in the latest release.',
    posts: ['stable-nightly-updates-guide'],
    includeLatestRelease: true,
  },
];
