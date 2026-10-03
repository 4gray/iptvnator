import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    formatSeriesEpisodeCode,
    type SeriesQuickStartAction,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { SettingsStore } from '@iptvnator/services';
import type { CrossPortalSimilarItem } from '@iptvnator/services';
import { youtubeEmbedUrl } from '@iptvnator/shared/interfaces';
import {
    createSeriesHeroState,
    TrailerDialogService,
    type SeriesHeroQuickStart,
    type SimilarRailItem,
} from '@iptvnator/ui/components';
import type { SimilarCatalogItem } from '../tmdb-similar.util';
import type { XtreamSerieDetailsView } from './serial-details-playback.service';

interface SerialDetailsHeroBindings {
    readonly selectedItem: Signal<XtreamSerieDetailsView | null>;
    readonly quickStart: Signal<SeriesQuickStartAction | null>;
    readonly yearLabel: (releaseDate: string) => string | null;
    readonly similarItems: Signal<readonly SimilarCatalogItem[]>;
    readonly similarInPortals: Signal<readonly CrossPortalSimilarItem[]>;
    readonly openSimilar: (item: SimilarCatalogItem) => void;
    readonly openSimilarInPortals: (item: CrossPortalSimilarItem) => void;
}

/** Hero presentation of the Xtream series page, see `createSeriesHeroState`. */
@Injectable()
export class SerialDetailsHeroPresenter {
    private readonly translate = inject(TranslateService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly trailerDialog = inject(TrailerDialogService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly bindings = signal<SerialDetailsHeroBindings | null>(null);
    private readonly info = computed(
        () => this.bindings()?.selectedItem()?.info ?? null
    );

    bind(bindings: SerialDetailsHeroBindings): void {
        this.bindings.set(bindings);
    }

    readonly quickStart = computed<SeriesHeroQuickStart | null>(() => {
        const action = this.bindings()?.quickStart() ?? null;
        return action
            ? {
                  labelKey: action.labelKey,
                  labelParams: action.labelParams,
                  episodeLabel: action.episodeLabel,
                  icon: action.icon,
                  disabled: action.disabled,
                  kind: action.kind,
                  position: action.position,
                  episodeCode: formatSeriesEpisodeCode(
                      action.episode.season,
                      action.episode.episode_num
                  ),
              }
            : null;
    });

    readonly hero = createSeriesHeroState({
        title: computed(() => this.info()?.name),
        sourceLabel: computed(() => this.xtreamStore.currentPlaylist()?.name),
        status: computed(() => this.info()?.tmdb_status),
        year: computed(() => {
            const releaseDate = this.info()?.releaseDate;
            return releaseDate
                ? (this.bindings()?.yearLabel(releaseDate) ??
                      releaseDate.slice(0, 4))
                : null;
        }),
        tmdbGenres: computed(() => this.info()?.tmdb_genres),
        genre: computed(() => this.info()?.genre),
        tmdbCountries: computed(() => this.info()?.tmdb_countries),
        tmdbCast: computed(() => this.info()?.tmdb_cast),
        cast: computed(() => this.info()?.cast),
        tmdbDirectors: computed(() => this.info()?.tmdb_directors),
        director: computed(() => this.info()?.director),
        quickStart: this.quickStart,
        translate: this.translate,
    });

    readonly similarRailItems = computed<SimilarRailItem[]>(() => [
        ...(this.bindings()?.similarItems() ?? []).map((item) => ({
            key: `c${item.id}`,
            title: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
        })),
        ...(this.bindings()?.similarInPortals() ?? []).map((item) => ({
            key: `x${item.match.playlistId}-${item.match.xtreamId}`,
            title: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
            tooltip: `${item.title} — ${item.match.playlistName}`,
        })),
    ]);

    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.info()?.youtube_trailer)
    );
    /** Settings → Playback → Play trailers in details background. */
    readonly trailerBackdropUrl = computed(() =>
        this.settingsStore.detailTrailerBackdrop?.() === true
            ? this.trailerEmbedUrl()
            : null
    );

    openTrailer(): void {
        const embedUrl = this.trailerEmbedUrl();
        if (embedUrl) {
            this.trailerDialog.open({ embedUrl, title: this.hero.title() });
        }
    }

    openSimilarRailItem(item: SimilarRailItem): void {
        const bindings = this.bindings();
        const local = bindings
            ?.similarItems()
            .find((candidate) => `c${candidate.id}` === item.key);
        if (local) {
            bindings?.openSimilar(local);
            return;
        }
        const crossPortal = bindings
            ?.similarInPortals()
            .find(
                (candidate) =>
                    `x${candidate.match.playlistId}-${candidate.match.xtreamId}` ===
                    item.key
            );
        if (crossPortal) {
            bindings?.openSimilarInPortals(crossPortal);
        }
    }
}
