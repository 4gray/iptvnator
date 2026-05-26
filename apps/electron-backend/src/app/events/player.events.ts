import { ipcMain } from 'electron';
import {
    CLOSE_EXTERNAL_PLAYER_SESSION,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import {
    MPV_PLAYER_PATH,
    store,
    VLC_PLAYER_PATH,
} from '../services/store.service';
import { normalizePlayerPathForStore } from './external-player-launch-context';
import {
    externalPlayerSessions,
    traceExternalPlayer,
} from './external-player-runtime';
import { openMpvPlayer, setMpvReuseInstance } from './mpv-session.service';
import { openVlcPlayer, setVlcReuseInstance } from './vlc-session.service';

export {
    buildExternalPlayerSpawnSpec,
    buildPlayerArgsWithCustomArguments,
    isRunningInFlatpak,
    parseExternalPlayerArguments,
    resolveExternalPlayerLaunchContext,
    shouldReuseMpvInstance,
    shouldReuseVlcInstance,
    shouldUseMpvSocketBridge,
} from './external-player-launch-context';
export {
    buildVlcEnqueueCommands,
    parseVlcRcNumericResponse,
    parseVlcRcPlaybackState,
} from './vlc-session.service';

export default class PlayerEvents {
    static bootstrapPlayerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(
    'OPEN_MPV_PLAYER',
    async (
        _event,
        url: string,
        title: string,
        thumbnail?: string,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: PlayerContentInfo,
        startTime?: number,
        headers?: Record<string, string>
    ) =>
        openMpvPlayer({
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers,
        })
);

ipcMain.handle(
    'SET_MPV_PLAYER_PATH',
    (_event, mpvPlayerPath: string | null | undefined) => {
        const normalizedPlayerPath = normalizePlayerPathForStore(mpvPlayerPath);
        traceExternalPlayer('set mpv player path', {
            playerPath: normalizedPlayerPath,
        });
        store.set(MPV_PLAYER_PATH, normalizedPlayerPath);
    }
);

ipcMain.handle('SET_MPV_REUSE_INSTANCE', (_event, reuseInstance: boolean) => {
    setMpvReuseInstance(reuseInstance);
});

ipcMain.handle(
    'OPEN_VLC_PLAYER',
    async (
        _event,
        url: string,
        title: string,
        thumbnail?: string,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: PlayerContentInfo,
        startTime?: number,
        headers?: Record<string, string>
    ) =>
        openVlcPlayer({
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers,
        })
);

ipcMain.handle(
    'SET_VLC_PLAYER_PATH',
    (_event, vlcPlayerPath: string | null | undefined) => {
        const normalizedPlayerPath = normalizePlayerPathForStore(vlcPlayerPath);
        traceExternalPlayer('set vlc player path', {
            playerPath: normalizedPlayerPath,
        });
        store.set(VLC_PLAYER_PATH, normalizedPlayerPath);
    }
);

ipcMain.handle('SET_VLC_REUSE_INSTANCE', (_event, reuseInstance: boolean) => {
    setVlcReuseInstance(reuseInstance);
});

ipcMain.handle(
    CLOSE_EXTERNAL_PLAYER_SESSION,
    async (_event, sessionId: string) => {
        return externalPlayerSessions.closeSession(sessionId);
    }
);
