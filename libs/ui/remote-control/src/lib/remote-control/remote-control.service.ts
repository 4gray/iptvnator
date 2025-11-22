import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Service for remote control operations.
 * This service communicates with the Electron backend via HTTP API.
 */
@Injectable({
    providedIn: 'root',
})
export class RemoteControlService {
    private readonly apiBaseUrl = '/api/remote-control';

    constructor(private http: HttpClient) {}

    /**
     * Changes to the next channel
     */
    async channelUp(): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/channel/up`, {})
        );
    }

    /**
     * Changes to the previous channel
     */
    async channelDown(): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/channel/down`, {})
        );
    }
}
