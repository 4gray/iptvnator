import { app, BrowserWindow } from 'electron';
import fixPath from 'fix-path';
import App from './app/app';
import { initDatabase } from './app/database/connection';
import DatabaseEvents from './app/events/database.events';
import ElectronEvents from './app/events/electron.events';
import EpgEvents from './app/events/epg.events';
import PlayerEvents from './app/events/player.events';
import PlaylistEvents from './app/events/playlist.events';
import SettingsEvents from './app/events/setttings.events';
import SharedEvents from './app/events/shared.events';
import SquirrelEvents from './app/events/squirrel.events';
import StalkerEvents from './app/events/stalker.events';
import XtreamEvents from './app/events/xtream.events';

app.setName('iptvnator');

export default class Main {
    static initialize() {
        if (SquirrelEvents.handleEvents()) {
            // squirrel event handled (except first run event) and app will exit in 1000ms, so don't do anything else
            app.quit();
        }
    }

    static bootstrapApp() {
        App.main(app, BrowserWindow);
    }

    static async bootstrapAppEvents() {
        // Initialize database before other events
        await initDatabase();

        ElectronEvents.bootstrapElectronEvents();
        PlaylistEvents.bootstrapPlaylistEvents();
        SharedEvents.bootstrapSharedEvents();
        PlayerEvents.bootstrapPlayerEvents();
        SettingsEvents.bootstrapSettingsEvents();
        StalkerEvents.bootstrapStalkerEvents();
        XtreamEvents.bootstrapXtreamEvents();
        DatabaseEvents.bootstrapDatabaseEvents();
        EpgEvents.bootstrapEpgEvents();

        // initialize auto updater service
        if (!App.isDevelopmentMode()) {
            // UpdateEvents.initAutoUpdateService();
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
    await Main.bootstrapAppEvents();
});
