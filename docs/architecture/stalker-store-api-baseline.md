# Stalker Store API Baseline

This is the compatibility baseline for refactoring `apps/web/src/app/stalker/stalker.store.ts`.

Goal: keep this public surface stable while splitting to feature stores.

## Source of Truth

- Store implementation: `apps/web/src/app/stalker/stalker.store.ts`
- Baseline created on current branch state before feature-store extraction.

## Public State Signals

Direct signal properties currently exposed by `signalStore`:

- `selectedContentType: 'vod' | 'itv' | 'series'`
- `selectedCategoryId: string | null | undefined`
- `selectedVodId: string | undefined`
- `selectedSerialId: string | undefined`
- `selectedItvId: string | undefined`
- `limit: number`
- `page: number`
- `searchPhrase: string`
- `currentPlaylist: PlaylistMeta`
- `totalCount: number`
- `selectedItem: StalkerVodSource | null | undefined`
- `vodCategories: StalkerCategoryItem[]`
- `seriesCategories: StalkerCategoryItem[]`
- `itvCategories: StalkerCategoryItem[]`
- `hasMoreChannels: boolean`
- `itvChannels: StalkerItvChannel[]`
- `vodSeriesSeasons: StalkerVodSeriesSeason[]`
- `vodSeriesEpisodes: StalkerVodSeriesEpisode[]`
- `selectedVodSeriesSeasonId: string | undefined`

## Public Computed Selectors

- `getTotalPages: number`
- `getPaginatedContent: StalkerContentItem[] | undefined`
- `isPaginatedContentLoading: boolean`
- `isPaginatedContentFailed: unknown`
- `getSerialSeasonsResource: StalkerSeason[]`
- `isSerialSeasonsLoading: boolean`
- `getVodSeriesSeasonsResource: StalkerVodSeriesSeason[]`
- `isVodSeriesSeasonsLoading: boolean`
- `getCategoryResource: StalkerCategoryItem[]`
- `isCategoryResourceLoading: boolean`
- `isCategoryResourceFailed: unknown`
- `getSelectedCategoryName: string`

## Exposed Resources/Props

These are currently reachable on the store object and used internally by computed selectors:

- `getCategoryResource` (resource)
- `getContentResource` (resource)
- `serialSeasonsResource` (resource)
- `vodSeriesSeasonsResource` (resource)
- `makeStalkerRequest(...)`

During refactor:
- Keep compatibility for external callers that may read these directly.
- If moved/renamed internally, provide facade aliases.

## Public Methods (Compatibility Contract)

- `setSelectedContentType(type: 'vod' | 'itv' | 'series'): void`
- `setSelectedCategory(id: string | number | null): void`
- `setSelectedSerialId(id: string): void`
- `setSelectedVodId(id: string): void`
- `setSelectedItvId(id: string): void`
- `setLimit(limit: number): void`
- `setPage(page: number): void`
- `setCurrentPlaylist(playlist: PlaylistMeta | undefined): Promise<void>`
- `setSelectedItem(selectedItem: StalkerVodSource | null | undefined): void`
- `clearSelectedItem(): void`
- `setCategories(type: 'vod' | 'series' | 'itv', categories: StalkerCategoryItem[]): void`
- `resetCategories(): void`
- `setItvChannels(channels: StalkerItvChannel[]): void`
- `setSearchPhrase(phrase: string): void`
- `fetchVodSeriesEpisodes(videoId: string, seasonId: string): Promise<StalkerVodSeriesEpisode[]>`
- `getSelectedCategory(): { id: string | number; name: string; type: 'vod' | 'itv' | 'series' }`
- `fetchLinkToPlay(portalUrl: string, macAddress: string, cmd: string, series?: number): Promise<string>`
- `getExpireDate(): Promise<string>`
- `addToFavorites(item: any, onDone?: () => void): void`
- `removeFromFavorites(favoriteId: string, onDone?: () => void): void`
- `fetchMovieFileId(movieId: string): Promise<string | null>`
- `createLinkToPlayVod(cmd?: string, title?: string, thumbnail?: string, episodeNum?: number, episodeId?: number, startTime?: number): Promise<void>`
- `addToRecentlyViewed(item: any): void`
- `removeFromRecentlyViewed(itemId: number, onComplete?: () => void): void`
- `fetchChannelEpg(channelId: number | string, size?: number): Promise<EpgItem[]>`

## Current Consumers (Observed)

Top observed store API usage in app code:

- `currentPlaylist` (16 references)
- `setSelectedContentType` (9)
- `selectedItem` (9)
- `setSelectedItem` (7)
- `setSelectedCategory` (6)
- `createLinkToPlayVod` (6)
- `removeFromFavorites` (5)
- `setPage` (4)
- `addToFavorites` (4)
- `fetchChannelEpg` (3)
- plus lower-frequency calls for paging/resources/series/recent.

Consumer directories sampled:

- `apps/web/src/app/stalker/**`
- `apps/web/src/app/xtream-tauri/**`
- `apps/web/src/app/shared/**`

## Invariants to Preserve During Refactor

- Selection IDs (`selectedVodId`, `selectedSerialId`, `selectedItvId`) are synchronized in `setSelectedItem`.
- `setSelectedCategory(...)` resets `page` to `0`.
- `createLinkToPlayVod(...)` continues to:
  - support episode playback metadata
  - append recently viewed
  - preserve external player payload shape
- Full-portal auth path continues through `StalkerSessionService`.
- Non-auth/simple path continues through `DataService.sendIpcEvent(STALKER_REQUEST, ...)`.
- Resource-driven loading signals preserve existing names.

