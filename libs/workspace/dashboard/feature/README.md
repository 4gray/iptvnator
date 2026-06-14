# Workspace Dashboard Feature

This library owns the workspace dashboard rails UI. The dashboard is a
read-only surface over existing playlist, recent, favorites, EPG, and Xtream
catalog data; it should not introduce Electron IPC, SQLite schema, or route
contracts on its own.

## Dashboard Surfaces

The dashboard renders a surface only when the matching setting is enabled. Data
rails also require the underlying data slice to have at least one item.

- `hero` shows the large top banner for the most recent global item. When that
  item is a live TV channel, the hero looks up the current XMLTV programme and
  displays the programme title, time range, and EPG progress bar when data is
  available.
- `continueWatching` shows recent movies and series from
  `DashboardDataService.globalRecentVodItems()` using cover cards with playback
  progress when a saved resume position is available.
- `liveFavorites` shows favorited live TV channels from
  `DashboardDataService.globalFavoriteLiveItems()` using the channel layout
  with EPG title, time range, and progress when XMLTV data is available.
- `recentlyWatchedLive` shows recently watched live TV channels from
  `DashboardDataService.globalRecentLiveItems()` using the same channel layout.
- `favoriteMoviesAndSeries` shows favorited movies and series from
  `DashboardDataService.globalFavoriteItems()`, excluding live favorites, using
  cover cards.
- `recentSources` shows recently used playlist/source entries.
- `xtreamRecentlyAdded` shows recently added Xtream catalog items.

## Settings

Per-surface visibility lives on `Settings.dashboardRails` as a
`DashboardRailsSettings` object. Every surface defaults to enabled. Stored
settings are deep-merged with `DEFAULT_DASHBOARD_RAILS_SETTINGS` by
`SettingsStore`, so existing users and older partial settings keep newly added
surfaces visible unless they explicitly turn them off.

The global `showDashboard` flag remains a top-level `Settings` property because
workspace startup and route guards already depend on that contract. The Settings
UI groups `showDashboard` and the per-surface checkboxes in the Dashboard
section. When `showDashboard` is off, the per-surface checkboxes are disabled
because the dashboard route itself is hidden.

## Navigation

Rail cards use the navigation state provided by `DashboardDataService` for the
underlying item. Rail "See all" links may also pass router state:

- live rails open the relevant collection on Live TV.
- cover rails for movies/series open Global Recent or Global Favorites on
  Movies when movie items are present, otherwise on Series.

This keeps the global collection pages from defaulting to Live TV when a
dashboard rail is clearly about movies or series.
