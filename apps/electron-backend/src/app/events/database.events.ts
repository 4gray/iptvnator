/**
 * Database IPC event handlers for Electron
 * Provides database operations to the renderer process
 */

import { ipcMain } from 'electron';

import './database/category.events';
import './database/content.events';
import './database/favorites.events';
import './database/playlist.events';
import './database/recently-viewed.events';
import './database/xtream.events';

export default class DatabaseEvents {
    static bootstrapDatabaseEvents(): Electron.IpcMain {
        return ipcMain;
    }
}
