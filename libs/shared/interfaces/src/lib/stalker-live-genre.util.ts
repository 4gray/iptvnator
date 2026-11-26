const sectionMarkers = new Set(['itv', 'radio', 'vod', 'series']);

/** Category fields on saved live rows can hold the app's section marker instead of a genre. */
function providerCategoryId(value: unknown): string | null {
    const id = String(value ?? '').trim();
    return id && !sectionMarkers.has(id.toLowerCase()) ? id : null;
}

/** Live/radio rows may identify their genre in either provider field. */
export function getStalkerLiveRowGenre(
    item: unknown,
    fallbackCategoryId?: string | number | null
): string | null {
    const row =
        item && typeof item === 'object'
            ? (item as { tv_genre_id?: unknown; category_id?: unknown })
            : null;
    return (
        String(row?.tv_genre_id ?? '').trim() ||
        providerCategoryId(row?.category_id) ||
        providerCategoryId(fallbackCategoryId)
    );
}
