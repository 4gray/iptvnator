import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { DataService } from '@iptvnator/services';
import {
    AUTO_UPDATE_PLAYLISTS,
    ERROR,
    Playlist,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_UPDATE,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
    XtreamCodeActions,
} from '@iptvnator/shared/interfaces';
import { AppConfig } from '../../environments/environment';
import {
    createPortalDebugRequestContext,
    logPortalDebugEvent,
} from '@iptvnator/portal/shared/util';

interface PlayerLaunchPayload {
    readonly headers?: Record<string, string>;
    readonly origin?: string;
    readonly referer?: string;
    readonly startTime?: number;
    readonly thumbnail?: string;
    readonly title?: string;
    readonly url: string;
    readonly ['user-agent']?: string;
    readonly contentInfo?: unknown;
}

interface ErrorStatus {
    readonly message?: string;
    readonly status?: number;
}

@Injectable({
    providedIn: 'root',
})
export class ElectronService extends DataService {
    private eventListeners: { [key: string]: () => void } = {};
    private messageListeners = new Map<string, EventListener>();
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
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

    constructor() {
        super();
        console.log('Electron service initialized...');
        this.setupPlayerErrorListener();
        this.setupPortalDebugListener();
    }

    private setupPlayerErrorListener() {
        // Listen for player errors from the backend
        if (window.electron?.onPlayerError) {
            window.electron.onPlayerError(
                (data: {
                    player: string;
                    error: string;
                    originalError: string;
                }) => {
                    console.error(`${data.player} Error:`, data.originalError);
                    this.snackBar.open(
                        `${data.player} Error: ${data.error}`,
                        'Close',
                        {
                            duration: 7000,
                            panelClass: ['error-snackbar'],
                        }
                    );
                }
            );
        }
    }

    private setupPortalDebugListener() {
        const onPortalDebugEvent = (
            window.electron as {
                onPortalDebugEvent?: (
                    callback: (
                        event: Parameters<typeof logPortalDebugEvent>[0]
                    ) => void
                ) => void;
            }
        ).onPortalDebugEvent;

        if (AppConfig.production || !onPortalDebugEvent) {
            return;
        }

        onPortalDebugEvent((event) => {
            logPortalDebugEvent(
                event as Parameters<typeof logPortalDebugEvent>[0]
            );
        });
    }

    getAppVersion(): string {
        return AppConfig.version;
    }

    async sendIpcEvent<T = unknown>(
        type: string,
        payload?: unknown
    ): Promise<T> {
        if (type === PLAYLIST_PARSE_BY_URL) {
            this.fetchM3uPlaylistFromUrl(payload);
            return undefined as T;
        }

        if (type === PLAYLIST_UPDATE) {
            this.updateM3uPlaylistFromFile(
                payload as {
                    id: string;
                    filePath?: string;
                    url?: string;
                    title: string;
                }
            );
            return undefined as T;
        }

        if (type === XTREAM_REQUEST) {
            return (await this.forwardXtreamRequest(
                payload as { url: string; params: Record<string, string> }
            )) as T;
        }

        if (type === 'STALKER_REQUEST') {
            return (await this.fetchStalkerData(
                payload as {
                    url: string;
                    macAddress: string;
                    params: Record<string, string>;
                }
            )) as T;
        }

        if (type === 'OPEN_MPV_PLAYER') {
            const data = payload as PlayerLaunchPayload;
            try {
                return (await window.electron.openInMpv(
                    data.url,
                    data.title ?? '',
                    data.thumbnail ?? '',
                    data['user-agent'] ?? undefined,
                    data.referer ?? undefined,
                    data.origin ?? undefined,
                    data.contentInfo,
                    data.startTime,
                    data.headers ?? undefined
                )) as T;
            } catch (error: unknown) {
                const errorMessage =
                    this.getErrorDetails(error)?.message ?? String(error);
                this.snackBar.open(
                    `Error launching MPV: ${errorMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
                console.error('MPV launch error:', error);
                throw error;
            }
        }

        if (type === 'OPEN_VLC_PLAYER') {
            const data = payload as PlayerLaunchPayload;
            try {
                return (await window.electron.openInVlc(
                    data.url,
                    data.title ?? '',
                    data.thumbnail ?? '',
                    data['user-agent'] ?? undefined,
                    data.referer ?? undefined,
                    data.origin ?? undefined,
                    data.contentInfo,
                    data.startTime,
                    data.headers ?? undefined
                )) as T;
            } catch (error: unknown) {
                const errorMessage =
                    this.getErrorDetails(error)?.message ?? String(error);
                this.snackBar.open(
                    `Error launching VLC: ${errorMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
                console.error('VLC launch error:', error);
                throw error;
            }
        }

        if (type === AUTO_UPDATE_PLAYLISTS) {
            const data = payload as Playlist[];
            const playlists = await window.electron.autoUpdatePlaylists(data);
            this.store.dispatch(
                PlaylistActions.updateManyPlaylists({
                    playlists,
                })
            );
            this.snackBar.open(
                this.translateService.instant(
                    'HOME.PLAYLISTS.AUTO_REFRESH_UPDATE_SUCCESS'
                ),
                null,
                { duration: 2000 }
            );
            return playlists as T;
        }

        console.log('Unknown type', type);
        return undefined as T;
    }

    private async fetchStalkerData(payload: {
        url: string;
        macAddress: string;
        params: Record<string, string>;
        requestId?: string;
        token?: string;
        serialNumber?: string;
    }) {
        const context = createPortalDebugRequestContext({
            provider: 'stalker',
            operation: payload.params?.action ?? 'unknown',
            transport: 'electron-renderer',
            request: payload,
        });

        try {
            // Use Electron IPC to make the Stalker request
            const response = await window.electron.stalkerRequest({
                ...payload,
                requestId: context.requestId,
            });
            return response;
        } catch (err: unknown) {
            const errorInfo = this.getErrorDetails(err);
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

    private async fetchM3uPlaylistFromUrl(payload: Partial<Playlist>) {
        const title = payload.title?.trim() || undefined;

        window.electron
            .fetchPlaylistByUrl(payload.url, title)
            .then((result) => {
                this.store.dispatch(
                    PlaylistActions.handleAddingPlaylistByUrl({
                        isTemporary: !!payload?.isTemporary,
                        playlist: result,
                    })
                );
            })
            .catch((error: unknown) => {
                const statusCode = this.extractHttpStatusCode(error);
                let messageKey = 'HOME.URL_UPLOAD.ERROR_FETCH_FAILED';
                if (statusCode === 403) {
                    messageKey = 'HOME.URL_UPLOAD.ERROR_403';
                } else if (statusCode === 404) {
                    messageKey = 'HOME.URL_UPLOAD.ERROR_404';
                } else if (statusCode === 401) {
                    messageKey = 'HOME.URL_UPLOAD.ERROR_401';
                }
                this.snackBar.open(
                    this.translateService.instant(messageKey),
                    this.translateService.instant('CLOSE'),
                    { duration: 5000 }
                );
            });
    }

    private extractHttpStatusCode(error: unknown): number | null {
        if (
            error &&
            typeof error === 'object' &&
            'response' in error &&
            error.response &&
            typeof error.response === 'object' &&
            'status' in error.response
        ) {
            return error.response.status as number;
        }
        // Parse status from error message string (IPC serialization)
        const msg = String((error as { message?: string })?.message ?? error);
        const match = msg.match(/status code (\d{3})/);
        return match ? parseInt(match[1], 10) : null;
    }

    private async updateM3uPlaylistFromFile(data: {
        id: string;
        url?: string;
        filePath?: string;
        title: string;
    }) {
        try {
            let playlistObject: Playlist;
            if (data.url && !data.filePath) {
                playlistObject = await window.electron.fetchPlaylistByUrl(
                    data.url,
                    data.title
                );
            } else if (data.filePath && !data.url) {
                playlistObject =
                    await window.electron.updatePlaylistFromFilePath(
                        data.filePath,
                        data.title
                    );
            } else {
                console.error(
                    'Either url or filePath must be provided, but not both.'
                );
                return;
            }

            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: {
                        ...playlistObject,
                        _id: data.id,
                    },
                    playlistId: data.id,
                })
            );

            this.snackBar.open(
                this.translateService.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                null,
                { duration: 2000 }
            );
        } catch (error: unknown) {
            console.error('Playlist refresh error:', error);
            this.snackBar.open(
                this.getPlaylistRefreshErrorMessage(error, data),
                this.translateService.instant('CLOSE'),
                { duration: 5000 }
            );
        }
    }

    private getPlaylistRefreshErrorMessage(
        error: unknown,
        data: { url?: string; filePath?: string }
    ): string {
        if (data.filePath) {
            const errorMessage = String(
                this.getErrorDetails(error)?.message ?? error ?? ''
            );

            if (
                /(ENOENT|no such file or directory|not found)/i.test(
                    errorMessage
                )
            ) {
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND',
                    'Playlist refresh failed. The local file is no longer available. Check the file path or re-import the playlist.'
                );
            }

            if (/(EACCES|EPERM|permission denied)/i.test(errorMessage)) {
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_ACCESS_ERROR',
                    'Playlist refresh failed. The app can no longer access the local file.'
                );
            }

            return this.translateService.instant(
                'HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR'
            );
        }

        const statusCode = this.extractHttpStatusCode(error);
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

    private translateWithFallback(key: string, fallback: string): string {
        const translated = this.translateService.instant(key);
        return translated === key ? fallback : translated;
    }

    /* private getErrorMessageByStatusCode(status: number) {
        let message = 'Something went wrong';
        switch (status) {
            case 0:
                message = 'The backend is not reachable';
                break;
            case 413:
                message =
                    'This file is too big. Use standalone or self-hosted version of the app.';
                break;
            default:
                break;
        }
        return message;
    } */

    private async forwardXtreamRequest(payload: {
        url: string;
        params: Record<string, string>;
        requestId?: string;
        sessionId?: string;
        suppressErrorLog?: boolean;
    }) {
        const context = createPortalDebugRequestContext({
            provider: 'xtream',
            operation: payload.params?.action ?? 'unknown',
            transport: 'electron-renderer',
            request: payload,
        });

        try {
            // Use Electron IPC to make the Xtream request
            const response = await window.electron.xtreamRequest({
                ...payload,
                requestId: context.requestId,
            });

            const result = {
                type: XTREAM_RESPONSE,
                payload: response.payload,
                action: response.action,
            };
            window.postMessage(result);
            return result;
        } catch (error: unknown) {
            const action = payload.params?.action;
            const isSilentAction =
                payload.suppressErrorLog === true ||
                (action ? this.silentXtreamActions.has(action) : false);
            const normalizedMessage = this.getReadableXtreamErrorMessage(error);
            const errorInfo = this.getErrorDetails(error);

            // Log error to console
            if (isSilentAction) {
                console.log(
                    `Background Xtream action failed (${action ?? 'unknown'}):`,
                    normalizedMessage
                );
            } else {
                console.error('Xtream request error:', normalizedMessage);
            }

            // Only show snackbar for user-triggered Xtream requests
            if (!isSilentAction) {
                this.snackBar.open(
                    `Xtream request failed: ${normalizedMessage}`,
                    'Close',
                    {
                        duration: 5000,
                    }
                );
            }

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
            status?: unknown;
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

    removeAllListeners(type: string): void {
        if (type === 'all') {
            // Unsubscribe from all event listeners
            Object.values(this.eventListeners).forEach((unsubscribe) =>
                unsubscribe()
            );
            this.eventListeners = {};
            // Remove all tracked window message listeners
            this.messageListeners.forEach((listener) =>
                window.removeEventListener('message', listener)
            );
            this.messageListeners.clear();
            return;
        }

        if (this.eventListeners[type]) {
            // Unsubscribe from a specific event
            this.eventListeners[type]();
            delete this.eventListeners[type];
        }

        // Remove the window message listener registered for this command
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
        return 'electron';
    }
}
