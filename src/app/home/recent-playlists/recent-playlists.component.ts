import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import {
    Component,
    ElementRef,
    EventEmitter,
    HostListener,
    Input,
    NgZone,
    OnDestroy,
    Output,
    ViewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from '../../../../shared/constants';
import { IpcCommand } from '../../../../shared/ipc-command.class';
import { Playlist } from '../../../../shared/playlist.interface';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service';
import { SortService } from '../../services/sort.service';
import * as PlaylistActions from '../../state/actions';
import {
    selectActiveTypeFilters,
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '../../state/selectors';
import {
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    DELETE_ALL_PLAYLISTS,
    MIGRATE_PLAYLISTS,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
} from './../../../../shared/ipc-commands';
import { DialogService } from './../../services/dialog.service';
import { PlaylistMeta } from './../../shared/playlist-meta.type';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';
import { PlaylistItemComponent } from './playlist-item/playlist-item.component';

@Component({
    standalone: true,
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
    imports: [
        AsyncPipe,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatInputModule,
        MatListModule,
        NgFor,
        NgIf,
        NgxSkeletonLoaderModule,
        PlaylistItemComponent,
        TranslateModule,
    ],
})
export class RecentPlaylistsComponent implements OnDestroy {
    @ViewChild('searchQuery') searchQueryInput!: ElementRef<HTMLInputElement>;

    searchQuery = new BehaviorSubject('');

    playlists$ = combineLatest([
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
        new IpcCommand(
            PLAYLIST_UPDATE_RESPONSE,
            (response: { message: string; playlist: Playlist }) => {
                this.snackBar.open(response.message, null, { duration: 2000 });
                this.store.dispatch(
                    PlaylistActions.updatePlaylist({
                        playlistId: response.playlist._id,
                        playlist: response.playlist,
                    })
                );
            }
        ),
        new IpcCommand(
            AUTO_UPDATE_PLAYLISTS_RESPONSE,
            (playlists: Playlist[]) => {
                this.store.dispatch(
                    PlaylistActions.updateManyPlaylists({
                        playlists,
                    })
                );
            }
        ),
    ];

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly dialog: MatDialog,
        private readonly dialogService: DialogService,
        private readonly electronService: DataService,
        private readonly ngZone: NgZone,
        private readonly router: Router,
        private readonly snackBar: MatSnackBar,
        private readonly sortService: SortService,
        private readonly store: Store,
        private readonly translate: TranslateService
    ) {}

    ngOnInit(): void {
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.electronService.isElectron) {
                this.electronService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.callback(response))
                );
            }
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
            this.router.navigate(['portals', playlistMeta._id]);
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
            onConfirm: (): void => this.removePlaylist(playlistId),
        });
    }

    /**
     * Removes the provided playlist from the database
     * @param playlistId playlist id to remove
     */
    removePlaylist(playlistId: string) {
        this.databaseService.deletePlaylist(playlistId);
        this.store.dispatch(PlaylistActions.removePlaylist({ playlistId }));
    }

    /**
     * Sends an IPC event with the playlist details to the main process to trigger the refresh operation
     * @param item playlist to update
     */
    refreshPlaylist(item: PlaylistMeta): void {
        this.electronService.sendIpcEvent(PLAYLIST_UPDATE, {
            id: item._id,
            title: item.title,
            ...(item.url ? { url: item.url } : { filePath: item.filePath }),
        });
    }

    migratePlaylists() {
        this.electronService.sendIpcEvent(MIGRATE_PLAYLISTS);
    }

    deleteMigratedPlaylists() {
        this.electronService.sendIpcEvent(DELETE_ALL_PLAYLISTS);
    }

    /**
     * Removes command listeners on component destroy
     */
    ngOnDestroy(): void {
        if (this.electronService.isElectron) {
            this.commandsList.forEach((command) =>
                this.electronService.removeAllListeners(command.id)
            );
        }
    }

    trackByFn(_index: number, item: PlaylistMeta) {
        return item._id;
    }

    onSearchQueryUpdate(searchQuery: string) {
        this.searchQuery.next(searchQuery);
    }

    @HostListener('window:keydown.control.f', ['$event'])
    @HostListener('window:keydown.meta.f', ['$event'])
    onSearchHotkey(event: KeyboardEvent) {
        // Prevent default browser search behavior
        event.preventDefault();
        event.stopPropagation();
        this.searchQueryInput?.nativeElement?.focus();
    }
}
