/**
 * The two M3U sidebar views that render STORED rows rather than the
 * playlist's live channels.
 *
 * They matter because both resolve what they show against the channel array
 * they are handed: a favourite or a recently watched row whose channel is
 * missing from that array is dropped silently. So they must always receive
 * the complete playlist, never the live-only split the All and Groups views
 * render.
 */
const M3U_COLLECTION_VIEWS: ReadonlySet<string> = new Set([
    'favorites',
    'recent',
]);

export function isM3uCollectionView(view: string | null | undefined): boolean {
    return !!view && M3U_COLLECTION_VIEWS.has(view);
}
