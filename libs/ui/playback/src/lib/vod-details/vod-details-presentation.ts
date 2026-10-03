import {
    formatDurationLabel,
    formatRemainingLabel,
    parseDurationSeconds,
    shortCountryList,
    shortCountryName,
    type RemainingTimeLabel,
} from '@iptvnator/portal/shared/util';
import type {
    NormalizedVodMeta,
    TmdbCountryFacet,
    TmdbEnrichedCastMember,
    TmdbGenreFacet,
} from '@iptvnator/shared/interfaces';
import type { CrossPortalSimilarItem } from '@iptvnator/services';
import {
    castMembersFromNames,
    splitPeopleNames,
    type DetailActionButtonState,
    type SimilarRailItem,
    type VodMoreMenuSection,
} from '@iptvnator/ui/components';

/** Pure view-model helpers of the shared VOD details page. */

export interface VodFacetChip<F> {
    readonly label: string;
    readonly facet: F | null;
}

export interface VodPrimaryAction {
    readonly label: string;
    readonly meta: string | null;
    readonly icon: string;
    readonly state: DetailActionButtonState;
}

export const VOD_DETAILS_MENU_ACTION = {
    ExternalPlayer: 'external-player',
    StartOver: 'start-over',
    ResetProgress: 'reset-progress',
} as const;

type Translate = (key: string, params?: Record<string, unknown>) => string;

export function buildGenreChips(
    meta: NormalizedVodMeta
): VodFacetChip<TmdbGenreFacet>[] {
    if (meta.tmdbGenres?.length) {
        return meta.tmdbGenres.map((facet) => ({ label: facet.name, facet }));
    }
    return (meta.genre ?? '')
        .split(/[,/|]/)
        .map((genre) => genre.trim())
        .filter((genre) => genre.length > 0)
        .map((label) => ({ label, facet: null }));
}

export function buildCountryChips(
    meta: NormalizedVodMeta
): VodFacetChip<TmdbCountryFacet>[] {
    if (meta.tmdbCountries?.length) {
        return meta.tmdbCountries.map((facet) => ({
            label: shortCountryName(facet.name, facet.code),
            facet,
        }));
    }
    return shortCountryList(meta.country).map((label) => ({
        label,
        facet: null,
    }));
}

export function buildCastMembers(
    meta: NormalizedVodMeta
): TmdbEnrichedCastMember[] {
    return meta.tmdbCast?.length
        ? meta.tmdbCast
        : castMembersFromNames(splitPeopleNames(meta.actors));
}

export function buildDirectorMembers(
    meta: NormalizedVodMeta
): TmdbEnrichedCastMember[] {
    return meta.tmdbDirectors?.length
        ? meta.tmdbDirectors
        : castMembersFromNames(splitPeopleNames(meta.director));
}

export function vodDurationSeconds(
    meta: NormalizedVodMeta,
    playbackDurationSeconds: number | null
): number {
    return playbackDurationSeconds || parseDurationSeconds(meta.duration);
}

export function buildSimilarRailItems(
    items: readonly CrossPortalSimilarItem[]
): SimilarRailItem[] {
    return items.map((item) => ({
        key: `x${item.match.playlistId}-${item.match.xtreamId}`,
        title: item.title,
        posterUrl: item.posterUrl,
        year: item.year,
        tooltip: `${item.title} — ${item.match.playlistName}`,
    }));
}

export function buildPrimaryAction(
    input: {
        externalLabel: string | null;
        externalIcon: string;
        externalState: DetailActionButtonState;
        isOfflinePrimary: boolean;
        hasPlaybackPosition: boolean;
        positionSeconds: number | null;
        durationSeconds: number;
        formattedPosition: string;
    },
    translate: Translate
): VodPrimaryAction {
    const state = input.externalState;
    const icon = input.isOfflinePrimary ? 'play_circle' : input.externalIcon;
    if (input.externalLabel) {
        return { label: input.externalLabel, meta: null, icon, state };
    }
    if (input.isOfflinePrimary) {
        return {
            label: translate('DOWNLOADS.PLAY_LOCAL'),
            meta: null,
            icon,
            state,
        };
    }
    if (input.hasPlaybackPosition) {
        const remaining = labelOf(
            formatRemainingLabel(
                input.durationSeconds > 0
                    ? {
                          positionSeconds: input.positionSeconds ?? 0,
                          durationSeconds: input.durationSeconds,
                      }
                    : null
            ),
            translate
        );
        return {
            label: translate('WORKSPACE.DASHBOARD.HERO_CONTINUE'),
            meta: remaining ?? input.formattedPosition ?? null,
            icon,
            state,
        };
    }
    return {
        label: translate('XTREAM.PLAY'),
        meta: labelOf(formatDurationLabel(input.durationSeconds), translate),
        icon,
        state,
    };
}

/** "12:34" or "1:23:45" for a resume point; empty without one. */
export function formatPlaybackClock(
    seconds: number | null | undefined
): string {
    const total = Math.floor(seconds ?? 0);
    if (total <= 0) {
        return '';
    }
    const minutes = Math.floor((total % 3600) / 60);
    const rest = `${minutes.toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
    const hours = Math.floor(total / 3600);
    return hours > 0 ? `${hours}:${rest}` : `${minutes}:${rest.slice(3)}`;
}

export function buildVodMenuSections(input: {
    externalPlayerAvailable: boolean;
    externalPlayerHint: 'MPV' | 'VLC';
    hasPlaybackPosition: boolean;
    hasStoredProgress: boolean;
    /** An external player owns the row: its next tick would undo a reset. */
    playbackActive: boolean;
    /** A start still resolving its stream: a second launch would double it. */
    startPending: boolean;
}): VodMoreMenuSection[] {
    const sourceRows: VodMoreMenuSection['items'][number][] = [];
    if (input.externalPlayerAvailable) {
        sourceRows.push({
            id: VOD_DETAILS_MENU_ACTION.ExternalPlayer,
            labelKey: 'PORTALS.DETAIL.OPEN_IN_EXTERNAL_PLAYER',
            icon: 'open_in_new',
            hint: input.externalPlayerHint,
            disabled: input.startPending,
            testId: 'vod-menu-external',
        });
    }
    const stateRows: VodMoreMenuSection['items'][number][] = [];
    if (input.hasPlaybackPosition) {
        stateRows.push({
            id: VOD_DETAILS_MENU_ACTION.StartOver,
            labelKey: 'XTREAM.RESTART',
            icon: 'replay',
            disabled: input.startPending,
            testId: 'vod-menu-start-over',
        });
    }
    if (input.hasStoredProgress) {
        stateRows.push({
            id: VOD_DETAILS_MENU_ACTION.ResetProgress,
            labelKey: 'PORTALS.DETAIL.RESET_PROGRESS',
            icon: 'history_toggle_off',
            disabled: input.playbackActive,
            testId: 'vod-menu-reset-progress',
        });
    }
    return [{ items: sourceRows }, { items: stateRows }];
}

export function labelOf(
    label: RemainingTimeLabel | null,
    translate: Translate
): string | null {
    return label ? translate(label.key, label.params) : null;
}
