import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DialogService } from 'components';
import {
    DatabaseService,
    isDbAbortError,
    PlaylistRefreshService,
} from 'services';
import { ChannelActions, PlaylistActions } from 'm3u-state';
import { PlaylistMeta } from 'shared-interfaces';
import { PlaylistContextFacade } from './playlist-context.facade';

@Injectable({ providedIn: 'root' })
export class PlaylistRefreshActionService {
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly dialogService = inject(DialogService);
    private readonly databaseService = inject(DatabaseService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly playlistContext = inject(PlaylistContextFacade);

    readonly isRefreshing = signal(false);

    canRefresh(playlist: PlaylistMeta | null): boolean {
        if (!playlist || !window.electron) {
            return false;
        }

        return Boolean(
            playlist.serverUrl || playlist.url || playlist.filePath
        );
    }

    refresh(playlist: PlaylistMeta): void {
        if (this.isRefreshing()) {
            return;
        }

        if (playlist.serverUrl) {
            this.refreshXtream(playlist);
        } else if (playlist.url || playlist.filePath) {
            void this.refreshM3u(playlist);
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
            onConfirm: async () => {
                if (this.isRefreshing()) {
                    return;
                }

                this.isRefreshing.set(true);
                const operationId =
                    this.databaseService.createOperationId('xtream-refresh');

                try {
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                        ),
                        undefined,
                        { duration: 2000 }
                    );

                    const updateDate = Date.now();
                    const [
                        {
                            favoritedXtreamIds,
                            recentlyViewedXtreamIds,
                            hiddenCategories,
                        },
                    ] = await Promise.all([
                        this.databaseService.deleteXtreamPlaylistContent(
                            item._id,
                            { operationId }
                        ),
                        this.databaseService.updateXtreamPlaylistDetails({
                            id: item._id,
                            updateDate,
                        }),
                    ]);

                    const restoreKey = `xtream-restore-${item._id}`;
                    const restorePayload = {
                        favoritedXtreamIds,
                        recentlyViewedXtreamIds,
                        hiddenCategories,
                    };
                    localStorage.setItem(
                        restoreKey,
                        JSON.stringify(restorePayload)
                    );

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
                this.snackBar.open(
                    this.getRefreshErrorMessage(error, item),
                    this.translate.instant('CLOSE'),
                    { duration: 5000 }
                );
            }

            if (isActiveM3uRoute) {
                this.store.dispatch(
                    ChannelActions.setChannelsLoading({ loading: false })
                );
            }
        } finally {
            this.isRefreshing.set(false);
        }
    }

    private getRefreshErrorMessage(
        error: unknown,
        item: PlaylistMeta
    ): string {
        if (
            error instanceof Error &&
            error.message?.includes('ENOENT') &&
            item.filePath
        ) {
            return this.translate.instant(
                'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND'
            );
        }

        return this.translate.instant(
            'HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR'
        );
    }
}
