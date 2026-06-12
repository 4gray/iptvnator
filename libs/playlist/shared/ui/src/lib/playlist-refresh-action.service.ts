import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DialogService } from '@iptvnator/ui/components';
import {
    DataService,
    DatabaseService,
    type DbOperationEvent,
    isDbAbortError,
    PlaybackPositionService,
    PlaylistRefreshService,
    RuntimeCapabilitiesService,
    SettingsStore,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import { ChannelActions, PlaylistActions } from '@iptvnator/m3u-state';
import {
    ELECTRON_BRIDGE_SECURITY_ERROR_CODES,
    normalizeHost,
    parseSecurityPolicyError,
    PLAYLIST_UPDATE,
    PlaylistMeta,
} from '@iptvnator/shared/interfaces';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';

export interface XtreamRefreshPreparationState {
    playlistId: string;
    operationId: string;
    phase: string;
    current?: number;
    total?: number;
}

@Injectable({ providedIn: 'root' })
export class PlaylistRefreshActionService {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly dataService = inject(DataService);
    private readonly playbackPositionService = inject(PlaybackPositionService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );

    private readonly refreshPreparationState =
        signal<XtreamRefreshPreparationState | null>(null);

    readonly isRefreshing = signal(false);
    readonly refreshPreparation = this.refreshPreparationState.asReadonly();

    canRefresh(playlist: PlaylistMeta | null): boolean {
        if (!playlist) {
            return false;
        }

        if (playlist.serverUrl) {
            return this.runtime.supportsXtreamSqliteDataSource;
        }

        if (playlist.url) {
            return true;
        }

        return (
            this.runtime.supportsPlaylistRefresh && Boolean(playlist.filePath)
        );
    }

    refresh(playlist: PlaylistMeta): void {
        if (this.isRefreshing()) {
            return;
        }

        if (playlist.serverUrl && this.runtime.supportsXtreamSqliteDataSource) {
            this.refreshXtream(playlist);
        } else if (
            this.runtime.supportsPlaylistRefresh &&
            (playlist.url || playlist.filePath)
        ) {
            void this.refreshM3u(playlist);
        } else if (playlist.url) {
            this.dataService.sendIpcEvent(PLAYLIST_UPDATE, {
                id: playlist._id,
                title: playlist.title,
                url: playlist.url,
            });
        }
    }

    private refreshXtream(item: PlaylistMeta): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.MESSAGE'
            ),
            width: '400px',
            onConfirm: async () => {
                if (this.isRefreshing()) {
                    return;
                }

                this.isRefreshing.set(true);
                const operationId =
                    this.databaseService.createOperationId('xtream-refresh');
                this.refreshPreparationState.set({
                    playlistId: item._id,
                    operationId,
                    phase: 'collecting-user-data',
                });

                try {
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                        ),
                        undefined,
                        { duration: 2000 }
                    );
                    await this.waitForRefreshPreparationPaint();

                    const updateDate = Date.now();
                    const [restoreState, playbackPositions] = await Promise.all(
                        [
                            this.databaseService.deleteXtreamPlaylistContent(
                                item._id,
                                {
                                    operationId,
                                    onEvent: (event) =>
                                        this.updateRefreshPreparationFromEvent(
                                            item._id,
                                            operationId,
                                            event
                                        ),
                                }
                            ),
                            this.playbackPositionService.getAllPlaybackPositions(
                                item._id
                            ),
                            this.databaseService.updateXtreamPlaylistDetails({
                                id: item._id,
                                updateDate,
                            }),
                        ]
                    );

                    this.pendingRestoreService.set(item._id, {
                        ...restoreState,
                        playbackPositions,
                    });

                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({
                            playlist: { ...item, updateDate },
                        })
                    );

                    await this.router.navigate([
                        '/workspace',
                        'xtreams',
                        item._id,
                    ]);
                } catch (error) {
                    if (!isDbAbortError(error)) {
                        console.error(
                            'Error refreshing Xtream playlist:',
                            error
                        );
                        this.snackBar.open(
                            this.translate.instant(
                                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR'
                            ),
                            undefined,
                            { duration: 3000 }
                        );
                    }
                } finally {
                    this.clearRefreshPreparation(operationId);
                    this.isRefreshing.set(false);
                }
            },
        });
    }

    private async refreshM3u(item: PlaylistMeta): Promise<void> {
        const isActiveM3uRoute =
            this.playlistContext.routeProvider() === 'playlists' &&
            this.playlistContext.resolvedPlaylistId() === item._id;

        this.isRefreshing.set(true);
        if (isActiveM3uRoute) {
            this.store.dispatch(
                ChannelActions.setChannelsLoading({ loading: true })
            );
        }

        try {
            const refreshedPlaylist =
                await this.playlistRefreshService.refreshPlaylist({
                    operationId:
                        this.databaseService.createOperationId(
                            'playlist-refresh'
                        ),
                    playlistId: item._id,
                    title: item.title,
                    url: item.url,
                    filePath: item.filePath,
                    trustedInsecureTlsHosts:
                        this.settingsStore.getTrustOptions()
                            .trustedInsecureTlsHosts,
                });

            this.store.dispatch(
                PlaylistActions.updatePlaylist({
                    playlist: {
                        ...refreshedPlaylist,
                        _id: item._id,
                    },
                    playlistId: item._id,
                })
            );

            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                undefined,
                { duration: 2000 }
            );
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing playlist:', error);
                if (
                    item.url &&
                    this.handlePlaylistSecurityError(error, () =>
                        this.refresh(item)
                    )
                ) {
                    return;
                }
                this.snackBar.open(
                    this.getRefreshErrorMessage(error, item),
                    this.translate.instant('CLOSE'),
                    { duration: 5000 }
                );
            }
        } finally {
            if (isActiveM3uRoute) {
                this.store.dispatch(
                    ChannelActions.setChannelsLoading({ loading: false })
                );
            }
            this.isRefreshing.set(false);
        }
    }

    private getRefreshErrorMessage(error: unknown, item: PlaylistMeta): string {
        if (
            error instanceof Error &&
            error.message?.includes('ENOENT') &&
            item.filePath
        ) {
            return this.translate.instant(
                'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND'
            );
        }

        return this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR');
    }

    private handlePlaylistSecurityError(
        error: unknown,
        retry: () => void
    ): boolean {
        const securityError = parseSecurityPolicyError(error);
        if (
            securityError?.code !==
            ELECTRON_BRIDGE_SECURITY_ERROR_CODES.InvalidTlsCertificate
        ) {
            return false;
        }

        const ref = this.snackBar.open(
            this.translateWithFallback(
                'HOME.URL_UPLOAD.ERROR_INVALID_TLS',
                'Certificate for this playlist host is invalid.'
            ),
            this.translateWithFallback(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST',
                'Trust host'
            ),
            { duration: 10000 }
        );
        ref.onAction().subscribe(() => {
            this.confirmTrustPlaylistHost(securityError.host, retry);
        });
        return true;
    }

    private confirmTrustPlaylistHost(
        host: string | undefined,
        retry: () => void
    ): void {
        if (!host) {
            this.snackBar.open(
                this.translateWithFallback(
                    'HOME.URL_UPLOAD.ERROR_TLS_HOST_UNKNOWN',
                    'Could not determine the playlist host. Please retry manually.'
                ),
                this.translate.instant('CLOSE'),
                { duration: 5000 }
            );
            return;
        }

        this.dialogService.openConfirmDialog({
            title: this.translateWithFallback(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST_TITLE',
                'Trust invalid certificate?'
            ),
            message: this.translateWithFallback(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST_WARNING',
                'Only continue if you trust this playlist host. IPTVnator will allow invalid TLS certificates for this host, but other hosts still require valid certificates.'
            ),
            confirmLabel: this.translateWithFallback(
                'HOME.URL_UPLOAD.TRUST_TLS_HOST',
                'Trust host'
            ),
            width: '420px',
            onConfirm: () => {
                void this.trustPlaylistHost(host).then(retry);
            },
        });
    }

    private async trustPlaylistHost(host: string): Promise<void> {
        const settings = this.settingsStore.getSettings();
        const trustedHosts = new Set(
            (settings.trustedInsecureTlsHosts ?? []).map((item) =>
                normalizeHost(item)
            )
        );
        trustedHosts.add(normalizeHost(host));

        await this.settingsStore.updateSettings({
            trustedInsecureTlsHosts: Array.from(trustedHosts),
        });
    }

    private translateWithFallback(key: string, fallback: string): string {
        const translated = this.translate.instant(key);
        return translated === key ? fallback : translated;
    }

    private updateRefreshPreparationFromEvent(
        playlistId: string,
        operationId: string,
        event: DbOperationEvent
    ): void {
        if (event.operationId && event.operationId !== operationId) {
            return;
        }

        this.refreshPreparationState.update((current) => {
            if (!current || current.operationId !== operationId) {
                return current;
            }

            return {
                playlistId,
                operationId,
                phase: event.phase ?? current.phase,
                current: event.current ?? current.current,
                total: event.total ?? current.total,
            };
        });
    }

    private clearRefreshPreparation(operationId: string): void {
        this.refreshPreparationState.update((current) =>
            current?.operationId === operationId ? null : current
        );
    }

    private async waitForRefreshPreparationPaint(): Promise<void> {
        const minimumVisibleDelayMs = 120;

        // Give Angular a paint opportunity before small cached playlists can
        // finish cleanup and clear the preparation state.
        const resolveAfterDelay = (resolve: () => void): void => {
            setTimeout(resolve, minimumVisibleDelayMs);
        };

        if (typeof requestAnimationFrame !== 'function') {
            await new Promise<void>(resolveAfterDelay);
            return;
        }

        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolveAfterDelay(resolve));
        });
    }
}
