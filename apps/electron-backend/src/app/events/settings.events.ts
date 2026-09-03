import { ipcMain } from 'electron';
import {
    normalizeEmbeddedMpvExtraOptions,
    normalizeExternalPlayerArguments,
    normalizeStartupWindowMode,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import {
    EMBEDDED_MPV_EXTRA_OPTIONS,
    EMBEDDED_MPV_FRAME_COPY,
    MPV_PLAYER_ARGUMENTS,
    MPV_REUSE_INSTANCE,
    STARTUP_WINDOW_MODE,
    store,
    VLC_PLAYER_ARGUMENTS,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { httpServer } from '../server/http-server';

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

ipcMain.handle('SETTINGS_UPDATE', (_event, arg) => {
    console.log(
        'Received SETTINGS_UPDATE with data:',
        redactSensitiveData(arg)
    );

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

    // Applied on the next app start (window sandbox is fixed at creation).
    if (arg.embeddedMpvFrameCopy !== undefined) {
        store.set(EMBEDDED_MPV_FRAME_COPY, !!arg.embeddedMpvFrameCopy);
    }
    if (arg.embeddedMpvExtraOptions !== undefined) {
        store.set(
            EMBEDDED_MPV_EXTRA_OPTIONS,
            normalizeEmbeddedMpvExtraOptions(arg.embeddedMpvExtraOptions)
        );
    }

    // Read by initMainWindow before any renderer exists, so it applies on
    // the next launch. Normalized here so a junk value never reaches the
    // config file.
    if (arg.startupWindowMode !== undefined) {
        store.set(
            STARTUP_WINDOW_MODE,
            normalizeStartupWindowMode(arg.startupWindowMode)
        );
    }

    if (arg.vlcReuseInstance !== undefined) {
        store.set(VLC_REUSE_INSTANCE, arg.vlcReuseInstance);
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


