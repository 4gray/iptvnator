export * from './lib/dashboard-data.service';
export * from './lib/dashboard-portal-live-epg.service';
export * from './lib/dashboard-portal-live-epg.util';
export * from './lib/dashboard-recommendations.service';
export * from './lib/dashboard-recommendations.util';
export {
    classifyDashboardSeries,
    type DashboardSeriesClassification,
    type DashboardSeriesContinuation,
} from './lib/dashboard-series-continuation.util';
export {
    createDashboardSeriesEpisodesRequest,
    DashboardSeriesEpisodesService,
    dashboardSeriesEpisodesRequestKey,
    type DashboardSeriesEpisodes,
    type DashboardSeriesEpisodesRequest,
} from './lib/dashboard-series-episodes.service';
export * from './lib/dashboard-source-expiry.service';
export * from './lib/dashboard-source-expiry.util';
export * from './lib/dashboard-tmdb-lookup.util';
export * from './lib/dashboard-tmdb-match.util';
export * from './lib/dashboard-trending.service';
export { createWatchedHistory } from './lib/watched-history';
