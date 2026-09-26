/**
 * Main-process work that only has to exist once the renderer has started
 * loading: portal, EPG, download, player, probe, remote-control and update
 * IPC, the database, and the recovery passes that follow the first load.
 *
 * main.ts loads this module through a dynamic import inside the main
 * window's `did-start-loading` listener (see deferred-bootstrap.ts), so the
 * heavy dependencies it pulls in (axios, drizzle-orm, better-sqlite3,
 * electron-updater, fix-path) are evaluated while the renderer parses and
 * runs its own bundle instead of before the window can load at all.
 *
 * Keep `bootstrapDeferredEvents()` synchronous: the guarantee that no
 * renderer `invoke` finds a missing handler depends on it.
 */
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { registerM3uSourceProbe } from '../events/m3u-source-probe';
import { registerSourceProbeCancellation } from '../events/source-probe-control';
import App from '../app';
import { initDatabase } from '../database/connection';
import DatabaseEvents from '../events/database.events';
import {
    resetStaleDownloads,
    setMainWindow as setDownloadsMainWindow,
} from '../events/database/downloads.events';
import { setRecordingsMainWindow } from '../events/database/recording-broadcast';
import { reconcileStaleRecordings } from '../events/database/recording-recovery';
import ElectronEvents from '../events/electron.events';
import EmbeddedMpvEvents, {
    shutdownEmbeddedMpv,
} from '../events/embedded-mpv.events';
import EpgEvents from '../events/epg.events';
import AppUpdateEvents from '../events/app-update.events';
import { shutdownMpvSession } from '../events/mpv-session.service';
import PlayerEvents from '../events/player.events';
import { shutdownVlcSession } from '../events/vlc-session.service';
import PlaylistEvents from '../events/playlist.events';
import RemoteControlEvents from '../events/remote-control.events';
import SettingsEvents from '../events/settings.events';
import SharedEvents from '../events/shared.events';
import StalkerEvents from '../events/stalker.events';
import XtreamEvents from '../events/xtream.events';
import { registerStreamProbeHandlers } from '../events/stream-probe';
import { registerConnectivityGuardHandlers } from '../events/connectivity-guard.events';
import { isStartupTraceEnabled, trace } from '../services/debug-trace';
import { AppUpdateService } from '../services/app-update.service';
import {
    onAppUpdateChannelChange,
    readStoredAppUpdateChannel,
} from '../services/app-update-channel';
import { databaseWorkerClient } from '../services/database-worker-client';
import type { bootstrapWindowCloseGuard } from '../services/window-close-guard.service';

export interface DeferredEventsContext {
    readonly appVersion: string;
    readonly windowCloseGuard: ReturnType<typeof bootstrapWindowCloseGuard>;
}

export interface DeferredEventsHandles {
    readonly appUpdateService: AppUpdateService;
}

export function bootstrapDeferredEvents(
    context: DeferredEventsContext
): DeferredEventsHandles {
    const { windowCloseGuard } = context;
    const appUpdateService = new AppUpdateService({
        app,
        appVersion: context.appVersion,
        channel: readStoredAppUpdateChannel(),
        getMainWindow: () => App.mainWindow,
        updater: () => autoUpdater,
        // quitAndInstall() closes the windows before 'before-quit' fires
        // (macOS), so without this an armed close guard would intercept
        // the install's window close and strand the update.
        prepareQuit: () => windowCloseGuard.allowNextClose(),
        cancelPreparedQuit: () => windowCloseGuard.revokeAllowedClose(),
    });
    AppUpdateEvents.bootstrapAppUpdateEvents(appUpdateService);
    onAppUpdateChannelChange((channel) => appUpdateService.setChannel(channel));

    ElectronEvents.bootstrapElectronEvents();
    EmbeddedMpvEvents.bootstrapEmbeddedMpvEvents();
    PlaylistEvents.bootstrapPlaylistEvents();
    SharedEvents.bootstrapSharedEvents();
    PlayerEvents.bootstrapPlayerEvents();
    SettingsEvents.bootstrapSettingsEvents();
    StalkerEvents.bootstrapStalkerEvents();
    XtreamEvents.bootstrapXtreamEvents();
    registerStreamProbeHandlers();
    registerM3uSourceProbe();
    registerSourceProbeCancellation();
    registerConnectivityGuardHandlers();
    DatabaseEvents.bootstrapDatabaseEvents();
    EpgEvents.bootstrapEpgEvents();
    RemoteControlEvents.bootstrapRemoteControlEvents();

    // Keep the downloads broadcaster bound to the live window. macOS can
    // rebuild the window while the process runs, and a stale reference
    // silently swallows every DOWNLOADS_UPDATE_EVENT.
    App.onMainWindowCreated(setDownloadsMainWindow);
    App.onMainWindowCreated(setRecordingsMainWindow);

    return { appUpdateService };
}

/**
 * Database initialization and recovery, after the first renderer load is
 * underway so Linux Electron E2E can observe a BrowserWindow even when
 * SQLite startup or download recovery is slow. IPC handlers call
 * getDatabase() lazily and share the same initialization promise.
 */
export async function finishStartupAfterFirstLoad(): Promise<void> {
    await initDatabase();

    if (isStartupTraceEnabled()) {
        trace('startup', 'init-database:done');
    }

    await resetStaleDownloads();

    if (isStartupTraceEnabled()) {
        trace('startup', 'reset-stale-downloads:done');
    }

    await reconcileStaleRecordings();

    if (isStartupTraceEnabled()) {
        trace('startup', 'reconcile-stale-recordings:done');
    }
}

let fixPathScheduled = false;

/**
 * Update process.env.PATH from the user's interactive login shell so that
 * spawned external players (MPV/VLC) can be resolved by binary name.
 *
 * Runs after window creation + IPC handler registration so the 50-300 ms
 * shell-spawn cost (bash/zsh -ilc env) doesn't block startup. Idempotent:
 * subsequent calls are no-ops. fix-path itself is imported here, on demand,
 * so its module evaluation stays off the launch path as well.
 */
export function scheduleDeferredFixPath(): void {
    if (fixPathScheduled || process.platform === 'win32') {
        return;
    }

    fixPathScheduled = true;
    setImmediate(() => {
        import('fix-path')
            .then(({ default: fixPath }) => {
                fixPath();
                if (isStartupTraceEnabled()) {
                    trace('startup', 'fix-path:done');
                }
            })
            .catch((error) => {
                console.warn('fix-path failed:', error);
            });
    });
}

/** Tears down sessions and the DB worker; safe when nothing was started. */
export function shutdownDeferredServices(): void {
    shutdownEmbeddedMpv();
    shutdownMpvSession();
    shutdownVlcSession();
    void databaseWorkerClient.shutdown();
}

/** The module shape main.ts receives from its dynamic import. */
export type DeferredEventsModule = {
    readonly bootstrapDeferredEvents: typeof bootstrapDeferredEvents;
    readonly finishStartupAfterFirstLoad: typeof finishStartupAfterFirstLoad;
    readonly scheduleDeferredFixPath: typeof scheduleDeferredFixPath;
    readonly shutdownDeferredServices: typeof shutdownDeferredServices;
};
