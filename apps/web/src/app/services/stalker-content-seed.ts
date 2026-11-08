/**
 * The bulk import's Stalker seeder, imported on first use by app.config.
 * Importing this file rather than the library keeps the Stalker data layer
 * out of the initial bundle without marking the library as lazy-loaded,
 * which would forbid the app's other static imports of it.
 */
export { StalkerContentSeedService } from '@iptvnator/portal/stalker/data-access';
