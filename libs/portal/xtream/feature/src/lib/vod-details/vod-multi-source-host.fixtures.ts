/**
 * Shared fixtures for the multi-source host specs, extracted so the
 * race-condition suite can live in its own file rather than duplicating setup.
 */
import type {
    ResolvedPortalPlayback,
    VodSourceCandidate,
    VodSourceField,
} from '@iptvnator/shared/interfaces';
import type { VodMultiSourceMovie } from './vod-multi-source-identity';

export const MOVIE_A: VodMultiSourceMovie = {
    playlistId: 'playlist-1',
    playlistName: 'Playlist One',
    contentId: 101,
    title: 'The Matrix',
    year: 1999,
};
export const MOVIE_B: VodMultiSourceMovie = {
    ...MOVIE_A,
    contentId: 202,
    title: 'Blade Runner',
    year: 1982,
}; // a second movie, to prove load() fully resets the session
export const CURRENT_A_ID = 'playlist-1:xtream:101';

export const API_AC3: VodSourceField = { value: 'ac3', provenance: 'api' };
export const API_AAC: VodSourceField = { value: 'aac', provenance: 'api' };
export const PARSED_DUB: VodSourceField = {
    value: 'Дубляж',
    provenance: 'parsed',
};
export const PROBE_OK = { status: 'ok', httpStatus: 200, latencyMs: 42 };

export type DiscoveryResult = {
    sources: VodSourceCandidate[];
    matchKind: string;
};
export type AudioPicker = (c: VodSourceCandidate) => VodSourceField | undefined;

export function alternative(index: number): VodSourceCandidate {
    return {
        id: `playlist-${index}:xtream:${900 + index}`,
        playlistId: `playlist-${index}`,
        playlistName: `Playlist ${index}`,
        portalType: 'xtream',
        contentId: 900 + index,
        rawTitle: 'The Matrix',
        matchConfidence: 'exact',
        year: 1999,
    };
}

export const [ALT_TWO, ALT_THREE] = [alternative(2), alternative(3)];

export function resolvedFor(
    candidate: VodSourceCandidate,
    startTime: number | undefined,
    audio?: VodSourceField
) {
    const playback: ResolvedPortalPlayback = {
        streamUrl: `http://${candidate.playlistId}/${candidate.contentId}.mkv`,
        title: candidate.rawTitle,
        isLive: false,
        startTime,
    };
    return { playback, candidate: { ...candidate, audio } };
}

/** Stands in for the resolver: echoes the start time, injects audio facts. */
export function resolveWith(audioFor?: AudioPicker) {
    return async (
        candidate: VodSourceCandidate,
        options?: { startTime?: number }
    ) => resolvedFor(candidate, options?.startTime, audioFor?.(candidate));
}

export function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}
