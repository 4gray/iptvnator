/**
 * Database schema re-export from shared library
 * This file maintains backwards compatibility for existing imports
 */

export {
    // Tables
    playlists,
    categories,
    content,
    recentlyViewed,
    favorites,
    epgChannels,
    epgPrograms,
    playbackPositions,
    downloads,
    recordings,
    appState,
    // Types
    type Playlist,
    type NewPlaylist,
    type AppState,
    type NewAppState,
    type Category,
    type NewCategory,
    type Content,
    type NewContent,
    type RecentlyViewed,
    type NewRecentlyViewed,
    type Favorite,
    type NewFavorite,
    type EpgChannel,
    type NewEpgChannel,
    type EpgProgramDb,
    type NewEpgProgramDb,
    type PlaybackPosition,
    type NewPlaybackPosition,
    type Download,
    type NewDownload,
    type Recording,
    type NewRecording,
} from '@iptvnator/shared/database';
