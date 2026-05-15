import { ipcMain } from 'electron';
import {
    EMBEDDED_MPV_CREATE_SESSION,
    EMBEDDED_MPV_DISPOSE_SESSION,
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

export default class EmbeddedMpvEvents {
    static bootstrapEmbeddedMpvEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function getService(): EmbeddedMpvNativeService {
    return embeddedMpvNativeService;
}

ipcMain.handle(EMBEDDED_MPV_SUPPORT, () => getService().getSupport());

ipcMain.handle(EMBEDDED_MPV_PREPARE, () => getService().prepareAddon());

ipcMain.handle(
    EMBEDDED_MPV_CREATE_SESSION,
    (
        _event,
        bounds: EmbeddedMpvBounds,
        title?: string,
        initialVolume?: number
    ) => getService().createSession(bounds, title, initialVolume)
);

ipcMain.handle(
    EMBEDDED_MPV_LOAD_PLAYBACK,
    (_event, sessionId: string, playback: ResolvedPortalPlayback) =>
        getService().loadPlayback(sessionId, playback)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_BOUNDS,
    (_event, sessionId: string, bounds: EmbeddedMpvBounds) =>
        getService().setBounds(sessionId, bounds)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_PAUSED,
    (_event, sessionId: string, paused: boolean) =>
        getService().setPaused(sessionId, paused)
);

ipcMain.handle(
    EMBEDDED_MPV_SEEK,
    (_event, sessionId: string, seconds: number) =>
        getService().seek(sessionId, seconds)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_VOLUME,
    (_event, sessionId: string, volume: number) =>
        getService().setVolume(sessionId, volume)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_AUDIO_TRACK,
    (_event, sessionId: string, trackId: number) =>
        getService().setAudioTrack(sessionId, trackId)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_SUBTITLE_TRACK,
    (_event, sessionId: string, trackId: number) =>
        getService().setSubtitleTrack(sessionId, trackId)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_SPEED,
    (_event, sessionId: string, speed: number) =>
        getService().setSpeed(sessionId, speed)
);

ipcMain.handle(
    EMBEDDED_MPV_SET_ASPECT,
    (_event, sessionId: string, aspect: string) =>
        getService().setAspect(sessionId, aspect)
);

ipcMain.handle(
    EMBEDDED_MPV_START_RECORDING,
    (_event, sessionId: string, options: EmbeddedMpvRecordingStartOptions) =>
        getService().startRecording(sessionId, options)
);

ipcMain.handle(EMBEDDED_MPV_STOP_RECORDING, (_event, sessionId: string) =>
    getService().stopRecording(sessionId)
);

ipcMain.handle(EMBEDDED_MPV_GET_DEFAULT_RECORDING_FOLDER, () =>
    getService().getDefaultRecordingFolder()
);

ipcMain.handle(EMBEDDED_MPV_SELECT_RECORDING_FOLDER, () =>
    getService().selectRecordingFolder()
);

ipcMain.handle(EMBEDDED_MPV_DISPOSE_SESSION, (_event, sessionId: string) =>
    getService().disposeSession(sessionId)
);

export function shutdownEmbeddedMpv(): void {
    getService().shutdown();
}
