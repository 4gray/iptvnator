import { Injectable } from '@angular/core';
import { DataService } from './data.service';

// If you import a module but never use any of the imported values other than as TypeScript types,
// the resulting javascript file will look as if you never imported the module at all.
import { ipcRenderer, remote /* webFrame */ } from 'electron';
/* import * as childProcess from 'child_process';
import * as fs from 'fs'; */
// import { Titlebar, Color } from 'custom-electron-titlebar';

@Injectable({
    providedIn: 'root',
})
export class ElectronService extends DataService {
    private ipcRenderer: typeof ipcRenderer;
    // webFrame: typeof webFrame;
    private remote: typeof remote;
    // childProcess: typeof childProcess;
    // fs: typeof fs;

    get isElectron(): boolean {
        return !!(window && window.process && window.process.type);
    }

    constructor() {
        super();
        // Conditional imports
        if (this.isElectron) {
            this.ipcRenderer = window.require('electron').ipcRenderer;
            this.remote = window.require('electron').remote;
            /* this.webFrame = window.require('electron').webFrame */ // need to test whether remote is available
            /* this.childProcess = window.require('child_process');
            this.fs = window.require('fs'); */
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
