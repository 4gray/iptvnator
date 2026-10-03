import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    formatDurationLabel,
    formatRemainingLabel,
    parseDurationSeconds,
    playbackProgressPercent,
    shortCountryList,
    shortCountryName,
    type RemainingTimeLabel,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import type {
    PlaybackPositionData,
    TmdbCountryFacet,
    TmdbEnrichedCastMember,
    TmdbGenreFacet,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';
import type { CrossPortalSimilarItem } from '@iptvnator/services';
import {
    castMembersFromNames,
    splitPeopleNames,
    type DetailActionButtonState,
    type SimilarRailItem,
} from '@iptvnator/ui/components';
import type { SimilarCatalogItem } from '../tmdb-similar.util';

export interface VodHeroGenreChip {
    readonly label: string;
    readonly facet: TmdbGenreFacet | null;
}

export interface VodHeroCountryChip {
    readonly label: string;
    readonly facet: TmdbCountryFacet | null;
}

export interface VodHeroPrimaryAction {
    readonly label: string;
    readonly meta: string | null;
    readonly icon: string;
    readonly state: DetailActionButtonState;
}

interface VodDetailsHeroBindings {
    readonly info: Signal<XtreamVodInfo | null>;
    readonly position: Signal<PlaybackPositionData | null>;
    readonly hasPlaybackPosition: Signal<boolean>;
    readonly isOfflinePrimary: Signal<boolean>;
    readonly externalLabel: Signal<string | null>;
    readonly externalIcon: Signal<string>;
    readonly externalState: Signal<DetailActionButtonState>;
    readonly formatPosition: () => string;
    readonly similarItems: Signal<readonly SimilarCatalogItem[]>;
    readonly similarInPortals: Signal<readonly CrossPortalSimilarItem[]>;
}

/**
 * Presentation of the Xtream movie hero: the kind label, the chips, the
 * primary button's two lines, the resume bar, the credits and the Similar
 * rail, all derived from the route's selected movie.
 */
@Injectable()
export class VodDetailsHeroPresenter {
    private readonly translate = inject(TranslateService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly bindings = signal<VodDetailsHeroBindings | null>(null);

    bind(bindings: VodDetailsHeroBindings): void {
        this.bindings.set(bindings);
    }

    private readonly info = computed(() => this.bindings()?.info() ?? null);

    readonly kindLabel = computed(() => {
        const kind = this.translate.instant('WORKSPACE.DASHBOARD.TYPE_MOVIE');
        const source = this.xtreamStore.currentPlaylist()?.name?.trim();
        return source ? `${kind} · ${source}` : kind;
    });

    readonly durationSeconds = computed(() => {
        const info = this.info();
        return info?.duration_secs || parseDurationSeconds(info?.duration);
    });

    readonly durationLabel = computed(() =>
        this.label(formatDurationLabel(this.durationSeconds()))
    );

    /** One chip per TMDB genre facet, else the provider's list split up. */
    readonly genreChips = computed<VodHeroGenreChip[]>(() => {
        const info = this.info();
        if (info?.tmdb_genres?.length) {
            return info.tmdb_genres.map((facet) => ({
                label: facet.name,
                facet,
            }));
        }
        return (info?.genre ?? '')
            .split(/[,/|]/)
            .map((genre) => genre.trim())
            .filter((genre) => genre.length > 0)
            .map((label) => ({ label, facet: null }));
    });

    readonly countryChips = computed<VodHeroCountryChip[]>(() => {
        const info = this.info();
        if (info?.tmdb_countries?.length) {
            return info.tmdb_countries.map((facet) => ({
                label: shortCountryName(facet.name, facet.code),
                facet,
            }));
        }
        return shortCountryList(info?.country).map((label) => ({
            label,
            facet: null,
        }));
    });

    readonly progress = computed(() => {
        const bindings = this.bindings();
        return bindings?.hasPlaybackPosition()
            ? playbackProgressPercent(bindings.position())
            : null;
    });

    readonly primaryAction = computed<VodHeroPrimaryAction>(() => {
        const bindings = this.bindings();
        const state = bindings?.externalState() ?? 'idle';
        const icon = bindings?.isOfflinePrimary()
            ? 'play_circle'
            : (bindings?.externalIcon() ?? 'play_arrow');
        const externalLabel = bindings?.externalLabel();
        if (externalLabel) {
            return { label: externalLabel, meta: null, icon, state };
        }
        if (bindings?.isOfflinePrimary()) {
            return {
                label: this.translate.instant('DOWNLOADS.PLAY_LOCAL'),
                meta: null,
                icon,
                state,
            };
        }
        if (bindings?.hasPlaybackPosition()) {
            const remaining = this.label(
                formatRemainingLabel(bindings.position())
            );
            return {
                label: this.translate.instant(
                    'WORKSPACE.DASHBOARD.HERO_CONTINUE'
                ),
                meta: remaining ?? bindings.formatPosition() ?? null,
                icon,
                state,
            };
        }
        return {
            label: this.translate.instant('XTREAM.PLAY'),
            meta: this.durationLabel(),
            icon,
            state,
        };
    });

    readonly castMembers = computed<TmdbEnrichedCastMember[]>(() => {
        const info = this.info();
        return info?.tmdb_cast?.length
            ? info.tmdb_cast
            : castMembersFromNames(
                  splitPeopleNames(info?.actors || info?.cast)
              );
    });

    readonly directorMembers = computed<TmdbEnrichedCastMember[]>(() => {
        const info = this.info();
        return info?.tmdb_directors?.length
            ? info.tmdb_directors
            : castMembersFromNames(splitPeopleNames(info?.director));
    });

    readonly castNames = computed(() =>
        this.castMembers().map((member) => member.name)
    );

    readonly directorNames = computed(() =>
        this.directorMembers().map((member) => member.name)
    );

    readonly similarRailItems = computed<SimilarRailItem[]>(() => {
        const bindings = this.bindings();
        const local = (bindings?.similarItems() ?? []).map((item) => ({
            key: `c${item.id}`,
            title: item.title,
            posterUrl: item.posterUrl,
            year: item.year,
        }));
        const crossPortal = (bindings?.similarInPortals() ?? []).map(
            (item) => ({
                key: `x${item.match.playlistId}-${item.match.xtreamId}`,
                title: item.title,
                posterUrl: item.posterUrl,
                year: item.year,
                tooltip: `${item.title} — ${item.match.playlistName}`,
            })
        );
        return [...local, ...crossPortal];
    });

    private label(label: RemainingTimeLabel | null): string | null {
        return label ? this.translate.instant(label.key, label.params) : null;
    }
}
