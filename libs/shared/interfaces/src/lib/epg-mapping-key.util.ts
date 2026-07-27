/**
 * Key helpers for the manual EPG channel mapping table
 * (`epg_channel_mappings`).
 *
 * M3U channels use their EPG lookup key (tvg-id, falling back to the
 * channel name) directly — those identifiers are meaningful across
 * playlists, so a mapping saved once applies everywhere.
 *
 * Xtream stream IDs and Stalker channel IDs, on the other hand, are
 * provider-local: stream 12345 in portal A has nothing to do with
 * stream 12345 in portal B. Mapping keys for portal channels therefore
 * embed the playlist ID so mappings never leak across portals. Shared
 * between the renderer and the Electron main process/worker, like
 * `title-normalization.util.ts`.
 */
export function buildXtreamEpgMappingKey(
    playlistId: string,
    xtreamId: number | string
): string {
    return `xtream:${playlistId}:${xtreamId}`;
}

export function buildStalkerEpgMappingKey(
    playlistId: string,
    stalkerId: number | string
): string {
    return `stalker:${playlistId}:${stalkerId}`;
}
