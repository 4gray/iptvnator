import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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

    async selectChannelByNumber(number: number): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/channel/select-number`, {
                number,
            })
        );
    }

    async volumeUp(): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/volume/up`, {})
        );
    }

    async volumeDown(): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/volume/down`, {})
        );
    }

    async toggleMute(): Promise<void> {
        await firstValueFrom(
            this.http.post<void>(`${this.apiBaseUrl}/volume/toggle-mute`, {})
        );
    }

    async getStatus(): Promise<RemoteControlStatus> {
        return await firstValueFrom(
            this.http.get<RemoteControlStatus>(`${this.apiBaseUrl}/status`)
        );
    }
}
