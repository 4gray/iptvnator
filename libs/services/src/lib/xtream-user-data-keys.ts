/**
 * The PWA Xtream user-data maps in USER_DATA_STORAGE, each a JSON object
 * keyed by playlist id. Shared with the playlist backup, which reads and
 * writes them directly.
 */
export const XTREAM_USER_DATA_KEYS = {
    favorites: 'xtream-favorites',
    recentItems: 'xtream-recent-items',
    collectionItems: 'xtream-collection-items',
    playbackPositions: 'xtream-playback-positions',
} as const;
