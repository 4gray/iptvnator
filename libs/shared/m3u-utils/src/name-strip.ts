/**
 * Channel-name tag stripping: where a name starts once its leading
 * country / language / quality tag is removed.
 *
 * A secondary entry point (`@iptvnator/shared/m3u-utils/name-strip`), not
 * part of the main barrel: the startup path reaches that barrel, and
 * esbuild puts every module the barrel re-exports in the chunk the launch
 * loads. Nothing strips a name before a list, grid or player renders, and
 * all of those load lazily, so this code loads with them.
 */
export * from './lib/m3u-name-tag.util';
export * from './lib/strip-country-prefix.util';
