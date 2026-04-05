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
    id?: string;
    epg_id?: string;
    title?: string;
    description?: string;
    start?: string;
    end?: string;
    stop?: string;
    start_timestamp?: string;
    stop_timestamp?: string;
    channel_id?: string;
    lang?: string;
    [key: string]: unknown;
}

/**
 * EPG API response
 */
interface EpgResponse {
    epg_listings?: RawEpgListing[] | Record<string, RawEpgListing>;
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

        return this.normalizeShortEpgItems(response);
    }

    /**
     * Get the full EPG schedule for a stream.
     * Uses the documented endpoint with a fallback for older typoed panels.
     */
    async getFullEpg(
        credentials: XtreamCredentials,
        streamId: number,
        options?: XtreamRequestOptions
    ): Promise<EpgItem[]> {
        try {
            const response: EpgResponse = await this.sendRequest(
                credentials.serverUrl,
                {
                    action: XtreamCodeActions.GetSimpleDataTable,
                    username: credentials.username,
                    password: credentials.password,
                    stream_id: streamId,
                },
                options
            );
            const items = this.normalizeFullEpgItems(response);
            if (items.length > 0) {
                return items;
            }
        } catch {
            // Fall back to the legacy typo endpoint below.
        }

        const fallbackResponse: EpgResponse = await this.sendRequest(
            credentials.serverUrl,
            {
                action: XtreamCodeActions.GetSimpleDateTable,
                username: credentials.username,
                password: credentials.password,
                stream_id: streamId,
            },
            options
        );

        return this.normalizeFullEpgItems(fallbackResponse);
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

    private getEpgListings(response: EpgResponse | null | undefined): RawEpgListing[] {
        const listings = response?.epg_listings;
        if (!listings) {
            return [];
        }

        if (Array.isArray(listings)) {
            return listings;
        }

        return Object.values(listings);
    }

    private normalizeShortEpgItems(response: EpgResponse): EpgItem[] {
        return this.getEpgListings(response)
            .map((item, index) => {
                const startTimestamp = this.parseUnixTimestamp(
                    item.start_timestamp
                );
                const stopTimestamp = this.parseUnixTimestamp(
                    item.stop_timestamp
                );
                const normalizedStart =
                    this.toIsoString(startTimestamp) ??
                    this.normalizeDateString(item.start);
                const normalizedStop =
                    this.toIsoString(stopTimestamp) ??
                    this.normalizeDateString(item.stop ?? item.end);

                return {
                    id: String(item.id ?? index),
                    epg_id: String(item.epg_id ?? ''),
                    title: this.decodeBase64Unicode(
                        String(item.title ?? '')
                    ).trim(),
                    description: this.decodeBase64Unicode(
                        String(item.description ?? '')
                    ).trim(),
                    lang: String(item.lang ?? ''),
                    start: normalizedStart,
                    end: normalizedStop,
                    stop: normalizedStop,
                    channel_id: String(item.channel_id ?? ''),
                    start_timestamp: String(startTimestamp ?? ''),
                    stop_timestamp: String(stopTimestamp ?? ''),
                } satisfies EpgItem;
            })
            .filter((item) => Boolean(item.start) && Boolean(item.stop))
            .sort(
                (left, right) =>
                    this.getEpgItemTimestampMs(left.start, left.start_timestamp) -
                    this.getEpgItemTimestampMs(
                        right.start,
                        right.start_timestamp
                    )
            );
    }

    private normalizeFullEpgItems(response: EpgResponse): EpgItem[] {
        return this.getEpgListings(response)
            .map((item, index) => {
                const startTimestamp = this.parseUnixTimestamp(
                    item.start_timestamp
                );
                const stopTimestamp = this.parseUnixTimestamp(
                    item.stop_timestamp
                );
                const normalizedStart =
                    this.toIsoString(startTimestamp) ??
                    this.normalizeDateString(item.start);
                const normalizedStop =
                    this.toIsoString(stopTimestamp) ??
                    this.normalizeDateString(item.stop ?? item.end);

                return {
                    id: String(item.id ?? index),
                    epg_id: String(item.epg_id ?? item.channel_id ?? ''),
                    title: this.decodeBase64Unicode(
                        String(item.title ?? '')
                    ).trim(),
                    description: this.decodeBase64Unicode(
                        String(item.description ?? '')
                    ).trim(),
                    lang: String(item.lang ?? ''),
                    start: normalizedStart,
                    end: normalizedStop,
                    stop: normalizedStop,
                    channel_id: String(item.channel_id ?? ''),
                    start_timestamp: String(startTimestamp ?? ''),
                    stop_timestamp: String(stopTimestamp ?? ''),
                } satisfies EpgItem;
            })
            .filter((item) => Boolean(item.start) && Boolean(item.stop))
            .sort(
                (left, right) =>
                    this.getEpgItemTimestampMs(left.start, left.start_timestamp) -
                    this.getEpgItemTimestampMs(
                        right.start,
                        right.start_timestamp
                    )
            );
    }

    private parseUnixTimestamp(value: unknown): number | null {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    private toIsoString(timestamp: number | null): string | null {
        return timestamp ? new Date(timestamp * 1000).toISOString() : null;
    }

    private normalizeDateString(value: unknown): string {
        const rawValue = String(value ?? '').trim();
        if (!rawValue) {
            return '';
        }

        const parsed = Date.parse(rawValue.replace(' ', 'T'));
        return Number.isFinite(parsed)
            ? new Date(parsed).toISOString()
            : rawValue;
    }

    private getEpgItemTimestampMs(
        isoValue: string,
        unixTimestampValue: string
    ): number {
        const unixTimestamp = this.parseUnixTimestamp(unixTimestampValue);
        if (unixTimestamp) {
            return unixTimestamp * 1000;
        }

        return Date.parse(isoValue);
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
