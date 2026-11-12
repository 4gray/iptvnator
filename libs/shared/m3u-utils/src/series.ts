/**
 * The series layer: episode rows collapsed into series.
 *
 * A secondary entry point (`@iptvnator/shared/m3u-utils/series`), not part
 * of the main barrel: the workspace shell reaches that barrel on the
 * initial path, and only the lazy Series routes use what is exported here.
 */
export * from './lib/m3u-episode-parse.util';
export * from './lib/m3u-series-aggregate.util';
export * from './lib/m3u-series-model';
export * from './lib/m3u-series-remake-split.util';
