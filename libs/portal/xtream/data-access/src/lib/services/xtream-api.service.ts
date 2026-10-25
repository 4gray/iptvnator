import { XtreamEpgNormalizer, EpgResponse } from '../xtream-epg-normalizer';
import { inject, Injectable } from '@angular/core';
import { DataService } from '@iptvnator/services';
import { createLogger } from '@iptvnator/portal/shared/util/logger';
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
    normalizeXtreamServerUrl,
} from '@iptvnator/shared/interfaces';
import { XtreamAccountInfo } from '../account-info/account-info.interface';

/**
 * Xtream API credentials
 */
export interface XtreamCredentials {
    userAgent?: string;
    allowedOutputFormats?: string[];
    serverUrl: string;
    username: string;
    password: string;
    /**
     * The panel's timezone as persisted from its account info
     * (`resolveXtreamServerTimezone`); lets EPG `start`/`end` strings that
     * arrive without `start_timestamp` be read in the clock the panel wrote
     * them in instead of the viewer's.
     */
    serverTimezone?: string;
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

export interface XtreamVodCatalogRequestOptions extends XtreamRequestOptions {
    categoryId?: string | number;
}

const XTREAM_ACCOUNT_ACTIONS = [
    XtreamCodeActions.GetAccountInfo,
    null,
    'get_profile',
] as const;

/**
 * Service for all Xtream Codes API interactions.
 * Extracts API communication logic from the XtreamStore.
 */
@Injectable({ providedIn: 'root' })
export class XtreamApiService extends XtreamEpgNormalizer {
    private readonly dataService = inject(DataService);
    private readonly logger = createLogger('XtreamApiService');

    async cancelSession(sessionId: string): Promise<boolean> {
        if (
            !sessionId ||
            typeof window.electron?.xtreamCancelSession !== 'function'
        ) {
            return false;
        }

        try {
            const result = await window.electron.xtreamCancelSession(sessionId);
            return result.success;
        } catch (error) {
            this.logger.error('Failed to cancel Xtream session:', error);
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
        let lastError: unknown;
        let lastResponse: XtreamAccountInfo | null = null;

        for (const action of XTREAM_ACCOUNT_ACTIONS) {
            try {
                const response = await this.sendRequest<XtreamAccountInfo>(
                    credentials,
                    {
                        ...(action ? { action } : {}),
                        username: credentials.username,
                        password: credentials.password,
                    },
                    options
                );

                if (this.hasAccountInfoPayload(response)) {
                    return response;
                }

                lastResponse = response;
            } catch (error) {
                lastError = error;
            }
        }

        if (lastResponse) {
            return lastResponse;
        }

        throw lastError instanceof Error
            ? lastError
            : new Error('Failed to fetch Xtream account info');
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
            credentials,
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
            credentials,
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
        options?: XtreamVodCatalogRequestOptions
    ): Promise<XtreamVodStream[]> {
        const response = await this.sendRequest(
            credentials,
            {
                action: XtreamCodeActions.GetVodStreams,
                username: credentials.username,
                password: credentials.password,
                ...(options?.categoryId !== undefined
                    ? { category_id: options.categoryId }
                    : {}),
            },
            options
        );

        return Array.isArray(response) ? response : [];
    }

    async getVodStream(
        credentials: XtreamCredentials,
        vodId: string | number,
        categoryId: string | number,
        options?: XtreamRequestOptions
    ): Promise<XtreamVodStream | null> {
        const streams = await this.getVodStreams(credentials, {
            ...options,
            categoryId,
        });

        return (
            streams.find(
                (stream) => Number(stream.stream_id) === Number(vodId)
            ) ?? null
        );
    }

    /**
     * Get series items
     */
    async getSeriesStreams(
        credentials: XtreamCredentials,
        options?: XtreamRequestOptions
    ): Promise<XtreamSerieItem[]> {
        const response = await this.sendRequest(
            credentials,
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
            credentials,
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
            credentials,
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
            credentials,
            {
                action: XtreamCodeActions.GetShortEpg,
                username: credentials.username,
                password: credentials.password,
                stream_id: streamId,
                limit,
            },
            options
        );

        return this.normalizeShortEpgItems(
            response,
            credentials.serverTimezone
        );
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
                credentials,
                {
                    action: XtreamCodeActions.GetSimpleDataTable,
                    username: credentials.username,
                    password: credentials.password,
                    stream_id: streamId,
                },
                options
            );
            const items = this.normalizeFullEpgItems(
                response,
                credentials.serverTimezone
            );
            if (items.length > 0) {
                return items;
            }
        } catch {
            // Fall back to the legacy typo endpoint below.
        }

        const fallbackResponse: EpgResponse = await this.sendRequest(
            credentials,
            {
                action: XtreamCodeActions.GetSimpleDateTable,
                username: credentials.username,
                password: credentials.password,
                stream_id: streamId,
            },
            options
        );

        return this.normalizeFullEpgItems(
            fallbackResponse,
            credentials.serverTimezone
        );
    }

    /**
     * Send request via IPC to avoid CORS issues
     */
    private async sendRequest<TResponse>(
        credentials: XtreamCredentials,
        params: Record<string, string | number>,
        options?: XtreamRequestOptions
    ): Promise<TResponse> {
        const normalizedUrl = normalizeXtreamServerUrl(credentials.serverUrl);
        const serializedParams: Record<string, string> = {};
        Object.entries(params).forEach(([key, value]) => {
            const serializedValue = String(value);
            serializedParams[key] =
                key === 'username' || key === 'password'
                    ? serializedValue.trim()
                    : serializedValue;
        });

        const response = (await this.dataService.sendIpcEvent(XTREAM_REQUEST, {
            url: normalizedUrl,
            ...(credentials.userAgent?.trim()
                ? { userAgent: credentials.userAgent.trim() }
                : {}),
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
        if (
            response?.type === 'ERROR' ||
            (!response?.payload && response?.message)
        ) {
            throw new Error(response?.message ?? 'Request failed');
        }

        return response?.payload as TResponse;
    }

    private hasAccountInfoPayload(
        response: XtreamAccountInfo | null | undefined
    ): boolean {
        return Boolean(response?.user_info);
    }
}
