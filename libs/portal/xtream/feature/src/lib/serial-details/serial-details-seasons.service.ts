import {
    computed,
    effect,
    inject,
    Injectable,
    Signal,
    signal,
    untracked,
} from '@angular/core';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { buildSeasonDescriptions } from './season-descriptions.util';
import { buildSeasonPosters } from './season-posters.util';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

interface SerialDetailsSeasonsBindings {
    readonly selectedItem: Signal<XtreamSerieDetailsView | null>;
    /**
     * The season the detail container shows. `select()` is also called for
     * the fullscreen episode picker, whose choice enriches another season
     * without changing the detail list; the container's metadata flag must
     * follow the container's own selection.
     */
    readonly detailSeasonKey?: Signal<string | null | undefined>;
}

/**
 * Season presentation of the series page: the descriptions and posters the
 * season container and the inline player show, and the TMDB enrichment of
 * the season the viewer selected.
 */
@Injectable()
export class SerialDetailsSeasonsService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly bindings = signal<SerialDetailsSeasonsBindings | null>(
        null
    );
    private readonly selectedItem = computed(
        () => this.bindings()?.selectedItem() ?? null
    );

    /** Season selected last, in the season container or the fullscreen picker. */
    private readonly selectedSeasonKey = signal<string | null>(null);

    /** Season descriptions (provider text, TMDB fallback, URL junk dropped). */
    readonly descriptions = computed<Record<string, string>>(() =>
        buildSeasonDescriptions(this.selectedItem())
    );

    /** Season posters (TMDB season poster first, provider season cover next). */
    readonly posters = computed<Record<string, string>>(() =>
        buildSeasonPosters(this.selectedItem())
    );

    /**
     * True while TMDB may still fill the detail container's season (show
     * match or season enrichment outstanding); the container then keeps
     * rows it would otherwise render bare as skeletons. Before the
     * container reports its selection, the lowest season stands in.
     */
    readonly metadataLoading = computed(() => {
        const seasonKey =
            this.bindings()?.detailSeasonKey?.() ??
            Object.keys(this.selectedItem()?.episodes ?? {}).sort(
                (a, b) => Number(a) - Number(b)
            )[0];
        return (
            !!seasonKey &&
            this.xtreamStore.isTmdbEpisodeMetadataPending(seasonKey)
        );
    });

    constructor() {
        // TMDB season enrichment, keyed on (tmdb_id, selected season). With
        // season tabs the first seasonSelected fires as soon as seasons load —
        // usually BEFORE the async show-level TMDB match has written
        // info.tmdb_id, and enrichSelectedSerialSeason no-ops without it. So
        // the call must re-run when the match arrives, not only on selection.
        // The store-side enrichment is idempotent per (serial, season).
        effect(() => {
            const tmdbId = this.selectedItem()?.info?.tmdb_id;
            const seasonKey = this.selectedSeasonKey();
            if (tmdbId && seasonKey) {
                untracked(() =>
                    this.xtreamStore.enrichSelectedSerialSeason(seasonKey)
                );
            }
        });
    }

    /** Connects the service to the owning component's reactive state. */
    bind(bindings: SerialDetailsSeasonsBindings): void {
        this.bindings.set(bindings);
    }

    select(seasonKey: string): void {
        // The enrichment call itself runs from the constructor effect keyed
        // on (tmdb_id, selectedSeasonKey) — see the race note there.
        this.selectedSeasonKey.set(seasonKey);
    }
}
