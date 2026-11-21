import { isM3uCollectionView } from './m3u-collection-view.util';

/** The part of the catalog index the hint reads. */
interface LiveEmptyHintCatalog {
    splitsCatalog(): boolean;
    liveChannels(): readonly unknown[];
    index(): { readonly counts: { readonly movie: number } };
}

/**
 * The hint under "No channels found" when the split leaves the live views
 * of a playlist empty.
 *
 * A playlist that holds only films and episodes opens on All channels with
 * nothing in it. That is correct — the rows are in Movies and Series — but
 * it reads as a failed import unless the page says where they went. Null
 * whenever the plain empty state is the right one: a collection view, a
 * load in flight, a playlist that is not split, or one that has channels.
 */
export function m3uLiveEmptyHintKey(
    view: string | null | undefined,
    loading: boolean,
    catalog: LiveEmptyHintCatalog
): string | null {
    if (
        isM3uCollectionView(view) ||
        loading ||
        !catalog.splitsCatalog() ||
        catalog.liveChannels().length > 0
    ) {
        return null;
    }

    return catalog.index().counts.movie > 0
        ? 'CHANNELS.CATALOG.EMPTY_HINT_MOVIES'
        : 'CHANNELS.CATALOG.EMPTY_HINT_SERIES';
}
