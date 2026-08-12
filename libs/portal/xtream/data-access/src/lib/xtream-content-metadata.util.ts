import {
    ContentMetadataPatch,
    extractYear,
    normalizeContentMetadataPatch,
} from '@iptvnator/shared/interfaces';

/**
 * The subset of an Xtream detail response this reads. Movies and series
 * disagree on the release-date field name (`releasedate` vs `releaseDate`)
 * and only movies carry an original title, so both shapes are accepted and
 * whichever fields exist are used.
 */
export interface XtreamDetailMetadataSource {
    backdrop_path?: string[] | null;
    tmdb_id?: number | string | null;
    /** VOD (`get_vod_info`) */
    releasedate?: string | null;
    /** Series (`get_series_info`) */
    releaseDate?: string | null;
    /** VOD only — series responses carry no original title */
    o_name?: string | null;
}

/**
 * Build the patch persisted onto the item's `content` row from what the
 * detail view has on screen.
 *
 * Called on every detail render, including before TMDB enrichment has run,
 * so it must stay meaningful without it: `releasedate` and `o_name` come
 * straight from the provider and are exactly the fields the enrichment query
 * uses, which is what lets a later reader rebuild that same query. The
 * `tmdb_id` is whichever the view currently holds — the provider's claim
 * early on, the resolved id once enrichment lands. The write path never
 * overwrites, so the first non-empty value for each column wins.
 *
 * The year deliberately does NOT fall back to a year found in the title:
 * readers apply that fallback themselves, and storing it would turn a guess
 * into a recorded fact.
 */
export function xtreamDetailContentMetadata(
    info: XtreamDetailMetadataSource | null | undefined
): ContentMetadataPatch | null {
    if (!info) {
        return null;
    }

    return normalizeContentMetadataPatch({
        backdropUrl: info.backdrop_path?.[0] ?? undefined,
        tmdbId: info.tmdb_id != null ? Number(info.tmdb_id) : undefined,
        releaseYear:
            extractYear(info.releasedate ?? info.releaseDate ?? null) ??
            undefined,
        originalTitle: info.o_name ?? undefined,
    });
}

/**
 * Identity of a patch, for the components' "already backfilled this" guard.
 * Every field is included: enrichment fills them in at different times, so a
 * key built from the backdrop alone would suppress the write that carries
 * the TMDB id arriving moments later.
 */
export function xtreamContentMetadataKey(
    patch: ContentMetadataPatch | null
): string {
    return patch
        ? [
              patch.backdropUrl ?? '',
              patch.tmdbId ?? '',
              patch.releaseYear ?? '',
              patch.originalTitle ?? '',
          ].join('|')
        : '';
}
