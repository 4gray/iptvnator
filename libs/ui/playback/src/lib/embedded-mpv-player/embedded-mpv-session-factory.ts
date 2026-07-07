import {
    EmbeddedMpvSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { readStoredVolume } from '../player-controls';

/**
 * Pure snapshot factories for the placeholder {@link EmbeddedMpvSession} states
 * the controller renders before (or instead of) a real native session. Keeping
 * them side-effect free means the controller owns all signal mutations — the
 * error placeholder no longer clears `sessionId` itself; its caller does.
 */

function baseSession(
    overrides: Partial<EmbeddedMpvSession>
): EmbeddedMpvSession {
    const now = new Date().toISOString();
    return {
        id: 'embedded-mpv-placeholder',
        title: '',
        streamUrl: '',
        status: 'loading',
        positionSeconds: 0,
        durationSeconds: null,
        volume: 1,
        audioTracks: [],
        selectedAudioTrackId: null,
        subtitleTracks: [],
        selectedSubtitleTrackId: null,
        playbackSpeed: 1,
        aspectOverride: 'no',
        recording: { active: false },
        startedAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function createLoadingSession(
    playback: ResolvedPortalPlayback,
    volume: number
): EmbeddedMpvSession {
    return baseSession({
        id: 'embedded-mpv-starting',
        title: playback.title,
        streamUrl: playback.streamUrl,
        status: 'loading',
        volume,
    });
}

export function createAttachingSession(sessionId: string): EmbeddedMpvSession {
    return baseSession({
        id: sessionId,
        status: 'loading',
        // Seed from stored volume so the slider does not flash 100% before the
        // first broadcast snapshot reconciles the real value.
        volume: readStoredVolume(),
    });
}

export function createErrorSession(
    playback: ResolvedPortalPlayback,
    volume: number,
    error: unknown
): EmbeddedMpvSession {
    return baseSession({
        id: 'embedded-mpv-error',
        title: playback.title,
        streamUrl: playback.streamUrl,
        status: 'error',
        volume,
        error: error instanceof Error ? error.message : String(error),
    });
}

/**
 * Wait two animation frames so the loading placeholder paints before the
 * (potentially blocking) native session creation kicks off.
 */
export function waitForStartupPaint(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function') {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
        });
    });
}
