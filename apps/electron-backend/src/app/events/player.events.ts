import { ipcMain } from 'electron';
import {
    CLOSE_EXTERNAL_PLAYER_SESSION,
    type ExternalPlayerName,
    PLAYBACK_SET_KEEP_AWAKE,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { setPlaybackKeepAwake } from '../services/playback-keep-awake.service';
import { waitForLoginShellPath } from '../startup/login-shell-path';
import {
    MPV_PLAYER_PATH,
    store,
    VLC_PLAYER_PATH,
} from '../services/store.service';
import {
    normalizePlayerPathForStore,
    resolveExternalPlayerLaunchContext as resolveLaunchContext,
} from './external-player-launch-context';
import { externalPlayerAvailable } from './external-player-availability';
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

/**
 * A player resolved to a bare name (no configured path, no well-known
 * install found) is looked up through PATH, so it waits for the login shell
 * PATH; a path to an executable starts right away. So does a Flatpak host
 * launch: `flatpak-spawn --host` resolves the name with the host's PATH,
 * which the sandbox's login shell lookup cannot change.
 */
async function waitForPathIfBareName(
    player: ExternalPlayerName,
    configuredPath: string | undefined
): Promise<boolean> {
    const context = resolveLaunchContext(player, configuredPath);
    if (context.mode !== 'flatpak-host' && !/[\\/]/.test(context.playerPath)) {
        return (await waitForLoginShellPath()) !== false;
    }
    return true;
}

export default class PlayerEvents {
    static bootstrapPlayerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle(
    'GET_EXTERNAL_PLAYER_AVAILABILITY',
    async (_event, paths?: { mpv?: string; vlc?: string }) => {
        const mpv =
            typeof paths?.mpv === 'string'
                ? paths.mpv
                : store.get(MPV_PLAYER_PATH);
        const vlc =
            typeof paths?.vlc === 'string'
                ? paths.vlc
                : store.get(VLC_PLAYER_PATH);
        const [mpvAvailable, vlcAvailable] = await Promise.all([
            externalPlayerAvailable('mpv', mpv, {
                waitForSearchPath: waitForLoginShellPath,
            }),
            externalPlayerAvailable('vlc', vlc, {
                waitForSearchPath: waitForLoginShellPath,
            }),
        ]);
        return {
            mpv: mpvAvailable,
            vlc: vlcAvailable,
        };
    }
);

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
    ) => {
        await waitForPathIfBareName('mpv', store.get(MPV_PLAYER_PATH));
        return openMpvPlayer({
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers,
        });
    }
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
    ) => {
        await waitForPathIfBareName('vlc', store.get(VLC_PLAYER_PATH));
        return openVlcPlayer({
            url,
            title,
            thumbnail,
            userAgent,
            referer,
            origin,
            contentInfo,
            startTime,
            headers,
        });
    }
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

ipcMain.handle(PLAYBACK_SET_KEEP_AWAKE, (event, active: boolean) => {
    setPlaybackKeepAwake(event.sender, active === true);
});
