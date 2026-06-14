export * from './lib/rails/workspace-dashboard-rails.component';
export * from './lib/rails/dashboard-rail.component';
export { resolveDashboardHeroArtwork } from './lib/rails/dashboard-hero.utils';
export type {
    DashboardHeroArtwork,
    DashboardHeroArtworkInput,
    DashboardHeroBackdropSource,
} from './lib/rails/dashboard-hero.utils';
export {
    buildDashboardLiveEpgDetails,
    buildLiveEpgCardsForEnabledRails,
    buildLiveEpgLookupKeys,
    calcEpgProgress,
    formatEpgTimeRange,
    getLiveEpgProgramForCard,
} from './lib/rails/dashboard-live-epg.utils';
export type { DashboardLiveEpgDetails } from './lib/rails/dashboard-live-epg.utils';
export {
    buildPlaybackPositionReloadKey,
    formatRemainingLabel,
    isContinueWatchingRecentItem,
    playbackProgressPercent,
} from './lib/rails/dashboard-playback.utils';
export type { DashboardRemainingLabel } from './lib/rails/dashboard-playback.utils';
export {
    buildDashboardCollectionViewState,
    buildDashboardRailSeeAllState,
    buildDashboardSourceActions,
    liveRailTitleKeyForSource,
    shouldShowRecentContentSkeleton,
} from './lib/rails/dashboard-rail.utils';
export type {
    DashboardRecentContentSkeletonInput,
    DashboardSourceActionId,
} from './lib/rails/dashboard-rail.utils';
