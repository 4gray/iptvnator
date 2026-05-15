import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    input,
    output,
    signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import type { WorkspacePlaylistType } from '@iptvnator/workspace/shell/util';
import {
    PlaylistActions,
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '@iptvnator/m3u-state';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { DialogService } from '@iptvnator/ui/components';
import {
    DatabaseService,
    DataService,
    DbOperationEvent,
    isDbAbortError,
    PlaybackPositionService,
    PlaylistRefreshService,
    SortBy,
    SortService,
    XtreamPendingRestoreService,
} from '@iptvnator/services';
import {
    PLAYLIST_UPDATE,
    PlaylistMeta,
    PlaylistRefreshEvent,
} from '@iptvnator/shared/interfaces';

import { EmptyStateComponent } from './empty-state/empty-state.component';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistItemComponent } from './playlist-item/playlist-item.component';

type PlaylistBusyOperation = {
    current?: number;
    operation: string;
    operationId?: string;
    phase?: string;
    status: DbOperationEvent['status'];
    total?: number;
};

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        DragDropModule,
        EmptyStateComponent,
        MatInputModule,
        PlaylistItemComponent,
    ],
})
export class RecentPlaylistsComponent {
    private readonly databaseService = inject(DatabaseService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly dataService = inject(DataService);
    private readonly playbackPositionService = inject(PlaybackPositionService);
    private readonly playlistRefreshService = inject(PlaylistRefreshService);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly sortService = inject(SortService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly pendingRestoreService = inject(
        XtreamPendingRestoreService
    );

    readonly sidebarMode = input(false);
    readonly searchQueryInput = input<string>('');
    readonly playlistClicked = output<string>();
    readonly addPlaylistClicked = output<WorkspacePlaylistType | undefined>();

    readonly isElectron = !!window.electron;

    readonly allPlaylistsLoaded = this.store.selectSignal(
        selectPlaylistsLoadingFlag
    );
    readonly activePlaylistId = this.playlistContext.resolvedPlaylistId;

    private readonly currentSortOptions = toSignal(
        this.sortService.getSortOptions(),
        { requireSync: true }
    );

    readonly isCustomSortActive = () =>
        this.currentSortOptions().by === SortBy.CUSTOM;

    readonly searchQuery = new BehaviorSubject<string>('');
    readonly pendingDeletionIds = signal<Set<string>>(new Set());
    readonly pendingRefreshIds = signal<Set<string>>(new Set());
    readonly busyOperations = signal<Map<string, PlaylistBusyOperation>>(
        new Map()
    );

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

    readonly playlistsData = toSignal(this.playlistsData$, {
        initialValue: {
            playlists: [] as PlaylistMeta[],
            totalCount: 0,
        },
    });

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

    onAddPlaylist(type?: WorkspacePlaylistType) {
        this.addPlaylistClicked.emit(type);
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
    removeClicked(item: PlaylistMeta): void {
        if (this.isDeletePending(item._id) || this.isRefreshPending(item._id)) {
            return;
        }

        this.dialogService.openConfirmDialog({
            title: this.translate.instant('HOME.PLAYLISTS.REMOVE_DIALOG.TITLE'),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REMOVE_DIALOG.MESSAGE'
            ),
            onConfirm: () => {
                this.removePlaylist(item);
            },
        });
    }

    /**
     * Removes the provided playlist from the database
     * @param playlistId playlist id to remove
     */
    async removePlaylist(item: PlaylistMeta) {
        if (this.isDeletePending(item._id) || this.isRefreshPending(item._id)) {
            return;
        }

        this.setPendingDeletion(item._id, true);
        const operationId = item.serverUrl
            ? this.databaseService.createOperationId('playlist-delete')
            : undefined;

        try {
            const deleted = await this.databaseService.deletePlaylist(
                item._id,
                operationId
                    ? {
                          operationId,
                          onEvent: (event) =>
                              this.updateBusyOperation(item._id, event),
                      }
                    : undefined
            );
            if (deleted) {
                this.store.dispatch(
                    PlaylistActions.removePlaylist({ playlistId: item._id })
                );
                this.snackBar.open(
                    this.translate.instant(
                        'HOME.PLAYLISTS.REMOVE_DIALOG.SUCCESS'
                    ),
                    undefined,
                    {
                        duration: 2000,
                    }
                );
            }
        } finally {
            this.clearBusyOperation(item._id);
            this.setPendingDeletion(item._id, false);
        }
    }

    /**
     * Sends an IPC event with the playlist details to the main process to trigger the refresh operation
     * @param item playlist to update
     */
    refreshPlaylist(item: PlaylistMeta) {
        if (this.isDeletePending(item._id) || this.isRefreshPending(item._id)) {
            return;
        }

        if (item.serverUrl) {
            // For Xtream playlists, delete and re-import
            this.refreshXtreamPlaylist(item);
        } else if (window.electron && (item.url || item.filePath)) {
            void this.refreshM3uPlaylist(item);
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
        if (this.isDeletePending(item._id) || this.isRefreshPending(item._id)) {
            return;
        }

        this.dialogService.openConfirmDialog({
            title: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.TITLE'
            ),
            message: this.translate.instant(
                'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.MESSAGE'
            ),
            width: '400px',
            onConfirm: async () => {
                if (
                    this.isDeletePending(item._id) ||
                    this.isRefreshPending(item._id)
                ) {
                    return;
                }

                this.setPendingRefresh(item._id, true);
                const operationId =
                    this.databaseService.createOperationId('xtream-refresh');

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
                    const [restoreState, playbackPositions] = await Promise.all(
                        [
                            this.databaseService.deleteXtreamPlaylistContent(
                                item._id,
                                {
                                    operationId,
                                    onEvent: (workerEvent) =>
                                        this.updateBusyOperation(
                                            item._id,
                                            workerEvent
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

                    // Update the timestamp in NgRx / IndexedDB
                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({
                            playlist: { ...item, updateDate },
                        })
                    );

                    // Navigate to the playlist to trigger re-import
                    this.router.navigate(['/workspace', 'xtreams', item._id]);
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
                    this.clearBusyOperation(item._id);
                    this.setPendingRefresh(item._id, false);
                }
            },
        });
    }

    private async refreshM3uPlaylist(item: PlaylistMeta): Promise<void> {
        if (this.isDeletePending(item._id) || this.isRefreshPending(item._id)) {
            return;
        }

        this.setPendingRefresh(item._id, true);
        const operationId =
            this.databaseService.createOperationId('playlist-refresh');

        try {
            const refreshedPlaylist =
                await this.playlistRefreshService.refreshPlaylist(
                    {
                        operationId,
                        playlistId: item._id,
                        title: item.title,
                        url: item.url,
                        filePath: item.filePath,
                    },
                    {
                        onEvent: (event) =>
                            this.updateBusyOperation(
                                item._id,
                                this.toPlaylistRefreshBusyEvent(event)
                            ),
                    }
                );

            this.updateBusyOperation(item._id, {
                operationId,
                operation: 'playlist-refresh',
                playlistId: item._id,
                phase: 'saving',
                status: 'progress',
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

            this.clearBusyOperation(item._id);
            this.snackBar.open(
                this.translate.instant(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_SUCCESS'
                ),
                null,
                { duration: 2000 }
            );
        } catch (error) {
            if (!isDbAbortError(error)) {
                console.error('Error refreshing playlist:', error);
                this.snackBar.open(
                    this.getPlaylistRefreshErrorMessage(error, item),
                    this.translate.instant('CLOSE'),
                    { duration: 5000 }
                );
            }
        } finally {
            this.clearBusyOperation(item._id);
            this.setPendingRefresh(item._id, false);
        }
    }

    isDeletePending(playlistId: string): boolean {
        return this.pendingDeletionIds().has(playlistId);
    }

    isRefreshPending(playlistId: string): boolean {
        return this.pendingRefreshIds().has(playlistId);
    }

    getBusyMessage(item: PlaylistMeta): string {
        const operation = this.busyOperations().get(item._id);
        if (!operation) {
            return '';
        }

        switch (operation.operation) {
            case 'delete-playlist':
                return this.translateDeletePhase(operation.phase);
            case 'delete-xtream-content':
                return this.translateRefreshPhase(operation.phase);
            case 'playlist-refresh':
                return this.translatePlaylistRefreshPhase(operation.phase);
            default:
                return '';
        }
    }

    getBusyProgress(playlistId: string): number | null {
        const operation = this.busyOperations().get(playlistId);
        if (
            !operation ||
            operation.current == null ||
            operation.total == null ||
            operation.total <= 0
        ) {
            return null;
        }

        return Math.min(
            100,
            Math.round((operation.current / operation.total) * 100)
        );
    }

    canCancelBusyOperation(item: PlaylistMeta): boolean {
        const operation = this.busyOperations().get(item._id);
        if (!operation?.operationId) {
            return false;
        }

        if (operation.operation === 'playlist-refresh') {
            return true;
        }

        return Boolean(item.serverUrl);
    }

    async cancelBusyOperation(item: PlaylistMeta): Promise<void> {
        const operation = this.busyOperations().get(item._id);
        if (!operation?.operationId) {
            return;
        }

        if (operation.operation === 'playlist-refresh') {
            await this.playlistRefreshService.cancelRefresh(
                operation.operationId
            );
            return;
        }

        await this.databaseService.cancelOperation(operation.operationId);
    }

    private setPendingDeletion(playlistId: string, isPending: boolean): void {
        this.pendingDeletionIds.update((current) => {
            const next = new Set(current);
            if (isPending) {
                next.add(playlistId);
            } else {
                next.delete(playlistId);
            }
            return next;
        });
    }

    private setPendingRefresh(playlistId: string, isPending: boolean): void {
        this.pendingRefreshIds.update((current) => {
            const next = new Set(current);
            if (isPending) {
                next.add(playlistId);
            } else {
                next.delete(playlistId);
            }
            return next;
        });
    }

    private updateBusyOperation(
        playlistId: string,
        event: DbOperationEvent
    ): void {
        this.busyOperations.update((current) => {
            const next = new Map(current);

            if (
                event.status === 'completed' ||
                event.status === 'cancelled' ||
                event.status === 'error'
            ) {
                next.delete(playlistId);
                return next;
            }

            next.set(playlistId, {
                operation: event.operation,
                operationId: event.operationId,
                phase: event.phase,
                current: event.current,
                total: event.total,
                status: event.status,
            });
            return next;
        });
    }

    private clearBusyOperation(playlistId: string): void {
        this.busyOperations.update((current) => {
            const next = new Map(current);
            next.delete(playlistId);
            return next;
        });
    }

    private toPlaylistRefreshBusyEvent(
        event: PlaylistRefreshEvent
    ): DbOperationEvent {
        return {
            operationId: event.operationId,
            operation: 'playlist-refresh',
            playlistId: event.playlistId,
            phase: event.phase,
            status: event.status,
            error: event.error,
        };
    }

    private translateDeletePhase(phase?: string): string {
        switch (phase) {
            case 'deleting-favorites':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_FAVORITES'
                );
            case 'deleting-recently-viewed':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_RECENT'
                );
            case 'deleting-playback-positions':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_PROGRESS'
                );
            case 'deleting-downloads':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_DOWNLOADS'
                );
            case 'deleting-content':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CONTENT'
                );
            case 'deleting-categories':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_CATEGORIES'
                );
            case 'deleting-playlist':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.DELETING_PLAYLIST'
                );
            default:
                return this.translate.instant(
                    'HOME.PLAYLISTS.REMOVE_DIALOG.IN_PROGRESS'
                );
        }
    }

    private translateRefreshPhase(phase?: string): string {
        switch (phase) {
            case 'collecting-user-data':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.COLLECTING_DATA'
                );
            case 'deleting-content':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.DELETING_CONTENT'
                );
            case 'deleting-categories':
                return this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.DELETING_CATEGORIES'
                );
            default:
                return this.translate.instant(
                    'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.IN_PROGRESS'
                );
        }
    }

    private translatePlaylistRefreshPhase(phase?: string): string {
        switch (phase) {
            case 'fetching':
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.REFRESH_FETCHING',
                    'Fetching playlist...'
                );
            case 'reading-file':
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.REFRESH_READING_FILE',
                    'Reading playlist file...'
                );
            case 'parsing':
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.REFRESH_PARSING',
                    'Parsing playlist...'
                );
            case 'saving':
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.REFRESH_SAVING',
                    'Saving playlist...'
                );
            default:
                return this.translate.instant('HOME.PLAYLISTS.REFRESH');
        }
    }

    private getPlaylistRefreshErrorMessage(
        error: unknown,
        item: PlaylistMeta
    ): string {
        if (item.filePath) {
            const message = String(
                (error as { message?: string })?.message ?? error
            );

            if (/(ENOENT|no such file or directory|not found)/i.test(message)) {
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_NOT_FOUND',
                    'Playlist refresh failed. The local file is no longer available. Check the file path or re-import the playlist.'
                );
            }

            if (/(EACCES|EPERM|permission denied)/i.test(message)) {
                return this.translateWithFallback(
                    'HOME.PLAYLISTS.PLAYLIST_UPDATE_FILE_ACCESS_ERROR',
                    'Playlist refresh failed. The app can no longer access the local file.'
                );
            }
        }

        return this.translate.instant('HOME.PLAYLISTS.PLAYLIST_UPDATE_ERROR');
    }

    private translateWithFallback(key: string, fallback: string): string {
        const translated = this.translate.instant(key);
        return translated === key ? fallback : translated;
    }
}
