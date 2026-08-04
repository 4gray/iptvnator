import { createPlaybackSessionKey } from '@iptvnator/playback/util';
import {
    normalizeStalkerEntityId,
    type StalkerMappedEpisode,
} from '@iptvnator/portal/stalker/data-access';
import type { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import type { SeriesPlaybackEpisodeState } from '@iptvnator/ui/playback';
import {
    STALKER_SERIES_DOWNLOAD_MODES,
    type StalkerSeriesDownloadMode,
} from './stalker-series-download.adapter';

export interface StalkerEpisodePlaybackSessionKeyOptions {
    readonly sourceId: string | null | undefined;
    readonly parentSeriesId: unknown;
    readonly seriesMode: StalkerSeriesDownloadMode;
    readonly episodeState: SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null;
}

export interface StalkerEpisodePlaybackSessionIdentity {
    readonly sourceId: string;
    readonly parentSeriesId: string;
    readonly seriesMode: StalkerSeriesDownloadMode;
    readonly originalEpisodeIdentity: string | number;
    readonly seasonKey: string;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
    readonly episodeTrackingId: string | number;
    readonly sessionKey: string;
}

interface StalkerEpisodeStateLookupOptions {
    readonly episodesBySeason: Record<string, readonly XtreamSerieEpisode[]>;
}

function present(value: unknown): value is string | number {
    return (
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && Number.isFinite(value))
    );
}

export function captureStalkerEpisodePlaybackSessionIdentity({
    sourceId,
    parentSeriesId,
    seriesMode,
    episodeState,
}: StalkerEpisodePlaybackSessionKeyOptions): StalkerEpisodePlaybackSessionIdentity | null {
    const normalizedSourceId = sourceId?.trim() ?? '';
    const seriesId = normalizeStalkerEntityId(parentSeriesId);
    if (!normalizedSourceId || !seriesId || !episodeState) return null;

    const { episodeNumber, seasonKey, seasonNumber } = episodeState;
    const episode = episodeState.episode as StalkerMappedEpisode;
    const originalIdentity =
        seriesMode === STALKER_SERIES_DOWNLOAD_MODES.LazyVod
            ? episode.originalId
            : episode.originalCmd;
    if (
        !present(originalIdentity) ||
        !seasonKey.trim() ||
        !Number.isSafeInteger(seasonNumber) ||
        seasonNumber < 0 ||
        !Number.isSafeInteger(episodeNumber) ||
        episodeNumber < 1
    ) {
        return null;
    }

    // Provider commands and IDs remain transient request guards below. They
    // may contain credentials and must never enter recovery ownership state.
    const structuralContentId = JSON.stringify([
        seriesMode,
        seriesId,
        seasonKey,
        seasonNumber,
        episodeNumber,
    ]);
    const sessionKey = createPlaybackSessionKey({
        kind: 'episode',
        sourceId: normalizedSourceId,
        contentId: structuralContentId,
        seriesId,
        seasonNumber,
        episodeNumber,
    });
    return Object.freeze({
        sourceId: normalizedSourceId,
        parentSeriesId: seriesId,
        seriesMode,
        originalEpisodeIdentity: originalIdentity,
        seasonKey,
        seasonNumber,
        episodeNumber,
        episodeTrackingId: episodeState.episode.id,
        sessionKey,
    });
}

export function createStalkerEpisodePlaybackSessionKey(
    options: StalkerEpisodePlaybackSessionKeyOptions
): string {
    return (
        captureStalkerEpisodePlaybackSessionIdentity(options)?.sessionKey ?? ''
    );
}

export function resolveSelectedStalkerEpisodeState({
    episodesBySeason,
    episode,
}: StalkerEpisodeStateLookupOptions & {
    readonly episode: XtreamSerieEpisode;
}): SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null {
    const exactState = findStalkerEpisodeState(
        episodesBySeason,
        (candidate) => candidate === episode
    );
    if (exactState) return exactState;

    const selected = episode as StalkerMappedEpisode;
    const originalIdentity = selected.originalId ?? selected.originalCmd;
    const selectedSeasonNumber = Number(episode.season) || 0;
    if (!present(originalIdentity)) return null;

    return findStalkerEpisodeState(episodesBySeason, (candidate, state) => {
        const mapped = candidate as StalkerMappedEpisode;
        return (
            (mapped.originalId ?? mapped.originalCmd) === originalIdentity &&
            (!selectedSeasonNumber ||
                state.seasonNumber === selectedSeasonNumber) &&
            state.episodeNumber === Number(episode.episode_num)
        );
    });
}

export function resolveStalkerEpisodeStateByIdentity({
    episodesBySeason,
    identity,
}: StalkerEpisodeStateLookupOptions & {
    readonly identity: StalkerEpisodePlaybackSessionIdentity;
}): SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null {
    return findStalkerEpisodeState(
        { [identity.seasonKey]: episodesBySeason[identity.seasonKey] ?? [] },
        (candidate, state) => {
            const mapped = candidate as StalkerMappedEpisode;
            const originalIdentity =
                identity.seriesMode === STALKER_SERIES_DOWNLOAD_MODES.LazyVod
                    ? mapped.originalId
                    : mapped.originalCmd;
            return (
                originalIdentity === identity.originalEpisodeIdentity &&
                state.seasonNumber === identity.seasonNumber &&
                state.episodeNumber === identity.episodeNumber
            );
        }
    );
}

function findStalkerEpisodeState(
    episodesBySeason: Record<string, readonly XtreamSerieEpisode[]>,
    matches: (
        episode: XtreamSerieEpisode,
        state: SeriesPlaybackEpisodeState<XtreamSerieEpisode>
    ) => boolean
): SeriesPlaybackEpisodeState<XtreamSerieEpisode> | null {
    for (const [seasonKey, episodes] of Object.entries(episodesBySeason)) {
        for (
            let episodeIndex = 0;
            episodeIndex < episodes.length;
            episodeIndex++
        ) {
            const episode = episodes[episodeIndex];
            const state = {
                seasonKey,
                seasonNumber: Number(episode.season) || Number(seasonKey) || 0,
                episodeNumber: Number(episode.episode_num) || episodeIndex + 1,
                episode,
                previous: episodes[episodeIndex - 1] ?? null,
                next: episodes[episodeIndex + 1] ?? null,
            };
            if (matches(episode, state)) return state;
        }
    }
    return null;
}
