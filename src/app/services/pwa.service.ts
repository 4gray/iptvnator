import { Injectable } from '@angular/core';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    constructor() {
        super();
        console.log('PWA Service');
    }

    getAppVersion(): string {
        return '1.0.0';
        //throw new Error('Method not implemented.');
    }

    sendIpcEvent(type: string, payload?: unknown): void {
        console.log(type, payload);
        // throw new Error('Method not implemented.');
    }

    removeAllListeners(type: string) {
        console.log(type + ' listeners removed');
    }

    listenOn(command: string, callback: (...args: any[]) => void): void {
        console.log('listen on ' + command);
    }
}
