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

    /** Season currently selected in the season container. */
    private readonly selectedSeasonKey = signal<string | null>(null);

    /** Season descriptions (provider text, TMDB fallback, URL junk dropped). */
    readonly descriptions = computed<Record<string, string>>(() =>
        buildSeasonDescriptions(this.selectedItem())
    );

    /** Season posters (TMDB season poster first, provider season cover next). */
    readonly posters = computed<Record<string, string>>(() =>
        buildSeasonPosters(this.selectedItem())
    );

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
