import { inject, Injectable } from '@angular/core';
import { DataService } from 'services';
import {
    EpgItem,
    XtreamCategory,
    XtreamCodeActions,
    XtreamLiveStream,
    XtreamSerieDetails,
    XtreamSerieItem,
    XtreamVodDetails,
    XtreamVodStream,
    XTREAM_REQUEST,
} from 'shared-interfaces';
import { XtreamAccountInfo } from '../account-info/account-info.interface';

/**
 * Xtream API credentials
 */
export interface XtreamCredentials {
    serverUrl: string;
    username: string;
    password: string;
}

/**
 * Category type mapping for API calls
 */
export type CategoryType = 'live' | 'vod' | 'series';

/**
 * Stream type mapping for API calls
 */
export type StreamType = 'live' | 'movie' | 'series';

export interface XtreamRequestOptions {
    requestId?: string;
    sessionId?: string;
    suppressErrorLog?: boolean;
}

/**
 * Raw EPG listing from API (before decoding)
 */
interface RawEpgListing {
    title: string;
    description: string;
    start: string;
    end: string;
    start_timestamp: string;
    stop_timestamp: string;
    [key: string]: unknown;
}

/**
 * EPG API response
 */
interface EpgResponse {
    epg_listings?: RawEpgListing[];
}

/**
 * Service for all Xtream Codes API interactions.
 * Extracts API communication logic from the XtreamStore.
 */
@Injectable({ providedIn: 'root' })
export class XtreamApiService {
    private readonly dataService = inject(DataService);

    async cancelSession(sessionId: string): Promise<boolean> {
        if (!sessionId || typeof window.electron?.xtreamCancelSession !== 'function') {
            return false;
        }

        try {
            const result = await window.electron.xtreamCancelSession(sessionId);
            return result.success;
        } catch (error) {
            console.error('Failed to cancel Xtream session:', error);
            return false;
        }
    }

    /**
     * Get account/portal status
     */
    async getAccountInfo(
        credentials: XtreamCredentials,
        options?: XtreamRequestOptions
    ): Promise<XtreamAccountInfo> {
        return this.sendRequest(
            credentials.serverUrl,
            {
                username: credentials.username,
                password: credentials.password,
                action: XtreamCodeActions.GetAccountInfo,
            },
            options
        );
    }

    /**
     * Get categories by type
     */
    async getCategories(
        credentials: XtreamCredentials,
        type: CategoryType,
        options?: XtreamRequestOptions
    ): Promise<XtreamCategory[]> {
        const actionMap: Record<CategoryType, XtreamCodeActions> = {
            live: XtreamCodeActions.GetLiveCategories,
            vod: XtreamCodeActions.GetVodCategories,
            series: XtreamCodeActions.GetSeriesCategories,
        };

        const response = await this.sendRequest(
            credentials.serverUrl,
            {
                action: actionMap[type],
                username: credentials.username,
                password: credentials.password,
            },
            options
        );

        return Array.isArray(response) ? response : [];
    }

    /**
     * Get live streams
     */
    async getLiveStreams(
        credentials: XtreamCredentials,
        options?: XtreamRequestOptions
    ): Promise<XtreamLiveStream[]> {
        const response = await this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetLiveStreams,
                username: credentials.username,
                password: credentials.password,
            },
            options
        );

        return Array.isArray(response) ? response : [];
    }

    /**
     * Get VOD streams
     */
    async getVodStreams(
        credentials: XtreamCredentials,
        options?: XtreamRequestOptions
    ): Promise<XtreamVodStream[]> {
        const response = await this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetVodStreams,
                username: credentials.username,
                password: credentials.password,
            },
            options
        );

        return Array.isArray(response) ? response : [];
    }

    /**
     * Get series items
     */
    async getSeriesStreams(
        credentials: XtreamCredentials,
        options?: XtreamRequestOptions
    ): Promise<XtreamSerieItem[]> {
        const response = await this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetSeries,
                username: credentials.username,
                password: credentials.password,
            },
            options
        );

        return Array.isArray(response) ? response : [];
    }

    /**
     * Get streams by type (unified method)
     */
    async getStreams(
        credentials: XtreamCredentials,
        type: StreamType,
        options?: XtreamRequestOptions
    ): Promise<XtreamLiveStream[] | XtreamVodStream[] | XtreamSerieItem[]> {
        switch (type) {
            case 'live':
                return this.getLiveStreams(credentials, options);
            case 'movie':
                return this.getVodStreams(credentials, options);
            case 'series':
                return this.getSeriesStreams(credentials, options);
        }
    }

    /**
     * Get VOD details
     */
    async getVodInfo(
        credentials: XtreamCredentials,
        vodId: string | number,
        options?: XtreamRequestOptions
    ): Promise<XtreamVodDetails> {
        return this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetVodInfo,
                username: credentials.username,
                password: credentials.password,
                vod_id: vodId,
            },
            options
        );
    }

    /**
     * Get series details
     */
    async getSeriesInfo(
        credentials: XtreamCredentials,
        seriesId: string | number,
        options?: XtreamRequestOptions
    ): Promise<XtreamSerieDetails> {
        return this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetSeriesInfo,
                username: credentials.username,
                password: credentials.password,
                series_id: seriesId,
            },
            options
        );
    }

    /**
     * Get short EPG for a stream
     * Returns decoded EPG items (title and description are base64 decoded)
     */
    async getShortEpg(
        credentials: XtreamCredentials,
        streamId: number,
        limit = 10,
        options?: XtreamRequestOptions
    ): Promise<EpgItem[]> {
        const response: EpgResponse = await this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetShortEpg,
                username: credentials.username,
                password: credentials.password,
                stream_id: streamId,
                limit,
            },
            options
        );

        if (!response?.epg_listings || !Array.isArray(response.epg_listings)) {
            return [];
        }

        return response.epg_listings.map((item) => ({
            ...item,
            title: this.decodeBase64Unicode(item.title).trim(),
            description: this.decodeBase64Unicode(item.description).trim(),
        })) as EpgItem[];
    }

    /**
     * Decode base64 unicode string (used for EPG data)
     */
    private decodeBase64Unicode(str: string): string {
        try {
            return decodeURIComponent(
                Array.prototype.map
                    .call(atob(str), (c: string) => {
                        return (
                            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                        );
                    })
                    .join('')
            );
        } catch {
            return str;
        }
    }

    /**
     * Send request via IPC to avoid CORS issues
     */
    private async sendRequest<TResponse>(
        url: string,
        params: Record<string, string | number>,
        options?: XtreamRequestOptions
    ): Promise<TResponse> {
        const serializedParams: Record<string, string> = {};
        Object.entries(params).forEach(([key, value]) => {
            serializedParams[key] = String(value);
        });

        const response = (await this.dataService.sendIpcEvent(XTREAM_REQUEST, {
            url,
            params: serializedParams,
            requestId: options?.requestId,
            sessionId: options?.sessionId,
            suppressErrorLog: options?.suppressErrorLog,
        })) as {
            message?: string;
            payload?: unknown;
            type?: string;
        };

        // The IPC layer catches errors and returns { type: 'ERROR', message, status }
        // instead of rejecting. Convert that back into a thrown error so callers
        // can handle it with .catch() / try-catch.
        if (response?.type === 'ERROR' || (!response?.payload && response?.message)) {
            throw new Error(response?.message ?? 'Request failed');
        }

        return response?.payload as TResponse;
    }
}
