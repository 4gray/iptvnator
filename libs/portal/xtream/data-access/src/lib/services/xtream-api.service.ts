import type { EpgResponse } from '../xtream-epg-normalizer';
import { inject, Injectable } from '@angular/core';
import { EpgPreferencesService, DataService } from '@iptvnator/services';
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
    /**
     * The playlist's playback-only headers (its `referrer` and `origin`).
     * The JSON API ignores them; stream probes send them the way playback
     * does, so a panel that requires them is not judged unreachable.
     */
    referrer?: string;
    origin?: string;
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
    signal?: AbortSignal;
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

async function loadEpgNormalizer(signal?: AbortSignal) {
    const { XtreamEpgNormalizer } = await import('../xtream-epg-normalizer');
    signal?.throwIfAborted();
    return new XtreamEpgNormalizer();
}

/** Service for all Xtream Codes API interactions. */
@Injectable({ providedIn: 'root' })
export class XtreamApiService {
    private readonly dataService = inject(DataService);
    private readonly epgPreferences = inject(EpgPreferencesService);
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
                    action ? { action } : {},
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
            { action: actionMap[type] },
            options
        );

        if (!Array.isArray(response)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response;
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
            { action: XtreamCodeActions.GetLiveStreams },
            options
        );

        if (!Array.isArray(response)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response;
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
                ...(options?.categoryId !== undefined
                    ? { category_id: options.categoryId }
                    : {}),
            },
            options
        );

        if (!Array.isArray(response)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response;
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
            { action: XtreamCodeActions.GetSeries },
            options
        );

        if (!Array.isArray(response)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response;
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
                stream_id: streamId,
                limit,
            },
            options
        );

        return (
            await loadEpgNormalizer(options?.signal)
        ).normalizeShortEpgItems(response, credentials.serverTimezone);
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
        const fetchSchedule = async (action: XtreamCodeActions) => {
            const response = await this.sendRequest<EpgResponse | []>(
                credentials,
                { action, stream_id: streamId },
                options
            );
            return (
                await loadEpgNormalizer(options?.signal)
            ).normalizeFullEpgItems(response, credentials.serverTimezone);
        };
        const unsupported = (status?: number) =>
            status === 404 || status === 405 || status === 501;
        let primaryError: { status?: number } | null | undefined;
        const primary = await fetchSchedule(
            XtreamCodeActions.GetSimpleDataTable
        ).catch((error: { status?: number } | null) => {
            primaryError = error;
        });
        if (primary?.length) return primary;
        const legacy = await fetchSchedule(
            XtreamCodeActions.GetSimpleDateTable
        ).catch((error: { status?: number } | null) => {
            options?.signal?.throwIfAborted();
            if (unsupported(error?.status)) {
                if (primary || unsupported(primaryError?.status))
                    return primary ?? [];
                throw primaryError;
            }
            throw error;
        });
        if (!legacy.length && !primary && !unsupported(primaryError?.status))
            throw primaryError;
        return legacy;
    }

    /**
     * Send request via IPC to avoid CORS issues
     */
    private async sendRequest<TResponse>(
        credentials: XtreamCredentials,
        params: Record<string, string | number>,
        {
            signal,
            requestId,
            sessionId,
            suppressErrorLog,
        }: XtreamRequestOptions = {}
    ): Promise<TResponse> {
        signal?.throwIfAborted();
        const normalizedUrl = normalizeXtreamServerUrl(credentials.serverUrl);
        const userAgent = credentials.userAgent?.trim();
        const serializedParams: Record<string, string> = {
            username: credentials.username.trim(),
            password: credentials.password.trim(),
        };
        for (const [key, value] of Object.entries(params)) {
            serializedParams[key] = String(value);
        }

        const request = async () => {
            signal?.throwIfAborted();
            return this.dataService.sendIpcEvent(
                XTREAM_REQUEST,
                {
                    url: normalizedUrl,
                    ...(userAgent && { userAgent }),
                    params: serializedParams,
                    requestId,
                    sessionId,
                    suppressErrorLog,
                },
                ...(signal ? ([signal] as const) : [])
            );
        };
        const isEpg = [
            XtreamCodeActions.GetShortEpg,
            XtreamCodeActions.GetSimpleDataTable,
            XtreamCodeActions.GetSimpleDateTable,
        ].includes(params['action'] as XtreamCodeActions);
        const response = (await (isEpg
            ? this.epgPreferences.run<unknown>(request, {
                  payload: { epg_listings: [] },
              })
            : request())) as {
            code?: string;
            message?: string;
            payload?: unknown;
            status?: number;
            type?: string;
        };
        signal?.throwIfAborted();

        // The IPC layer catches errors and returns { type: 'ERROR', message, status }
        // instead of rejecting. Convert that back into a thrown error so callers
        // can handle it with .catch() / try-catch.
        if (
            response?.type === 'ERROR' ||
            (!response?.payload && response?.message)
        ) {
            throw Object.assign(
                new Error(response?.message ?? 'Request failed'),
                {
                    code: response?.code,
                    status: response?.status,
                }
            );
        }

        return response?.payload as TResponse;
    }

    private hasAccountInfoPayload(
        response: XtreamAccountInfo | null | undefined
    ): boolean {
        return Boolean(response?.user_info);
    }
}
