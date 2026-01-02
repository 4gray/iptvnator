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
  // Types
  type Playlist,
  type NewPlaylist,
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
} from 'database';

