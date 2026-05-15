import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { DataService } from '@iptvnator/services';
import {
    ERROR,
    Playlist,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    STALKER_REQUEST,
    XtreamCodeActions,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
} from '@iptvnator/shared/interfaces';
import { AppConfig } from '../../environments/environment';
import {
    createPortalDebugErrorEvent,
    createPortalDebugRequestContext,
    createPortalDebugSuccessEvent,
    logPortalDebugEvent,
    logPortalDebugRequest,
} from '@iptvnator/portal/shared/util';

interface PwaXtreamResponse {
    readonly payload?: unknown;
    readonly status?: number;
}

interface PwaXtreamResult {
    readonly action: string;
    readonly payload: unknown;
    readonly type: typeof XTREAM_RESPONSE;
}

interface PwaErrorResult {
    readonly message: string;
    readonly status: number;
    readonly type: typeof ERROR;
}

interface ErrorStatus {
    readonly message?: string;
    readonly status?: number;
}

@Injectable({
    providedIn: 'root',
})
export class PwaService extends DataService {
    private messageListeners = new Map<string, EventListener>();
    private readonly http = inject(HttpClient);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly swUpdate = inject(SwUpdate);
    private readonly translateService = inject(TranslateService);
    private readonly silentXtreamActions = new Set<string>([
        XtreamCodeActions.GetAccountInfo,
        XtreamCodeActions.GetLiveCategories,
        XtreamCodeActions.GetVodCategories,
        XtreamCodeActions.GetSeriesCategories,
        XtreamCodeActions.GetShortEpg,
        XtreamCodeActions.GetSimpleDataTable,
        XtreamCodeActions.GetSimpleDateTable,
    ]);

    /** Proxy URL to avoid CORS issues */
    corsProxyUrl = AppConfig.BACKEND_URL;

    constructor() {
        super();
        console.log('PWA service initialized...');
    }

    /** Uses service worker mechanism to check for available application updates */
    checkUpdates() {
        this.swUpdate.versionUpdates.subscribe(() => {
            this.snackBar
                .open(
                    this.translateService.instant('UPDATE_AVAILABLE'),
                    this.translateService.instant('REFRESH')
                )
                .onAction()
                .subscribe(() => {
                    window.location.reload();
                });
        });
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    /**
     * Handles incoming IPC commands
     * @param type ipc command type
     * @param payload payload
     */
    sendIpcEvent<T = unknown>(type: string, payload?: unknown): T {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchFromUrl(payload);
            return undefined as T;
        }

        if (type === PLAYLIST_UPDATE) {
            this.refreshPlaylist(payload);
            return undefined as T;
        }

        if (type === XTREAM_REQUEST) {
            return this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            ) as T;
        }

        if (type === STALKER_REQUEST) {
            return this.forwardStalkerRequest(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            ) as T;
        }

        return undefined as T;
    }

    refreshPlaylist(payload: Partial<Playlist & { id: string }>) {
        this.getPlaylistFromUrl(payload.url)
            .pipe(
                catchError((error) => {
                    this.snackBar.open(
                        this.getPlaylistRefreshErrorMessage(error),
                        this.translateService.instant('CLOSE'),
                        {
                            duration: 5000,
                        }
                    );
                    return throwError(() => error);
                })
            )
            .subscribe((playlist: Playlist) => {
                this.store.dispatch(
                    PlaylistActions.updatePlaylist({
                        playlist,
                        playlistId: payload.id,
                    })
                );

                this.snackBar.open(
                    this.translateService.instant(
                        'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                    ),
                    null,
                    { duration: 2000 }
                );
            });
    }

    private getPlaylistRefreshErrorMessage(error: unknown): string {
        const statusCode =
            this.getErrorDetails(error)?.status ??
            this.extractHttpStatusCode(error);

        if (statusCode === 404) {
            return this.translateService.instant('HOME.URL_UPLOAD.ERROR_404');
        }
        if (statusCode === 403) {
            return this.translateService.instant('HOME.URL_UPLOAD.ERROR_403');
        }
        if (statusCode === 401) {
            return this.translateService.instant('HOME.URL_UPLOAD.ERROR_401');
        }
        return this.translateService.instant(
            'HOME.URL_UPLOAD.ERROR_FETCH_FAILED'
        );
    }

    /**
     * Fetches playlist from the specified url
     * @param payload playlist payload
     */
    fetchFromUrl(payload: Partial<Playlist>): void {
        const title = payload.title?.trim() || undefined;

        this.getPlaylistFromUrl(payload.url)
            .pipe(
                catchError((error) => {
                    this.snackBar.open(
                        this.getErrorMessageByStatusCode(error.status),
                        'Close',
                        {
                            duration: 5000,
                        }
                    );
                    return throwError(() => error);
                })
            )
            .subscribe((response: Playlist) => {
                const playlist = title
                    ? {
                          ...response,
                          filename: title,
                          title,
                      }
                    : response;

                this.store.dispatch(
                    PlaylistActions.handleAddingPlaylistByUrl({
                        isTemporary: !!payload?.isTemporary,
                        playlist,
                    })
                );
            });
    }

    getErrorMessageByStatusCode(status: number) {
        let messageKey = 'HOME.URL_UPLOAD.ERROR_FETCH_FAILED';
        switch (status) {
            case 413:
                return 'This file is too big. Use standalone or self-hosted version of the app.';
            case 403:
                messageKey = 'HOME.URL_UPLOAD.ERROR_403';
                break;
            case 404:
                messageKey = 'HOME.URL_UPLOAD.ERROR_404';
                break;
            case 401:
                messageKey = 'HOME.URL_UPLOAD.ERROR_401';
                break;
            default:
                break;
        }
        return this.translateService.instant(messageKey);
    }

    private extractHttpStatusCode(error: unknown): number | null {
        if (
            error &&
            typeof error === 'object' &&
            'status' in error &&
            typeof error.status === 'number'
        ) {
            return error.status;
        }

        const msg = String((error as { message?: string })?.message ?? error);
        const match = msg.match(/status code (\d{3})/);
        return match ? parseInt(match[1], 10) : null;
    }

    async forwardXtreamRequest(payload: {
        url: string;
        params: Record<string, string>;
        macAddress?: string;
        requestId?: string;
        sessionId?: string;
        suppressErrorLog?: boolean;
    }) {
        const headers = payload.macAddress
            ? {
                  headers: {
                      Cookie: `mac=${payload.macAddress}`,
                  },
              }
            : {};
        const requestPayload = {
            method: 'GET',
            url: `${this.corsProxyUrl}/xtream`,
            params: {
                url: payload.url,
                ...payload.params,
            },
            ...(payload.macAddress
                ? {
                      headers: {
                          Cookie: `mac=${payload.macAddress}`,
                      },
                  }
                : {}),
        };
        const context = createPortalDebugRequestContext({
            provider: 'xtream',
            operation: payload.params?.action ?? 'unknown',
            transport: 'pwa-http',
            request: requestPayload,
        });
        logPortalDebugRequest(context);

        try {
            let result: PwaErrorResult | PwaXtreamResult;
            const response = (await firstValueFrom(
                this.http.get<PwaXtreamResponse>(
                    `${this.corsProxyUrl}/xtream`,
                    {
                        params: {
                            url: payload.url,
                            ...payload.params,
                        },
                        ...headers,
                    }
                )
            )) as PwaXtreamResponse;

            if (!response.payload) {
                const action = payload.params.action;
                const isSilentAction =
                    payload.suppressErrorLog === true ||
                    this.silentXtreamActions.has(action);
                const normalizedMessage =
                    this.getReadableXtreamErrorMessage(response);
                logPortalDebugEvent(
                    createPortalDebugErrorEvent(context, response)
                );

                if (isSilentAction) {
                    console.log(
                        `Background Xtream action failed (${action ?? 'unknown'}):`,
                        normalizedMessage
                    );
                    return {
                        type: ERROR,
                        status: response.status ?? 500,
                        message: normalizedMessage,
                    };
                }

                result = {
                    type: ERROR,
                    status: response.status ?? 500,
                    message: normalizedMessage,
                };
                window.postMessage(result);
            } else {
                result = {
                    type: XTREAM_RESPONSE,
                    payload: response.payload,
                    action: payload.params.action,
                };
                logPortalDebugEvent(
                    createPortalDebugSuccessEvent(context, response)
                );
                window.postMessage(result);
            }
            return result;
        } catch (error: unknown) {
            logPortalDebugEvent(createPortalDebugErrorEvent(context, error));
            const action = payload.params.action;
            const isSilentAction =
                payload.suppressErrorLog === true ||
                this.silentXtreamActions.has(action);
            const normalizedMessage = this.getReadableXtreamErrorMessage(error);
            const errorInfo = this.getErrorDetails(error);

            // Log error to console
            if (isSilentAction) {
                console.log(
                    `Background Xtream action failed (${action ?? 'unknown'}):`,
                    normalizedMessage
                );
                return {
                    type: ERROR,
                    status: errorInfo?.status ?? 500,
                    message: normalizedMessage,
                };
            }

            console.error('Xtream request error:', normalizedMessage);
            this.snackBar.open(
                `Xtream request failed: ${normalizedMessage}`,
                'Close',
                {
                    duration: 5000,
                }
            );
            return {
                type: ERROR,
                status: errorInfo?.status ?? 500,
                message: normalizedMessage,
            };
        }
    }

    private getReadableXtreamErrorMessage(error: unknown): string {
        const fallback = 'Failed to connect to Xtream server';
        if (!error) {
            return fallback;
        }

        const maybeError = error as {
            message?: unknown;
            statusText?: unknown;
            error?: unknown;
        };

        if (typeof maybeError.message === 'string') {
            if (maybeError.message.includes('[object Object]')) {
                if (typeof maybeError.error === 'string') {
                    return maybeError.error;
                }
                if (
                    maybeError.error &&
                    typeof maybeError.error === 'object' &&
                    'message' in
                        (maybeError.error as Record<string, unknown>) &&
                    typeof (maybeError.error as Record<string, unknown>)
                        .message === 'string'
                ) {
                    return (maybeError.error as Record<string, string>).message;
                }
                return fallback;
            }
            return maybeError.message;
        }

        if (typeof maybeError.statusText === 'string') {
            return maybeError.statusText;
        }

        if (typeof error === 'string') {
            return error;
        }

        return fallback;
    }

    private getErrorDetails(error: unknown): ErrorStatus | null {
        if (error && typeof error === 'object') {
            return error as ErrorStatus;
        }
        return null;
    }

    async forwardStalkerRequest(payload: {
        url: string;
        params: Record<string, string>;
        macAddress: string;
    }) {
        const params = new URLSearchParams({
            url: payload.url,
            ...payload.params,
            macAddress: payload.macAddress,
        });
        const requestUrl = `${this.corsProxyUrl}/stalker?${params.toString()}`;
        const context = createPortalDebugRequestContext({
            provider: 'stalker',
            operation: payload.params?.action ?? 'unknown',
            transport: 'pwa-http',
            request: {
                method: 'GET',
                url: requestUrl,
                params: {
                    url: payload.url,
                    ...payload.params,
                    macAddress: payload.macAddress,
                },
            },
        });
        logPortalDebugRequest(context);

        try {
            // Make the fetch request
            const response = await fetch(requestUrl);

            if (!response.ok) {
                throw new Error(
                    `Error: ${response.statusText} (Status: ${response.status})`
                );
            }

            // Parse and return the JSON response
            const responseBody = await response.json();
            logPortalDebugEvent(
                createPortalDebugSuccessEvent(context, responseBody)
            );
            return responseBody.payload;
        } catch (err: unknown) {
            const errorInfo = this.getErrorDetails(err);
            logPortalDebugEvent(createPortalDebugErrorEvent(context, err));
            console.error('Stalker request error:', err);

            this.snackBar.open(
                `Error: ${errorInfo?.message ?? ' Not found'}, status: ${errorInfo?.status ?? 404}`,
                'Close',
                {
                    duration: 5000,
                }
            );
            throw err;
        }
    }

    getPlaylistFromUrl(url: string) {
        return this.http.get(`${this.corsProxyUrl}/parse`, {
            params: { url },
        });
    }

    removeAllListeners(type: string): void {
        if (type === 'all') {
            this.messageListeners.forEach((listener) =>
                window.removeEventListener('message', listener)
            );
            this.messageListeners.clear();
            return;
        }

        const messageListener = this.messageListeners.get(type);
        if (messageListener) {
            window.removeEventListener('message', messageListener);
            this.messageListeners.delete(type);
        }
    }

    listenOn(command: string, callback: (...args: unknown[]) => void): void {
        // Drop any existing listener for this command so calling listenOn()
        // again rebinds rather than accumulating duplicates.
        const existing = this.messageListeners.get(command);
        if (existing) {
            window.removeEventListener('message', existing);
        }

        const listener = callback as EventListener;
        window.addEventListener('message', listener);
        this.messageListeners.set(command, listener);
    }

    getAppEnvironment(): string {
        return 'pwa';
    }
}
