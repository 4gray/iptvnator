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
} from 'database';

