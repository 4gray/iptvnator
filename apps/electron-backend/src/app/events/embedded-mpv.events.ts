import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_CREATE_SESSION,
    EMBEDDED_MPV_DISPOSE_SESSION,
    EMBEDDED_MPV_GET_FRAME_SOURCE,
    EMBEDDED_MPV_LOAD_PLAYBACK,
    EMBEDDED_MPV_PREPARE,
    EMBEDDED_MPV_SEEK,
    EMBEDDED_MPV_SET_ASPECT,
    EMBEDDED_MPV_SET_AUDIO_TRACK,
    EMBEDDED_MPV_SET_BOUNDS,
    EMBEDDED_MPV_SET_PAUSED,
    EMBEDDED_MPV_SET_SPEED,
    EMBEDDED_MPV_SET_SUBTITLE_TRACK,
    EMBEDDED_MPV_SET_VOLUME,
    EMBEDDED_MPV_GET_DEFAULT_RECORDING_FOLDER,
    EMBEDDED_MPV_SELECT_RECORDING_FOLDER,
    EMBEDDED_MPV_START_RECORDING,
    EMBEDDED_MPV_STOP_RECORDING,
    EMBEDDED_MPV_SUPPORT,
    EmbeddedMpvBounds,
    EmbeddedMpvRecordingStartOptions,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    EmbeddedMpvNativeService,
    embeddedMpvNativeService,
} from '../services/embedded-mpv-native.service';
import { stalkerPlaybackContextService } from '../services/stalker-playback-context.service';
import { resolveEffectiveExternalPlaybackRequest } from './external-player-playback-request';

export default class EmbeddedMpvEvents {
    static bootstrapEmbeddedMpvEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function getService(): EmbeddedMpvNativeService {
    return embeddedMpvNativeService;
}

/**
 * Registers an embedded-MPV IPC handler that logs failures in the main
 * process before rethrowing them to the renderer. The renderer swallows
 * these rejections (the next session snapshot resyncs its state), so
 * without main-side logging addon errors would be invisible.
 */
function handleEmbeddedMpv<Args extends unknown[]>(
    channel: string,
    handler: (...args: Args) => unknown
): void {
    handleEmbeddedMpvEvent(channel, (_event, ...args: Args) =>
        handler(...args)
    );
}

function handleEmbeddedMpvEvent<Args extends unknown[]>(
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => unknown
): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        try {
            return await handler(event, ...(args as Args));
        } catch (error) {
            console.error(`[Embedded MPV] ${channel} handler failed:`, error);
            throw error;
        }
    });
}

handleEmbeddedMpv(EMBEDDED_MPV_SUPPORT, () => getService().getSupport());

handleEmbeddedMpv(EMBEDDED_MPV_PREPARE, () => getService().prepareAddon());

handleEmbeddedMpv(
    EMBEDDED_MPV_CREATE_SESSION,
    (bounds: EmbeddedMpvBounds, title?: string, initialVolume?: number) =>
        getService().createSession(bounds, title, initialVolume)
);

handleEmbeddedMpvEvent(
    EMBEDDED_MPV_LOAD_PLAYBACK,
    (event, sessionId: string, playback: ResolvedPortalPlayback) => {
        if (playback.playbackContextRef === undefined) {
            return getService().loadPlayback(sessionId, playback);
        }

        const mainOwnedHeaders = stalkerPlaybackContextService.consume({
            contextRef: playback.playbackContextRef,
            senderId: event.sender.id,
            streamUrl: playback.streamUrl,
        });
        if (!mainOwnedHeaders) {
            throw new Error('invalid-playback-context');
        }

        const {
            playbackContextRef: _playbackContextRef,
            headers: _headers,
            userAgent: _userAgent,
            referer: _referer,
            origin: _origin,
            ...safePlayback
        } = playback;
        const {
            effectiveOrigin,
            effectiveReferer,
            effectiveUserAgent,
            mergedHeaders,
        } = resolveEffectiveExternalPlaybackRequest({
            url: playback.streamUrl,
            mainOwnedHeaders,
        });
        const managedPlayback: ResolvedPortalPlayback = {
            ...safePlayback,
            headers: mergedHeaders,
            ...(effectiveOrigin ? { origin: effectiveOrigin } : {}),
            ...(effectiveReferer ? { referer: effectiveReferer } : {}),
            ...(effectiveUserAgent ? { userAgent: effectiveUserAgent } : {}),
        };

        return getService().loadPlayback(sessionId, managedPlayback);
    }
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_BOUNDS,
    (sessionId: string, bounds: EmbeddedMpvBounds) =>
        getService().setBounds(sessionId, bounds)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_PAUSED,
    (sessionId: string, paused: boolean) =>
        getService().setPaused(sessionId, paused)
);

handleEmbeddedMpv(EMBEDDED_MPV_SEEK, (sessionId: string, seconds: number) =>
    getService().seek(sessionId, seconds)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_VOLUME,
    (sessionId: string, volume: number) =>
        getService().setVolume(sessionId, volume)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_AUDIO_TRACK,
    (sessionId: string, trackId: number) =>
        getService().setAudioTrack(sessionId, trackId)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_SUBTITLE_TRACK,
    (sessionId: string, trackId: number) =>
        getService().setSubtitleTrack(sessionId, trackId)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_SPEED,
    (sessionId: string, speed: number) => getService().setSpeed(sessionId, speed)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_SET_ASPECT,
    (sessionId: string, aspect: string) =>
        getService().setAspect(sessionId, aspect)
);

handleEmbeddedMpv(
    EMBEDDED_MPV_START_RECORDING,
    (sessionId: string, options: EmbeddedMpvRecordingStartOptions) =>
        getService().startRecording(sessionId, options)
);

handleEmbeddedMpv(EMBEDDED_MPV_STOP_RECORDING, (sessionId: string) =>
    getService().stopRecording(sessionId)
);

handleEmbeddedMpv(EMBEDDED_MPV_GET_DEFAULT_RECORDING_FOLDER, () =>
    getService().getDefaultRecordingFolder()
);

handleEmbeddedMpv(EMBEDDED_MPV_SELECT_RECORDING_FOLDER, () =>
    getService().selectRecordingFolder()
);

handleEmbeddedMpv(EMBEDDED_MPV_DISPOSE_SESSION, (sessionId: string) =>
    getService().disposeSession(sessionId)
);

handleEmbeddedMpv(EMBEDDED_MPV_GET_FRAME_SOURCE, (sessionId: string) =>
    getService().getFrameSource(sessionId)
);

export function shutdownEmbeddedMpv(): void {
    getService().shutdown();
}
