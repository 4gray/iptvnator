/**
 * Key helpers for the manual EPG channel mapping table
 * (`epg_channel_mappings`).
 *
 * M3U channels use their EPG lookup key (tvg-id, falling back to the
 * channel name) directly — those identifiers are meaningful across
 * playlists, so a mapping saved once applies everywhere.
 *
 * Xtream stream IDs, on the other hand, are provider-local integers:
 * stream 12345 in portal A has nothing to do with stream 12345 in
 * portal B. Mapping keys for Xtream channels therefore embed the
 * playlist ID so mappings never leak across portals. Shared between the
 * renderer and the Electron main process/worker, like
 * `title-normalization.util.ts`.
 */
export function buildXtreamEpgMappingKey(
    playlistId: string,
    xtreamId: number | string
): string {
    return `xtream:${playlistId}:${xtreamId}`;
}
