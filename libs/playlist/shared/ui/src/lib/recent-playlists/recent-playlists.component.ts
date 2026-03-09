import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import { AsyncPipe } from '@angular/common';
import { Component, effect, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    PlaylistActions,
    selectActivePlaylistId,
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { DialogService } from 'components';
import { DatabaseService, DataService, SortBy, SortService } from 'services';
import { PLAYLIST_UPDATE, PlaylistMeta } from 'shared-interfaces';
import { PlaylistType } from '../add-playlist-menu/add-playlist-menu.component';
import { EmptyStateComponent } from './empty-state/empty-state.component';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistItemComponent } from './playlist-item/playlist-item.component';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
    imports: [
        AsyncPipe,
        DragDropModule,
        EmptyStateComponent,
        MatInputModule,
        MatListModule,
        NgxSkeletonLoaderComponent,
        PlaylistItemComponent,
    ],
})
export class RecentPlaylistsComponent {
    private readonly databaseService = inject(DatabaseService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly dataService = inject(DataService);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly sortService = inject(SortService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly sidebarMode = input(false);
    readonly searchQueryInput = input<string>('');
    readonly playlistClicked = output<string>();
    readonly addPlaylistClicked = output<PlaylistType>();

    readonly allPlaylistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly activePlaylistId = this.store.selectSignal(selectActivePlaylistId);

    private readonly currentSortOptions = toSignal(
        this.sortService.getSortOptions(),
        { requireSync: true }
    );

    readonly isCustomSortActive = () =>
        this.currentSortOptions().by === SortBy.CUSTOM;

    readonly searchQuery = new BehaviorSubject<string>('');

    readonly ghostElements = new Array(10);

    constructor() {
        // Update searchQuery when input changes
        effect(() => {
            this.searchQuery.next(this.searchQueryInput());
        });
    }

    readonly playlistsData$ = combineLatest([
        this.store.select(selectAllPlaylistsMeta),
        this.searchQuery,
        this.store.select(selectActiveTypeFilters),
        this.sortService.getSortOptions(),
    ]).pipe(
        map(([playlists, searchQuery, filters, sortOptions]) => {
            const filteredPlaylists = playlists
                .filter((item) => {
                    const isStalkerFilter =
                        item.macAddress && filters.includes('stalker');
                    const isXtreamFilter =
                        item.username &&
                        item.password &&
                        item.serverUrl &&
                        filters.includes('xtream');
                    const isM3uFilter =
                        !item.username &&
                        !item.password &&
                        !item.serverUrl &&
                        !item.macAddress &&
                        filters.includes('m3u');

                    return (
                        (isStalkerFilter && filters.includes('stalker')) ||
                        (isXtreamFilter && filters.includes('xtream')) ||
                        (isM3uFilter && filters.includes('m3u'))
                    );
                })
                .filter((item) =>
                    (item.title || '')
                        .toLowerCase()
                        .includes(searchQuery.toLowerCase())
                );

            // Apply sorting using the SortService
            const sortedPlaylists = this.sortService.sortPlaylists(
                filteredPlaylists,
                sortOptions
            );

            return {
                playlists: sortedPlaylists,
                totalCount: playlists.length,
            };
        })
    );

    /**
     * Opens the details dialog with the information about the provided playlist
     * @param data selected playlist
     */
    openInfoDialog(data: PlaylistMeta): void {
        this.dialog.open(PlaylistInfoComponent, {
            data,
        });
    }

    /**
     * Drop event handler - applies the new sort order to the playlists array
     * @param event drop event
     */
    drop(event: CdkDragDrop<PlaylistMeta[]>, playlists: PlaylistMeta[]): void {
        moveItemInArray(playlists, event.previousIndex, event.currentIndex);
        this.store.dispatch(
            PlaylistActions.updatePlaylistPositions({
                positionUpdates: playlists.map((item, index) => ({
                    id: item._id,
                    changes: { position: index },
                })),
            })
        );
    }

    onAddPlaylist(playlistType: PlaylistType) {
        this.addPlaylistClicked.emit(playlistType);
    }

    getPlaylist(playlistMeta: PlaylistMeta): void {
        if (playlistMeta.serverUrl) {
            this.router.navigate(['/workspace', 'xtreams', playlistMeta._id]);
        } else if (playlistMeta.macAddress) {
            this.router.navigate(['/workspace', 'stalker', playlistMeta._id]);
        } else {
            this.router.navigate(['/workspace', 'playlists', playlistMeta._id]);
            this.playlistClicked.emit(playlistMeta._id);
        }
    }

    /**
     * Triggers on remove click
     * @param playlistId playlist id to remove
     */
    removeClicked(playlistId: string): void {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: () => {
                this.removePlaylist(playlistId);
            },
        });
    }

    /**
     * Removes the provided playlist from the database
     * @param playlistId playlist id to remove
     */
    async removePlaylist(playlistId: string) {
        const deleted = await this.databaseService.deletePlaylist(playlistId);
        if (deleted) {
            this.store.dispatch(PlaylistActions.removePlaylist({ playlistId }));
            this.snackBar.open(
                this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS'),
                undefined,
                {
                    duration: 2000,
                }
            );
        }
    }

    /**
     * Sends an IPC event with the playlist details to the main process to trigger the refresh operation
     * @param item playlist to update
     */
    refreshPlaylist(item: PlaylistMeta) {
        if (item.serverUrl) {
            // For Xtream playlists, delete and re-import
            this.refreshXtreamPlaylist(item);
        } else {
            // For M3U playlists, use existing refresh logic
            this.dataService.sendIpcEvent(PLAYLIST_UPDATE, {
                id: item._id,
                title: item.title,
                ...(item.url ? { url: item.url } : { filePath: item.filePath }),
            });
        }
    }

    /**
     * Refresh Xtream playlist by deleting all data and re-importing from remote
     * @param item Xtream playlist to refresh
     */
    async refreshXtreamPlaylist(item: PlaylistMeta) {
        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.MESSAGE'
            ),
            onConfirm: async () => {
                try {
                    // Show immediate feedback — deletion can take several seconds
                    // for large playlists.
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                        ),
                        undefined,
                        { duration: 2000 }
                    );

                    // Delete content/categories and update the timestamp in
                    // parallel — both operations are fully independent.
                    const updateDate = Date.now();
                    const [
                        {
                            favoritedXtreamIds,
                            recentlyViewedXtreamIds,
                            hiddenCategories,
                        },
                    ] = await Promise.all([
                        this.databaseService.deleteXtreamPlaylistContent(
                            item._id
                        ),
                        this.databaseService.updateXtreamPlaylistDetails({
                            id: item._id,
                            updateDate,
                        }),
                    ]);

                    // Update the timestamp in NgRx / IndexedDB
                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({
                            playlist: { ...item, updateDate },
                        })
                    );

                    // Persist user data so it can be restored after re-import
                    const restoreKey = `xtream-restore-${item._id}`;
                    localStorage.setItem(
                        restoreKey,
                        JSON.stringify({
                            favoritedXtreamIds,
                            recentlyViewedXtreamIds,
                            hiddenCategories,
                        })
                    );

                    // Navigate to the playlist to trigger re-import
                    this.router.navigate(['/workspace', 'xtreams', item._id]);
                } catch (error) {
                    console.error('Error refreshing Xtream playlist:', error);
                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.ERROR'
                        ),
                        undefined,
                        { duration: 3000 }
                    );
                }
            },
        });
    }
}
