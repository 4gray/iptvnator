import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

const REMOTE_REQUEST_TIMEOUT_MS = 10_000;

export interface RemoteControlStatus {
    portal: 'm3u' | 'xtream' | 'stalker' | 'unknown';
    isLiveView: boolean;
    channelName?: string;
    channelNumber?: number;
    epgTitle?: string;
    epgStart?: string;
    epgEnd?: string;
    supportsVolume?: boolean;
    volume?: number;
    muted?: boolean;
    updatedAt?: string;
}

/**
 * Service for remote control operations.
 * This service communicates with the Electron backend via HTTP API.
 */
@Injectable({
    providedIn: 'root',
})
export class RemoteControlService {
    private readonly apiBaseUrl = '/api/remote-control';
    private readonly http = inject(HttpClient);

    /** Changes to the previous channel in the playback list. */
    async channelUp(): Promise<void> {
        await this.sendCommand('channel/up');
    }

    /** Changes to the next channel in the playback list. */
    async channelDown(): Promise<void> {
        await this.sendCommand('channel/down');
    }

    async selectChannelByNumber(number: number): Promise<void> {
        await this.sendCommand('channel/select-number', { number });
    }

    async volumeUp(): Promise<void> {
        await this.sendCommand('volume/up');
    }

    async volumeDown(): Promise<void> {
        await this.sendCommand('volume/down');
    }

    async toggleMute(): Promise<void> {
        await this.sendCommand('volume/toggle-mute');
    }

    async getStatus(): Promise<RemoteControlStatus> {
        return await firstValueFrom(
            this.http
                .get<RemoteControlStatus>(`${this.apiBaseUrl}/status`)
                .pipe(timeout(REMOTE_REQUEST_TIMEOUT_MS))
        );
    }

    private sendCommand(path: string, body: unknown = {}): Promise<void> {
        // A stalled request must release the component's command/polling guards.
        return firstValueFrom(
            this.http
                .post<void>(`${this.apiBaseUrl}/${path}`, body)
                .pipe(timeout(REMOTE_REQUEST_TIMEOUT_MS))
        );
    }
}
