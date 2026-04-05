import { app, BrowserWindow } from 'electron';
import { getElectronUserDataPath } from 'database';
import fixPath from 'fix-path';
import App from './app/app';
import { initDatabase } from './app/database/connection';
import DatabaseEvents from './app/events/database.events';
import {
    resetStaleDownloads,
    setMainWindow as setDownloadsMainWindow,
} from './app/events/database/downloads.events';
import ElectronEvents from './app/events/electron.events';
import EpgEvents from './app/events/epg.events';
import PlayerEvents from './app/events/player.events';
import PlaylistEvents from './app/events/playlist.events';
import RemoteControlEvents from './app/events/remote-control.events';
import SettingsEvents from './app/events/settings.events';
import SharedEvents from './app/events/shared.events';
import SquirrelEvents from './app/events/squirrel.events';
import StalkerEvents from './app/events/stalker.events';
import { isStartupTraceEnabled, trace } from './app/services/debug-trace';
import { databaseWorkerClient } from './app/services/database-worker-client';
import XtreamEvents from './app/events/xtream.events';

app.setName('iptvnator');

const electronUserDataPath = getElectronUserDataPath();

if (electronUserDataPath) {
    app.setPath('userData', electronUserDataPath);
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

        // Initialize database before other events
        await initDatabase();

        if (isStartupTraceEnabled()) {
            trace('startup', 'init-database:done');
        }

        ElectronEvents.bootstrapElectronEvents();
        PlaylistEvents.bootstrapPlaylistEvents();
        SharedEvents.bootstrapSharedEvents();
        PlayerEvents.bootstrapPlayerEvents();
        SettingsEvents.bootstrapSettingsEvents();
        StalkerEvents.bootstrapStalkerEvents();
        XtreamEvents.bootstrapXtreamEvents();
        DatabaseEvents.bootstrapDatabaseEvents();
        EpgEvents.bootstrapEpgEvents();
        RemoteControlEvents.bootstrapRemoteControlEvents();

        // Set main window for downloads and reset stale downloads
        if (App.mainWindow) {
            setDownloadsMainWindow(App.mainWindow);
        }
        await resetStaleDownloads();

        if (isStartupTraceEnabled()) {
            trace('startup', 'reset-stale-downloads:done');
        }

        // initialize auto updater service
        if (!App.isDevelopmentMode()) {
            // UpdateEvents.initAutoUpdateService();
        }

        if (isStartupTraceEnabled()) {
            trace('startup', 'bootstrap-events:done');
        }
    }
}

fixPath();

// handle setup events as quickly as possible
Main.initialize();

// bootstrap app
Main.bootstrapApp();

// Bootstrap app events after Electron app is ready
app.whenReady().then(async () => {
    if (isStartupTraceEnabled()) {
        trace('startup', 'app.whenReady');
    }
    await Main.bootstrapAppEvents();
});

app.on('before-quit', () => {
    void databaseWorkerClient.shutdown();
});
