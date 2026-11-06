/** Shared numeric identity rules for detail metadata and historical backup values. */
export function normalizeContentMetadataIdentity(patch: {
    tmdbId?: unknown;
    releaseYear?: unknown;
}): { tmdbId: number | undefined; releaseYear: number | undefined } {
    const id = Number(patch.tmdbId);
    const year = Number(patch.releaseYear);
    // Provider release years use the same 19xx/20xx range as extractYear.
    return {
        tmdbId: Number.isInteger(id) && id > 0 ? id : undefined,
        releaseYear:
            Number.isInteger(year) && year >= 1900 && year <= 2099
                ? year
                : undefined,
    };
}
