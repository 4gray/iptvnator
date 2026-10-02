import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { formatSeriesEpisodeCode } from '@iptvnator/portal/shared/util';
import {
    StalkerStore,
    type StalkerSelectedVodItem,
} from '@iptvnator/portal/stalker/data-access';
import {
    SettingsStore,
    type CrossPortalSimilarItem,
} from '@iptvnator/services';
import { youtubeEmbedUrl } from '@iptvnator/shared/interfaces';
import {
    createSeriesHeroState,
    TrailerDialogService,
    type SeriesHeroQuickStart,
    type SimilarRailItem,
} from '@iptvnator/ui/components';
import type { StalkerQuickStartButton } from './stalker-series-quick-start';

interface StalkerSeriesHeroBindings {
    readonly displayItem: Signal<StalkerSelectedVodItem | null>;
    readonly quickStart: Signal<StalkerQuickStartButton | null>;
    readonly yearLabel: (releaseDate: string) => string | null;
    readonly similarInPortals: Signal<readonly CrossPortalSimilarItem[]>;
    readonly openSimilarInPortals: (item: CrossPortalSimilarItem) => void;
}

/** Hero presentation of the Stalker series page, see `createSeriesHeroState`. */
@Injectable()
export class StalkerSeriesHeroPresenter {
    private readonly translate = inject(TranslateService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly trailerDialog = inject(TrailerDialogService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly bindings = signal<StalkerSeriesHeroBindings | null>(null);
    private readonly info = computed(
        () => this.bindings()?.displayItem()?.info ?? null
    );

    bind(bindings: StalkerSeriesHeroBindings): void {
        this.bindings.set(bindings);
    }

    readonly quickStart = computed<SeriesHeroQuickStart | null>(() => {
        const button = this.bindings()?.quickStart() ?? null;
        if (!button) {
            return null;
        }
        const action = button.action;
        return {
            labelKey: button.labelKey,
            labelParams: button.labelParams,
            episodeLabel: button.episodeLabel,
            icon: button.icon,
            disabled: button.disabled,
            kind: action?.kind ?? null,
            position: action?.position ?? null,
            episodeCode: action
                ? formatSeriesEpisodeCode(
                      action.episode.season,
                      action.episode.episode_num
                  )
                : null,
        };
    });

    readonly hero = createSeriesHeroState({
        title: computed(() => this.info()?.name),
        sourceLabel: computed(() => this.stalkerStore.currentPlaylist()?.title),
        status: computed(() => this.info()?.tmdb_status),
        year: computed(() => {
            const releaseDate = this.info()?.releasedate;
            return releaseDate
                ? (this.bindings()?.yearLabel(releaseDate) ?? releaseDate)
                : null;
        }),
        tmdbGenres: computed(() => this.info()?.tmdb_genres),
        genre: computed(() => this.info()?.genre),
        tmdbCountries: computed(() => this.info()?.tmdb_countries),
        tmdbCast: computed(() => this.info()?.tmdb_cast),
        cast: computed(() => this.info()?.actors),
        tmdbDirectors: computed(() => this.info()?.tmdb_directors),
        director: computed(() => this.info()?.director),
        quickStart: this.quickStart,
        translate: this.translate,
    });

    readonly similarRailItems = computed<SimilarRailItem[]>(() =>
        (this.bindings()?.similarInPortals() ?? []).map((item) => ({
            key: `x${item.match.playlistId}-${item.match.xtreamId}`,
            title: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
            tooltip: `${item.title} — ${item.match.playlistName}`,
        }))
    );

    /** TMDB enrichment supplies the trailer; Stalker portals send none. */
    readonly trailerEmbedUrl = computed(() =>
        youtubeEmbedUrl(this.info()?.tmdb_trailer)
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
        const match = bindings
            ?.similarInPortals()
            .find(
                (candidate) =>
                    `x${candidate.match.playlistId}-${candidate.match.xtreamId}` ===
                    item.key
            );
        if (match) {
            bindings?.openSimilarInPortals(match);
        }
    }
}
