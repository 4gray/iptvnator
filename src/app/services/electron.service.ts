import { Injectable } from '@angular/core';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class ElectronService extends DataService {
    /**
     * Creates an instance of ElectronService.
     */
    constructor() {
        super();
        console.log('Electron service initialized...');
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

    /**
     * Listens on an IPC event from the main process
     * @param command command name
     * @param callback callback function
     */
    listenOn(command: string, callback: (...args: any[]) => void): void {
        this.ipcRenderer.on(command, callback);
    }
}
