import { ProfileStateUnavailableError } from '@iptvnator/services/profiles';

const READ_EMPTY: Readonly<Record<string, unknown>> = {
    getPlaybackPosition: null,
    getSeriesPlaybackPositions: [],
    getAllPlaybackPositions: [],
    getRecentPlaybackPositions: [],
};

/** Reads are empty and writes refused: a profile's progress needs its own activity sync. */
export function personalPositionsUnavailable(method: string): unknown {
    if (method in READ_EMPTY) return READ_EMPTY[method];
    throw new ProfileStateUnavailableError();
}
