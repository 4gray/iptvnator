/**
 * The catalog layer: content-kind classification and the per-kind index.
 *
 * A secondary entry point (`@iptvnator/shared/m3u-utils/catalog`), not part
 * of the main barrel: the startup path reaches that barrel, and esbuild puts
 * every module the barrel re-exports in the chunk the launch loads, even
 * when only lazy routes use it. Only the catalog sections, the player and
 * the collections classify rows, so this code loads with them.
 */
export * from './lib/m3u-catalog-index.util';
export * from './lib/m3u-content-kind.util';
export * from './lib/m3u-episode-code.util';
