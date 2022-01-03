import { Injectable } from '@angular/core';
import { DataService } from './data.service';

import { ipcRenderer, remote } from 'electron';

@Injectable({
    providedIn: 'root',
})
export class ElectronService extends DataService {
    private ipcRenderer: typeof ipcRenderer;
    private remote: typeof remote;

    constructor() {
        super();
        // Conditional imports
        if (this.isElectron) {
            this.ipcRenderer = window.require('electron').ipcRenderer;
            this.remote = window.require('electron').remote;
        }
    }

    /**
     * Returns the current version of the application
     */
    getAppVersion(): string {
        return this.remote.app.getVersion();
    }

    /**
     * Sends an IPC event from render to the main process
     * @param type event type
     * @param payload data payload
     */
    sendIpcEvent(type: string, payload?: unknown): void {
        this.ipcRenderer.send(type, payload);
    }

    /**
     * Removes all IPC listeners
     * @param type command name
     */
    removeAllListeners(type: string): void {
        this.ipcRenderer.removeAllListeners(type);
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        this.ipcRenderer.on(command, callback);
    }
}
