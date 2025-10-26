import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { AsyncPipe } from '@angular/common';
import {
    Component,
    ElementRef,
    EventEmitter,
    inject,
    Input,
    OnInit,
    Output,
    viewChild,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as PlaylistActions from 'm3u-state';
import {
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from 'm3u-state';
import { NgxSkeletonLoaderComponent } from 'ngx-skeleton-loader';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { DatabaseService, DataService, SortService } from 'services';
import {
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    GLOBAL_FAVORITES_PLAYLIST_ID,
    Playlist,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
    PlaylistMeta,
} from 'shared-interfaces';
import { DialogService } from '../confirm-dialog/dialog.service';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistItemComponent } from './playlist-item/playlist-item.component';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
    imports: [
        AsyncPipe,
        MatIcon,
        MatInputModule,
        MatListModule,
        NgxSkeletonLoaderComponent,
        PlaylistItemComponent,
        TranslatePipe,
    ],
})
export class RecentPlaylistsComponent implements OnInit {
    private readonly databaseService = inject(DatabaseService);
    private readonly dialog = inject(MatDialog);
    private readonly dialogService = inject(DialogService);
    private readonly dataService = inject(DataService);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly sortService = inject(SortService);
    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly searchQueryInput =
        viewChild<ElementRef<HTMLInputElement>>('searchQuery');

    readonly searchQuery = new BehaviorSubject<string>('');

    readonly ghostElements = new Array(10);

    readonly playlists$ = combineLatest([
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
                    item.title.toLowerCase().includes(searchQuery.toLowerCase())
                );

            // Apply sorting using the SortService
            return this.sortService.sortPlaylists(
                filteredPlaylists,
                sortOptions
            );
        })
    );

    allPlaylistsLoaded = this.store.selectSignal(selectPlaylistsLoadingFlag);

    @Input() sidebarMode = false;
    @Output() playlistClicked = new EventEmitter<string>();

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: PLAYLIST_UPDATE_RESPONSE,
            execute: (response: {
                payload: { message: string; playlist: Playlist };
            }) => {
                this.snackBar.open(response.payload.message, undefined, {
                    duration: 2000,
                });
                this.store.dispatch(
                    PlaylistActions.updatePlaylist({
                        playlistId: response.payload.playlist._id,
                        playlist: response.payload.playlist,
                    })
                );
            },
        },
        {
            id: AUTO_UPDATE_PLAYLISTS_RESPONSE,
            execute: (response: {
                payload: { message: string; playlists: Playlist[] };
            }) => {
                this.store.dispatch(
                    PlaylistActions.updateManyPlaylists({
                        playlists: response.payload.playlists,
                    })
                );
            },
        },
    ];

    ngOnInit(): void {
        this.setRendererListeners();
    }

    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            const cb = (response: any) => {
                if (response.data.type === command.id) {
                    command.execute(response.data);
                }
            };
            this.dataService.listenOn(command.id, cb);
        });
    }

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

    getGlobalFavorites() {
        this.router.navigate(['playlists', GLOBAL_FAVORITES_PLAYLIST_ID]);
        this.playlistClicked.emit(GLOBAL_FAVORITES_PLAYLIST_ID);
    }

    getPlaylist(playlistMeta: PlaylistMeta): void {
        if (playlistMeta.serverUrl) {
            this.router.navigate(['xtreams', playlistMeta._id]);
        } else if (playlistMeta.macAddress) {
            this.router.navigate(['stalker', playlistMeta._id]);
        } else {
            this.router.navigate(['playlists', playlistMeta._id]);
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
                    // Delete all content and categories for this playlist
                    await this.databaseService.deleteXtreamPlaylistContent(
                        item._id
                    );

                    const updateDate = Date.now();

                    // Update the updateDate timestamp in database (Electron)
                    await this.databaseService.updateXtreamPlaylistDetails({
                        id: item._id,
                        updateDate,
                    });

                    // Update the updateDate timestamp in IndexedDB
                    this.store.dispatch(
                        PlaylistActions.updatePlaylistMeta({
                            playlist: { ...item, updateDate },
                        })
                    );

                    this.snackBar.open(
                        this.translate.instant(
                            'HOME.PLAYLISTS.REFRESH_XTREAM_DIALOG.STARTED'
                        ),
                        undefined,
                        { duration: 2000 }
                    );

                    // Navigate to the playlist to trigger re-import
                    this.router.navigate(['xtreams', item._id]);
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

    onSearchQueryUpdate(searchQuery: string) {
        this.searchQuery.next(searchQuery);
    }

    /* @HostListener('window:keydown.control.f', ['$event'])
    @HostListener('window:keydown.meta.f', ['$event']) */
    onSearchHotkey(event: KeyboardEvent) {
        // Prevent default browser search behavior
        event.preventDefault();
        event.stopPropagation();
        this.searchQueryInput()?.nativeElement?.focus();
    }
}
