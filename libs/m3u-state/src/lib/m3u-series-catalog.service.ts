import { Injectable, Signal, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Channel } from '@iptvnator/shared/interfaces';
import {
    M3uSeries,
    buildM3uSeriesCatalog,
} from '@iptvnator/shared/m3u-utils/series';
import { M3uCatalogIndexService } from './m3u-catalog-index.service';
import { selectActivePlaylistId } from './selectors';

/**
 * The series layer over the catalog index: episode rows collapsed into
 * series.
 *
 * ## Why it is not on `M3uCatalogIndexService`
 *
 * The workspace shell injects the index service to decide which rail links
 * to offer, so everything that service imports ships in the initial
 * payload. Only the Series section and the series detail read this layer,
 * and both are lazy routes; kept here, behind its own entry point
 * (`@iptvnator/m3u-state/series-catalog`) rather than the library barrel,
 * the aggregation and remake-split code loads with them instead of at
 * launch.
 *
 * It reads `index`, not the stored rows, so it is empty while the next
 * playlist loads — an episode id is minted with the active playlist's id,
 * and the previous playlist's rows must never be keyed with the new one.
 */
@Injectable({ providedIn: 'root' })
export class M3uSeriesCatalogService {
    private readonly catalogIndex = inject(M3uCatalogIndexService);

    private readonly playlistId: Signal<string> = inject(Store).selectSignal(
        selectActivePlaylistId
    );

    /**
     * Kept as its own `computed` so it is only built when something reads
     * it. It is the expensive half — title normalization runs per episode
     * row, which is 40k of them on a real catalog — and a viewer who never
     * opens the Series section should not pay for it.
     */
    readonly series: Signal<readonly M3uSeries<Channel>[]> = computed(() =>
        buildM3uSeriesCatalog(
            this.catalogIndex.index().byKind.episode,
            this.playlistId()
        )
    );

    /** Series by their stable numeric id, for the detail route. */
    readonly seriesById: Signal<ReadonlyMap<number, M3uSeries<Channel>>> =
        computed(
            () => new Map(this.series().map((series) => [series.id, series]))
        );
}
