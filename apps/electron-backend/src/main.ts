import { app, BrowserWindow } from 'electron';
import fixPath from 'fix-path';
import App from './app/app';
import ElectronEvents from './app/events/electron.events';
import PlayerEvents from './app/events/player.events';
import PlaylistEvents from './app/events/playlist.events';
import SettingsEvents from './app/events/setttings.events';
import SharedEvents from './app/events/shared.events';
import SquirrelEvents from './app/events/squirrel.events';

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

    static bootstrapAppEvents() {
        ElectronEvents.bootstrapElectronEvents();
        PlaylistEvents.bootstrapPlaylistEvents();
        SharedEvents.bootstrapSharedEvents();
        PlayerEvents.bootstrapPlayerEvents();
        SettingsEvents.bootstrapSettingsEvents();

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
Main.bootstrapAppEvents();
