import type { EmbeddedMpvSession } from '@iptvnator/shared/interfaces';
import {
    hasStreamStatsData,
    type PlayerStreamStats,
} from '../player-controls/player-stream-stats.model';

/**
 * Projects an mpv session snapshot onto the shared stream-stats shape.
 *
 * The numbers arrive already sampled by the main process (mpv pushes observed
 * properties), so this is a pure mapping — no polling of its own. Returns null
 * when the engine reported nothing usable, which is what keeps the info button
 * hidden on engines that do not observe these properties.
 */
export function toPlayerStreamStats(
    session: EmbeddedMpvSession | null | undefined
): PlayerStreamStats | null {
    if (!session) {
        return null;
    }

    const stats = session.stats;
    // Every field is listed explicitly (no spread of a neutral default): a new
    // stat then fails to compile here until mpv's source for it is decided,
    // instead of silently reporting null forever.
    const mapped: PlayerStreamStats = {
        width: positiveOrNull(session.videoWidth),
        height: positiveOrNull(session.videoHeight),
        fps: finiteOrNull(stats?.fps),
        nominalFps: null,
        streamBitrateBps: null,
        videoBitrateBps: finiteOrNull(stats?.videoBitrateBps),
        audioBitrateBps: finiteOrNull(stats?.audioBitrateBps),
        videoCodec: nonEmptyOrNull(stats?.videoCodec),
        audioCodec: nonEmptyOrNull(stats?.audioCodec),
        audioChannels: nonEmptyOrNull(stats?.audioChannels),
        audioSampleRateHz: finiteOrNull(stats?.audioSampleRateHz),
        container: nonEmptyOrNull(stats?.container),
        bufferedAheadSeconds: finiteOrNull(stats?.bufferedAheadSeconds),
        droppedFrames: finiteOrNull(stats?.droppedFrames),
        // mpv counts drops, not presented frames, so a drop rate cannot be
        // derived here the way it can from a <video> element.
        totalFrames: null,
    };

    return hasStreamStatsData(mapped) ? mapped : null;
}

function finiteOrNull(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonEmptyOrNull(value: string | undefined): string | null {
    return value?.trim() ? value.trim() : null;
}

function positiveOrNull(value: number | undefined): number | null {
    const finite = finiteOrNull(value);
    return finite !== null && finite > 0 ? finite : null;
}
