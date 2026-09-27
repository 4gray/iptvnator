// Select persistence before eager imports (notably electron-conf) cache userData.
import './app/services/electron-profile-bootstrap';
import { app, BrowserWindow } from 'electron';
import App from './app/app';
import PlaylistOpenEvents from './app/events/playlist-open.events';
import SquirrelEvents from './app/events/squirrel.events';
import { isStartupTraceEnabled, trace } from './app/services/debug-trace';
import { readCompileCacheOutcome } from './app/services/compile-cache';
import { applyElectronNetworkDefaults } from './app/util/network-defaults';
import { registerStaticHeaderShims } from './app/services/request-header-overrides.service';
import WindowEvents from './app/events/window.events';
import { bootstrapWindowCloseGuard } from './app/services/window-close-guard.service';
import { environment } from './environments/environment';
import {
    createDeferredBootstrap,
    type DeferredBootstrap,
} from './app/startup/deferred-bootstrap';
import type {
    DeferredEventsHandles,
    DeferredEventsModule,
} from './app/startup/deferred-events';
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

if (isStartupTraceEnabled()) {
    trace('startup', 'compile-cache', readCompileCacheOutcome());
}

// Before the first portal, playlist or update request leaves this process.
applyElectronNetworkDefaults((line) => {
    if (isStartupTraceEnabled()) {
        console.log(`[IPTVnator Trace][startup] ${line}`);
    }
});

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

/** Set once bootstrapAppEvents() arms the deferred group; read at quit. */
let deferredEvents: DeferredBootstrap<
    DeferredEventsModule,
    DeferredEventsHandles
> | null = null;

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

    /**
     * Everything the renderer may call before its first paint registers
     * here, synchronously, before the window loads. The rest lives in
     * app/startup/deferred-events.ts and is loaded inside the window's
     * `did-start-loading` listener (see deferred-bootstrap.ts for why that
     * still guarantees the handlers exist before any renderer invoke).
     */
    static async bootstrapAppEvents() {
        if (isStartupTraceEnabled()) {
            trace('startup', 'bootstrap-events:start');
        }

        const windowCloseGuard = bootstrapWindowCloseGuard((listener) =>
            App.onMainWindowCreated(listener)
        );
        registerStaticHeaderShims();
        WindowEvents.bootstrapWindowEvents();
        PlaylistOpenEvents.bootstrapPlaylistOpenEvents();

        const deferred = createDeferredBootstrap<
            DeferredEventsModule,
            DeferredEventsHandles
        >({
            load: () =>
                import(
                    /* webpackChunkName: "deferred-events" */ './app/startup/deferred-events.js'
                ),
            run: (module) =>
                module.bootstrapDeferredEvents({
                    appVersion: environment.version,
                    windowCloseGuard,
                }),
            onTrigger: (source) => {
                if (isStartupTraceEnabled()) {
                    trace('startup', 'deferred-events:start', { source });
                }
            },
            onDone: (durationMs) => {
                if (isStartupTraceEnabled()) {
                    trace('startup', 'deferred-events:done', { durationMs });
                }
            },
            // The window is open by now; without this a missing chunk would
            // only show up as an unhandled rejection with no context.
            onError: (error) => {
                console.error(
                    'Deferred main-process startup failed; portal, EPG, database and download handlers are unavailable:',
                    error
                );
                if (isStartupTraceEnabled()) {
                    trace('startup', 'deferred-events:failed', error);
                }
            },
        });
        deferredEvents = deferred;
        deferred.armOn(App.mainWindow?.webContents);

        // Load the renderer only after the pre-paint handlers are registered.
        // The deferred group registers as soon as the navigation starts; the
        // fallback below covers a load that never gets that far. Its errors
        // surface through the awaited trigger(), so they are swallowed here.
        const loadingMainWindow = App.loadMainWindow();
        void loadingMainWindow
            .catch(() => undefined)
            .then(() => deferred.trigger())
            .catch(() => undefined);
        await loadingMainWindow;
        const { module, result } = await deferred.trigger();
        void result.appUpdateService.checkForUpdatesOnStartup();

        await module.finishStartupAfterFirstLoad();

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
        module.scheduleDeferredFixPath();
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
        // Nothing to tear down when the deferred group never loaded.
        deferredEvents?.module?.shutdownDeferredServices();
    });
});
