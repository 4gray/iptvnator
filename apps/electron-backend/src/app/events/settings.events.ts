import { ipcMain } from 'electron';
import {
    normalizeEmbeddedMpvExtraOptions,
    normalizeExternalPlayerArguments,
    normalizeStartupWindowMode,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import {
    EMBEDDED_MPV_AUTO_RECONNECT,
    EMBEDDED_MPV_EXTRA_OPTIONS,
    EMBEDDED_MPV_FRAME_COPY,
    MPV_PLAYER_ARGUMENTS,
    MPV_REUSE_INSTANCE,
    PARENTAL_LOCK_ENABLED,
    STARTUP_WINDOW_MODE,
    PORTAL_CONNECTIVITY_GUARD,
    store,
    VLC_PLAYER_ARGUMENTS,
    VLC_REUSE_INSTANCE,
} from '../services/store.service';
import { httpServer } from '../server/http-server';
import { setHostConnectivityGuardEnabled } from '../util/host-connectivity-guard';
import { applyParentalLockState } from './parental-lock.events';
import { persistAppUpdateChannel } from '../services/app-update-channel';

export default class SettingsEvents {
    static bootstrapSettingsEvents(): Electron.IpcMain {
        setHostConnectivityGuardEnabled(
            store.get(PORTAL_CONNECTIVITY_GUARD, true) !== false
        );
        return ipcMain;
    }
}

ipcMain.handle('SETTINGS_UPDATE', (_event, arg) => {
    console.log(
        'Received SETTINGS_UPDATE with data:',
        redactSensitiveData(arg)
    );

    if (arg.portalConnectivityGuard !== undefined) {
        const enabled = arg.portalConnectivityGuard !== false;
        store.set(PORTAL_CONNECTIVITY_GUARD, enabled);
        setHostConnectivityGuardEnabled(enabled);
    }

    // Mirrored so the database worker and a reloaded renderer start locked
    // whenever the feature is on. The LIVE enforcement state is the
    // renderer's to announce through PARENTAL_LOCK_SET_STATE: every full
    // settings save carries this flag unchanged, so applying it here would
    // silently re-lock the worker under a renderer that still shows
    // "unlocked". Only a switch-off releases the worker at once — nothing
    // may stay withheld once the feature is gone.
    if (arg.parentalLockEnabled !== undefined) {
        const enabled = arg.parentalLockEnabled === true;
        const wasEnabled = store.get(PARENTAL_LOCK_ENABLED, false) === true;
        store.set(PARENTAL_LOCK_ENABLED, enabled);
        if (wasEnabled && !enabled) {
            void applyParentalLockState(false).catch(() => undefined);
        }
    }

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
    if (arg.embeddedMpvAutoReconnect !== undefined) {
        store.set(
            EMBEDDED_MPV_AUTO_RECONNECT,
            arg.embeddedMpvAutoReconnect !== false
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

    // Mirrored for the startup update check, which runs before the renderer
    // exists; a change re-points the running updater immediately.
    if (arg.updateChannel !== undefined) {
        persistAppUpdateChannel(arg.updateChannel);
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
