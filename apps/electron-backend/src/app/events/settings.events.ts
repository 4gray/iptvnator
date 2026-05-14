import { ipcMain } from 'electron';
import { normalizeExternalPlayerArguments } from 'shared-interfaces';
import {
    ACCELERATED_DOWNLOADS,
    MPV_PLAYER_ARGUMENTS,
    MPV_REUSE_INSTANCE,
    REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE,
    store,
    VLC_PLAYER_ARGUMENTS,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { httpServer } from '../server/http-server';
import {
    benchmarkHttpDownload,
    resolveAcceleratedPlaybackUrl,
} from '../services/accelerated-http-download.service';

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('SETTINGS_UPDATE', (_event, arg) => {
    console.log('Received SETTINGS_UPDATE with data:', arg);

    if (arg.mpvPlayerArguments !== undefined) {
        store.set(
            MPV_PLAYER_ARGUMENTS,
            normalizeExternalPlayerArguments(arg.mpvPlayerArguments)
        );
    }

    if (arg.vlcPlayerArguments !== undefined) {
        store.set(
            VLC_PLAYER_ARGUMENTS,
            normalizeExternalPlayerArguments(arg.vlcPlayerArguments)
        );
    }

    // Only set values that are defined
    if (arg.mpvReuseInstance !== undefined) {
        store.set(MPV_REUSE_INSTANCE, arg.mpvReuseInstance);
    }

    if (arg.vlcReuseInstance !== undefined) {
        store.set(VLC_REUSE_INSTANCE, arg.vlcReuseInstance);
    }

    if (arg.acceleratedDownloads !== undefined) {
        store.set(ACCELERATED_DOWNLOADS, Boolean(arg.acceleratedDownloads));
    }

    if (arg.redirectIndirectStreamsToDirectSource !== undefined) {
        store.set(
            REDIRECT_INDIRECT_STREAMS_TO_DIRECT_SOURCE,
            Boolean(arg.redirectIndirectStreamsToDirectSource)
        );
    }

    // Handle remote control settings
    if (
        arg.remoteControl !== undefined ||
        arg.remoteControlPort !== undefined
    ) {
        const enabled = arg.remoteControl ?? store.get('remoteControl', false);
        const port =
            arg.remoteControlPort ?? store.get('remoteControlPort', 8765);

        // Save to store
        if (arg.remoteControl !== undefined) {
            store.set('remoteControl', enabled);
        }
        if (arg.remoteControlPort !== undefined) {
            store.set('remoteControlPort', port);
        }

        // Update HTTP server
        httpServer.updateSettings(enabled, port);
    }
});

ipcMain.handle(
    'ACCELERATED_PLAYBACK_RESOLVE_URL',
    async (
        _event,
        payload: {
            url: string;
            headers?: Record<string, string>;
        }
    ) => {
        if (!store.get(ACCELERATED_DOWNLOADS, true)) {
            return {
                url: payload.url,
                accelerated: false,
                rangeSupported: false,
                status: 0,
                reason: 'Acceleration disabled in settings',
            };
        }

        return resolveAcceleratedPlaybackUrl(payload.url, payload.headers);
    }
);

ipcMain.handle(
    'HTTP_DOWNLOAD_BENCHMARK',
    async (
        _event,
        payload: {
            url: string;
            headers?: Record<string, string>;
            maxBytes?: number;
            timeoutMs?: number;
        }
    ) => benchmarkHttpDownload(payload)
);
