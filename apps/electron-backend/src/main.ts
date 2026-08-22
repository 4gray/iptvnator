import { app, BrowserWindow } from 'electron';
import { getElectronUserDataPath } from '@iptvnator/shared/database';
import { autoUpdater } from 'electron-updater';
import fixPath from 'fix-path';
import App from './app/app';
import { initDatabase } from './app/database/connection';
import DatabaseEvents from './app/events/database.events';
import {
    resetStaleDownloads,
    setMainWindow as setDownloadsMainWindow,
} from './app/events/database/downloads.events';
import { setRecordingsMainWindow } from './app/events/database/recording-broadcast';
import { reconcileStaleRecordings } from './app/events/database/recording-recovery';
import ElectronEvents from './app/events/electron.events';
import EmbeddedMpvEvents, {
    shutdownEmbeddedMpv,
} from './app/events/embedded-mpv.events';
import EpgEvents from './app/events/epg.events';
import AppUpdateEvents from './app/events/app-update.events';
import { shutdownMpvSession } from './app/events/mpv-session.service';
import PlayerEvents from './app/events/player.events';
import { shutdownVlcSession } from './app/events/vlc-session.service';
import PlaylistEvents from './app/events/playlist.events';
import PlaylistOpenEvents from './app/events/playlist-open.events';
import RemoteControlEvents from './app/events/remote-control.events';
import SettingsEvents from './app/events/settings.events';
import SharedEvents from './app/events/shared.events';
import SquirrelEvents from './app/events/squirrel.events';
import StalkerEvents from './app/events/stalker.events';
import { isStartupTraceEnabled, trace } from './app/services/debug-trace';
import { registerStaticHeaderShims } from './app/services/request-header-overrides.service';
import { AppUpdateService } from './app/services/app-update.service';
import { databaseWorkerClient } from './app/services/database-worker-client';
import WindowEvents from './app/events/window.events';
import { bootstrapWindowCloseGuard } from './app/services/window-close-guard.service';
import { registerStreamProbeHandlers } from './app/events/stream-probe';
import { registerConnectivityGuardHandlers } from './app/events/connectivity-guard.events';
import XtreamEvents from './app/events/xtream.events';
import { environment } from './environments/environment';
import {
    isFrameCopyRuntimeUsable,
    shouldPromotePersistedFrameCopyOptIn,
} from './app/services/embedded-mpv-frame-copy-platform.util';
import { isEmbeddedMpvFeatureEnabled } from './app/services/embedded-mpv-runtime-policy.util';
import { runEmbeddedMpvRuntimeDiagnosticOrContinue } from './app/services/embedded-mpv-runtime-diagnostic';
import { acquireSingleInstanceLock } from './app/services/single-instance';
import {
    createPlaylistOpenRequest,
    extractPlaylistOpenRequestsFromArgv,
    playlistOpenRequests,
} from './app/services/playlist-open-request';
import { EMBEDDED_MPV_FRAME_COPY, store } from './app/services/store.service';

app.setName('iptvnator');

// Packaged Linux launchers force X11 via the .desktop entry
// (electron-builder `executableArgs`), but direct binary/AppImage launches
// from a terminal bypass that entry. Embedded MPV supports X11/XWayland
// only, and its support probe requires the ozone switch to be present, so
// mirror the launcher behavior here. Explicit user intent wins: both an
// --ozone-platform switch and the ELECTRON_OZONE_PLATFORM_HINT env var
// suppress the fallback.
if (
    process.platform === 'linux' &&
    !app.commandLine.hasSwitch('ozone-platform') &&
    !process.env.ELECTRON_OZONE_PLATFORM_HINT
) {
    app.commandLine.appendSwitch('ozone-platform', 'x11');
}

const electronUserDataPath = getElectronUserDataPath();

if (electronUserDataPath) {
    app.setPath('userData', electronUserDataPath);
}

// The frame-copy embedded MPV engine must be decided before the main window
// exists: it relaxes the window sandbox for the preload frame pump, and
// webPreferences are fixed at window creation. The Settings toggle persists
// to the main-process config store; an explicitly set env var (including
// '0') always wins so dev/CI behavior stays scriptable.
if (
    isEmbeddedMpvFeatureEnabled() &&
    shouldPromotePersistedFrameCopyOptIn(
        store.get(EMBEDDED_MPV_FRAME_COPY, false),
        process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY,
        isFrameCopyRuntimeUsable
    )
) {
    process.env.IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY = '1';
}

let fixPathScheduled = false;

/**
 * Update process.env.PATH from the user's interactive login shell so that
 * spawned external players (MPV/VLC) can be resolved by binary name.
 *
 * Runs after window creation + IPC handler registration so the 50-300 ms
 * shell-spawn cost (bash/zsh -ilc env) doesn't block startup. Idempotent:
 * subsequent calls are no-ops.
 */
function scheduleDeferredFixPath(): void {
    if (fixPathScheduled || process.platform === 'win32') {
        return;
    }

    fixPathScheduled = true;
    setImmediate(() => {
        try {
            fixPath();
            if (isStartupTraceEnabled()) {
                trace('startup', 'fix-path:done');
            }
        } catch (error) {
            console.warn('fix-path failed:', error);
        }
    });
}

export default class Main {
    static initialize() {
        if (SquirrelEvents.handleEvents()) {
            // squirrel event handled (except first run event) and app will exit in 1000ms, so don't do anything else
            app.quit();
        }
    }

    static bootstrapApp() {
        if (isStartupTraceEnabled()) {
            trace('startup', 'bootstrap-app');
        }
        App.main(app, BrowserWindow);
    }

    static async bootstrapAppEvents() {
        if (isStartupTraceEnabled()) {
            trace('startup', 'bootstrap-events:start');
        }

        const windowCloseGuard = bootstrapWindowCloseGuard((listener) =>
            App.onMainWindowCreated(listener)
        );
        const appUpdateService = new AppUpdateService({
            app,
            appVersion: environment.version,
            getMainWindow: () => App.mainWindow,
            updater: () => autoUpdater,
            // quitAndInstall() closes the windows before 'before-quit' fires
            // (macOS), so without this an armed close guard would intercept
            // the install's window close and strand the update.
            prepareQuit: () => windowCloseGuard.allowNextClose(),
            cancelPreparedQuit: () => windowCloseGuard.revokeAllowedClose(),
        });
        AppUpdateEvents.bootstrapAppUpdateEvents(appUpdateService);

        registerStaticHeaderShims();
        ElectronEvents.bootstrapElectronEvents();
        WindowEvents.bootstrapWindowEvents();
        EmbeddedMpvEvents.bootstrapEmbeddedMpvEvents();
        PlaylistEvents.bootstrapPlaylistEvents();
        PlaylistOpenEvents.bootstrapPlaylistOpenEvents();
        SharedEvents.bootstrapSharedEvents();
        PlayerEvents.bootstrapPlayerEvents();
        SettingsEvents.bootstrapSettingsEvents();
        StalkerEvents.bootstrapStalkerEvents();
        XtreamEvents.bootstrapXtreamEvents();
        registerStreamProbeHandlers();
        registerConnectivityGuardHandlers();
        DatabaseEvents.bootstrapDatabaseEvents();
        EpgEvents.bootstrapEpgEvents();
        RemoteControlEvents.bootstrapRemoteControlEvents();

        // Keep the downloads broadcaster bound to the live window. macOS can
        // rebuild the window while the process runs, and a stale reference
        // silently swallows every DOWNLOADS_UPDATE_EVENT.
        App.onMainWindowCreated(setDownloadsMainWindow);
        App.onMainWindowCreated(setRecordingsMainWindow);

        // Load the renderer only after IPC handlers are registered. On slower
        // Linux CI hosts the renderer can otherwise invoke Electron bridge IPC
        // before the main process has installed handlers.
        await App.loadMainWindow();
        void appUpdateService.checkForUpdatesOnStartup();

        // Initialize the database after the first renderer load is underway so
        // Linux Electron E2E can observe a BrowserWindow even when SQLite
        // startup or download recovery is slow. IPC handlers call getDatabase()
        // lazily and share the same initialization promise.
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

        if (isStartupTraceEnabled()) {
            trace('startup', 'bootstrap-events:done');
        }

        // Hydrate process.env.PATH from the user's login shell now — after
        // the window has loaded and IPC handlers are live. Fire-and-forget
        // (setImmediate) so it doesn't gate any user-visible work. Worst
        // case: the user clicks an external player within the ~100 ms it
        // takes to complete; the spawn would still find MPV/VLC at any of
        // the well-known paths checked by getDefault*Path before falling
        // back to bare-name PATH lookup.
        scheduleDeferredFixPath();
    }
}

runEmbeddedMpvRuntimeDiagnosticOrContinue(process.argv, () => {
    // macOS never puts the opened file in argv — Launch Services delivers it
    // through `open-file`, which can fire before `whenReady`. Registering the
    // listener here (and calling preventDefault, or Electron logs a warning
    // and treats the event as unhandled) is the only way to catch a launch by
    // double-clicking a playlist in Finder.
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        playlistOpenRequests.enqueue(createPlaylistOpenRequest(filePath));
    });

    // Windows/Linux file associations and plain `iptvnator playlist.m3u`
    // launches arrive as arguments instead — one per file, since selecting
    // several playlists at once is a single launch. The renderer drains the
    // queue once it is ready.
    playlistOpenRequests.enqueueAll(
        extractPlaylistOpenRequestsFromArgv(process.argv)
    );

    // handle setup events as quickly as possible
    Main.initialize();

    // A second instance sharing this userData directory cannot take the
    // Chromium storage lock, so its renderer silently loses every settings
    // write. Focus the window that already owns the profile instead — or
    // re-create it, since on macOS the process outlives its last window.
    if (
        !acquireSingleInstanceLock(
            app,
            () => App.mainWindow,
            () => App.ensureMainWindow(),
            {
                // A second launch is also how the OS says "open this playlist
                // in the app you already have running". Its argv is the only
                // carrier for that, and it is relative to *its* cwd.
                onSecondInstance: (argv, workingDirectory) => {
                    playlistOpenRequests.enqueueAll(
                        extractPlaylistOpenRequestsFromArgv(
                            argv,
                            workingDirectory
                        )
                    );
                },
            }
        )
    ) {
        return;
    }

    // bootstrap app
    Main.bootstrapApp();

    // Bootstrap app events after Electron app is ready
    app.whenReady().then(async () => {
        if (isStartupTraceEnabled()) {
            trace('startup', 'app.whenReady');
        }
        await Main.bootstrapAppEvents();
    });

    // 'will-quit', not 'before-quit': the unsaved-settings close guard can
    // cancel a quit mid-flight by preventing the window close, and
    // 'before-quit' has already fired by then — tearing sessions and the DB
    // worker down there would leave a cancelled quit with the app open but
    // playback and database work destroyed. 'will-quit' only fires once
    // every window close was allowed through.
    app.on('will-quit', () => {
        shutdownEmbeddedMpv();
        shutdownMpvSession();
        shutdownVlcSession();
        void databaseWorkerClient.shutdown();
    });
});
