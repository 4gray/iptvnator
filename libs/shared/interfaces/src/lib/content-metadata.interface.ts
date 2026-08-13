/**
 * Presentation and identity facts an Xtream detail view learns about a
 * catalog item and hands back to the `content` row it came from.
 *
 * The catalog endpoints (`get_vod_streams`, `get_series`) carry a title and a
 * poster and nothing else, so a `content` row starts life knowing only what a
 * grid needs. The detail endpoints (`get_vod_info`, `get_series_info`) carry
 * the release date, the original title and often a TMDB id — and TMDB
 * enrichment resolves an id even when the provider ships none. Recording
 * those on the row is what lets anything reading an activity item later
 * (the dashboard hero and recommendation rails above all) repeat the lookup
 * the detail view already did, instead of starting over from the display
 * title. See `docs/architecture/tmdb-metadata-enrichment.md`.
 *
 * There is deliberately no media-type field: for Xtream the catalog files
 * movies and series apart, so `content.type` already IS the media type.
 * Stalker needs one because its embedded-VOD series are stored as movies,
 * but Stalker items never reach the `content` table — they carry their own
 * hints inside the stored entry (`extractStalkerItemTmdbHints`).
 */
export interface ContentMetadataPatch {
    /** Wide 16:9 artwork for the dashboard hero */
    backdropUrl?: string;
    /**
     * The id the detail view had on screen: a provider `tmdb_id` before
     * enrichment runs, the id enrichment resolved afterwards. It is stored
     * UNVETTED on purpose — every consumer reaches TMDB through
     * `TmdbEnrichmentService`, whose `detailsForProviderId` runs
     * `assessProviderId` on the payload and lets the title search take over
     * when the years contradict. Vetting here as well would only record one
     * verdict permanently, where the shared gate re-decides per lookup.
     */
    tmdbId?: number;
    /**
     * Year the PROVIDER stated, never one read out of the title. A reader
     * with no stored year already falls back to its own title extraction, so
     * an absent column means "the provider gave no date" rather than "nobody
     * looked" — and a title year like "2001: A Space Odyssey" can never be
     * frozen into the row as that film's release year.
     */
    releaseYear?: number;
    /** The provider's `o_name`; movies only — series responses carry none */
    originalTitle?: string;
}

/**
 * `extractYear` only ever reads `19xx`/`20xx`, so anything outside that range
 * reached us some other way and is not a release year.
 */
const MIN_RELEASE_YEAR = 1900;
const MAX_RELEASE_YEAR = 2099;

function readText(value: unknown): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readReleaseYear(value: unknown): number | undefined {
    const parsed = readPositiveInteger(value);
    return parsed !== undefined &&
        parsed >= MIN_RELEASE_YEAR &&
        parsed <= MAX_RELEASE_YEAR
        ? parsed
        : undefined;
}

/**
 * Drop everything unusable from a patch, and report `null` when nothing
 * usable is left — callers use that to skip the write entirely rather than
 * spend an IPC round-trip on an empty update.
 *
 * Validating here, once, is what keeps a provider's `"0"`, `""` or `"N/A"`
 * out of the column: the write path is shared by the detail views, the
 * favorites/recent add paths and the DB worker, and each of them sees the
 * raw provider shape.
 */
export function normalizeContentMetadataPatch(
    patch: ContentMetadataPatch | null | undefined
): ContentMetadataPatch | null {
    if (!patch) {
        return null;
    }

    const normalized: ContentMetadataPatch = {};
    const backdropUrl = readText(patch.backdropUrl);
    if (backdropUrl) normalized.backdropUrl = backdropUrl;
    const tmdbId = readPositiveInteger(patch.tmdbId);
    if (tmdbId !== undefined) normalized.tmdbId = tmdbId;
    const releaseYear = readReleaseYear(patch.releaseYear);
    if (releaseYear !== undefined) normalized.releaseYear = releaseYear;
    const originalTitle = readText(patch.originalTitle);
    if (originalTitle) normalized.originalTitle = originalTitle;

    return Object.keys(normalized).length > 0 ? normalized : null;
}
