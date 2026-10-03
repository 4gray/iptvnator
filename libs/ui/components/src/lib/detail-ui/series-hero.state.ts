import { computed, type Signal } from '@angular/core';
import type { TranslateService } from '@ngx-translate/core';
import {
    formatRemainingLabel,
    shortCountryList,
    shortCountryName,
    splitSeasonSuffix,
    type SeriesQuickStartActionKind,
} from '@iptvnator/portal/shared/util';
import {
    seriesStatusLabelKey,
    type PlaybackPositionData,
    type TmdbCountryFacet,
    type TmdbEnrichedCastMember,
    type TmdbGenreFacet,
    type TmdbSeriesStatus,
} from '@iptvnator/shared/interfaces';
import { castMembersFromNames, splitPeopleNames } from './cast-crew.util';
import type { VodMoreMenuSection } from './vod-more-menu.model';

/** The next episode to play, as the quick-start helpers describe it. */
export interface SeriesHeroQuickStart {
    readonly labelKey: string;
    readonly labelParams?: Record<string, number>;
    readonly episodeLabel: string | null;
    readonly icon: string;
    readonly disabled: boolean;
    readonly kind: SeriesQuickStartActionKind | null;
    readonly position: PlaybackPositionData | null;
    /** "S02E03" of the episode the button acts on. */
    readonly episodeCode: string | null;
}

export interface SeriesHeroFacetChip<F> {
    readonly label: string;
    readonly facet: F | null;
}

export interface SeriesHeroPrimaryAction {
    readonly label: string;
    readonly meta: string | null;
    readonly icon: string;
    readonly disabled: boolean;
}

export interface SeriesHeroStateDeps {
    readonly title: Signal<string | undefined>;
    readonly sourceLabel: Signal<string | null | undefined>;
    readonly status: Signal<TmdbSeriesStatus | undefined | null>;
    readonly year: Signal<string | null | undefined>;
    readonly tmdbGenres: Signal<readonly TmdbGenreFacet[] | undefined>;
    readonly genre: Signal<string | undefined>;
    readonly tmdbCountries: Signal<readonly TmdbCountryFacet[] | undefined>;
    readonly country?: Signal<string | undefined>;
    readonly tmdbCast: Signal<readonly TmdbEnrichedCastMember[] | undefined>;
    readonly cast: Signal<string | undefined>;
    readonly tmdbDirectors: Signal<
        readonly TmdbEnrichedCastMember[] | undefined
    >;
    readonly director: Signal<string | undefined>;
    readonly quickStart: Signal<SeriesHeroQuickStart | null>;
    readonly translate: Pick<TranslateService, 'instant'>;
}

/**
 * Everything the series hero shows: the title without its season suffix,
 * the chips (season, status, year, genres, countries), the credits and the
 * primary button's two lines ("Continue" / "S02E03 · 18m left").
 */
export function createSeriesHeroState(deps: SeriesHeroStateDeps) {
    const translate = (key: string, params?: Record<string, unknown>) =>
        deps.translate.instant(key, params);
    const titleParts = computed(() => splitSeasonSuffix(deps.title()));
    const castMembers = computed<TmdbEnrichedCastMember[]>(() =>
        deps.tmdbCast()?.length
            ? [...(deps.tmdbCast() ?? [])]
            : castMembersFromNames(splitPeopleNames(deps.cast()))
    );
    const directorMembers = computed<TmdbEnrichedCastMember[]>(() =>
        deps.tmdbDirectors()?.length
            ? [...(deps.tmdbDirectors() ?? [])]
            : castMembersFromNames(splitPeopleNames(deps.director()))
    );

    return {
        kindLabel: computed(() => {
            const kind = translate('WORKSPACE.DASHBOARD.TYPE_SERIES');
            const source = deps.sourceLabel()?.trim();
            return source ? `${kind} · ${source}` : kind;
        }),
        title: computed(() => titleParts().title),
        seasonChip: computed(() => titleParts().season),
        year: computed(() => deps.year() ?? null),
        statusLabel: computed(() => {
            const status = deps.status();
            return status ? translate(seriesStatusLabelKey(status)) : null;
        }),
        genreChips: computed<SeriesHeroFacetChip<TmdbGenreFacet>[]>(() => {
            const facets = deps.tmdbGenres();
            if (facets?.length) {
                return facets.map((facet) => ({ label: facet.name, facet }));
            }
            return (deps.genre() ?? '')
                .split(/[,/|]/)
                .map((genre) => genre.trim())
                .filter((genre) => genre.length > 0)
                .map((label) => ({ label, facet: null }));
        }),
        countryChips: computed<SeriesHeroFacetChip<TmdbCountryFacet>[]>(() => {
            const facets = deps.tmdbCountries();
            if (facets?.length) {
                return facets.map((facet) => ({
                    label: shortCountryName(facet.name, facet.code),
                    facet,
                }));
            }
            return shortCountryList(deps.country?.()).map((label) => ({
                label,
                facet: null,
            }));
        }),
        castMembers,
        directorMembers,
        castNames: computed(() => castMembers().map((member) => member.name)),
        directorNames: computed(() =>
            directorMembers().map((member) => member.name)
        ),
        primaryAction: computed<SeriesHeroPrimaryAction | null>(() => {
            const quickStart = deps.quickStart();
            if (!quickStart) {
                return null;
            }
            if (quickStart.kind === 'completed') {
                return {
                    label: translate(
                        quickStart.labelKey,
                        quickStart.labelParams
                    ),
                    meta: quickStart.episodeLabel,
                    icon: quickStart.icon,
                    disabled: true,
                };
            }
            if (quickStart.kind === 'resume') {
                const remaining = formatRemainingLabel(quickStart.position);
                const parts = [
                    quickStart.episodeCode,
                    remaining
                        ? translate(remaining.key, remaining.params)
                        : null,
                ].filter((part): part is string => !!part);
                return {
                    label: translate('WORKSPACE.DASHBOARD.HERO_CONTINUE'),
                    meta: parts.length
                        ? parts.join(' · ')
                        : quickStart.episodeLabel,
                    icon: quickStart.icon,
                    disabled: quickStart.disabled,
                };
            }
            return {
                label: translate('XTREAM.PLAY'),
                meta: quickStart.episodeLabel,
                icon: quickStart.icon,
                disabled: quickStart.disabled,
            };
        }),
    };
}

export const SERIES_MENU_ACTION = {
    SeasonWatched: 'season-watched',
    SeriesWatched: 'series-watched',
    ResetProgress: 'reset-progress',
    Sources: 'sources',
    ExternalPlayer: 'external-player',
    CopyUrl: 'copy-url',
    DownloadSeason: 'download-season',
    ShowInCategory: 'show-in-category',
    HideFromContinueWatching: 'hide-continue-watching',
} as const;

export interface SeriesMenuInput {
    readonly seasonWatchVisible: boolean;
    readonly seasonFullyWatched: boolean;
    readonly seasonEligibleCount: number;
    readonly seasonActionDisabled: boolean;
    readonly seriesMenuVisible: boolean;
    readonly seriesFullyWatched: boolean;
    readonly seriesEligibleCount: number;
    readonly seriesCountKnown: boolean;
    readonly seriesActionDisabled: boolean;
    readonly hasProgress: boolean;
    /** An episode plays or launches: its next position tick would undo a reset. */
    readonly playbackActive: boolean;
    /** A start has not settled: another launch would double it. */
    readonly startPending: boolean;
    /** A season/series watched batch still persists: a reset request is refused meanwhile. */
    readonly watchBatchRunning: boolean;
    readonly sourcesCount: number;
    readonly externalPlayerHint: 'MPV' | 'VLC' | null;
    readonly copyUrlEpisodeCode: string | null;
    readonly downloadVisible: boolean;
    readonly downloadCount: number;
    readonly downloadDisabled: boolean;
    readonly downloadBusy: boolean;
    readonly categoryName: string | null;
    readonly inContinueWatching: boolean;
}

/** Rows of the series "…" menu. Rows a provider cannot serve are left out. */
export function buildSeriesMenuSections(
    input: SeriesMenuInput
): VodMoreMenuSection[] {
    const watching: VodMoreMenuSection['items'][number][] = [];
    if (input.seasonWatchVisible) {
        watching.push({
            id: SERIES_MENU_ACTION.SeasonWatched,
            labelKey: input.seasonFullyWatched
                ? 'XTREAM.MARK_SEASON_UNWATCHED'
                : 'XTREAM.MARK_SEASON_WATCHED',
            labelParams: { count: input.seasonEligibleCount },
            icon: input.seasonFullyWatched ? 'remove_done' : 'done_all',
            disabled: input.seasonActionDisabled,
            testId: 'toggle-season-watched',
        });
    }
    if (input.seriesMenuVisible) {
        watching.push({
            id: SERIES_MENU_ACTION.SeriesWatched,
            labelKey: input.seriesFullyWatched
                ? 'XTREAM.MARK_SERIES_UNWATCHED'
                : input.seriesCountKnown
                  ? 'XTREAM.MARK_SERIES_WATCHED'
                  : 'XTREAM.MARK_SERIES_WATCHED_ALL',
            labelParams: { count: input.seriesEligibleCount },
            icon: input.seriesFullyWatched ? 'remove_done' : 'done_all',
            disabled: input.seriesActionDisabled,
            testId: 'toggle-series-watched',
        });
    }
    if (input.hasProgress && !input.seriesFullyWatched) {
        watching.push({
            id: SERIES_MENU_ACTION.ResetProgress,
            labelKey: 'PORTALS.DETAIL.RESET_PROGRESS',
            icon: 'history_toggle_off',
            disabled: input.playbackActive || input.watchBatchRunning,
            testId: 'vod-menu-reset-progress',
        });
    }
    const source: VodMoreMenuSection['items'][number][] = [];
    if (input.sourcesCount > 1) {
        source.push({
            id: SERIES_MENU_ACTION.Sources,
            labelKey: 'PORTALS.DETAIL.OTHER_SOURCES',
            icon: 'video_library',
            hint: input.sourcesCount,
            kind: 'sources',
            testId: 'vod-menu-sources',
        });
    }
    if (input.externalPlayerHint) {
        source.push({
            id: SERIES_MENU_ACTION.ExternalPlayer,
            labelKey: 'PORTALS.DETAIL.OPEN_IN_EXTERNAL_PLAYER',
            icon: 'open_in_new',
            hint: input.externalPlayerHint,
            disabled: input.startPending,
            testId: 'vod-menu-external',
        });
    }
    if (input.copyUrlEpisodeCode) {
        source.push({
            id: SERIES_MENU_ACTION.CopyUrl,
            labelKey: 'PORTALS.COPY_STREAM_URL',
            icon: 'link',
            hint: input.copyUrlEpisodeCode,
            testId: 'vod-menu-copy-url',
        });
    }
    const download: VodMoreMenuSection['items'][number][] = [];
    if (input.downloadVisible) {
        download.push({
            id: SERIES_MENU_ACTION.DownloadSeason,
            labelKey: input.downloadBusy
                ? 'DOWNLOADS.ADDING_TO_QUEUE'
                : 'DOWNLOADS.DOWNLOAD_SEASON',
            labelParams: { count: input.downloadCount },
            icon: 'download',
            disabled: input.downloadDisabled,
            testId: 'download-season',
        });
    }
    const place: VodMoreMenuSection['items'][number][] = [];
    if (input.categoryName) {
        place.push({
            id: SERIES_MENU_ACTION.ShowInCategory,
            labelKey: 'PORTALS.DETAIL.SHOW_IN_CATEGORY',
            icon: 'folder_open',
            hint: input.categoryName,
            testId: 'vod-menu-show-in-category',
        });
    }
    if (input.inContinueWatching) {
        place.push({
            id: SERIES_MENU_ACTION.HideFromContinueWatching,
            labelKey: 'PORTALS.DETAIL.HIDE_FROM_CONTINUE_WATCHING',
            icon: 'visibility_off',
            testId: 'vod-menu-hide-continue',
        });
    }
    return [
        { labelKey: 'PORTALS.DETAIL.GROUP_WATCHING', items: watching },
        { labelKey: 'PORTALS.DETAIL.GROUP_SOURCE', items: source },
        { items: download },
        { items: place },
    ];
}
