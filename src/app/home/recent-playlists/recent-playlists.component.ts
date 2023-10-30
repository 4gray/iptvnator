import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
    Component,
    EventEmitter,
    Input,
    NgZone,
    OnDestroy,
    Output,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from '../../../../shared/constants';
import { IpcCommand } from '../../../../shared/ipc-command.class';
import { Playlist } from '../../../../shared/playlist.interface';
import { DataService } from '../../services/data.service';
import * as PlaylistActions from '../../state/actions';
import {
    selectAllPlaylistsMeta,
    selectPlaylistsLoadingFlag,
} from '../../state/selectors';
import {
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    DELETE_ALL_PLAYLISTS,
    IS_PLAYLISTS_MIGRATION_POSSIBLE,
    IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
    MIGRATE_PLAYLISTS,
    MIGRATE_PLAYLISTS_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
} from './../../../../shared/ipc-commands';
import { DialogService } from './../../services/dialog.service';
import { PlaylistMeta } from './../../shared/playlist-meta.type';
import { PlaylistInfoComponent } from './playlist-info/playlist-info.component';

@Component({
    selector: 'app-recent-playlists',
    templateUrl: './recent-playlists.component.html',
    styleUrls: ['./recent-playlists.component.scss'],
})
export class RecentPlaylistsComponent implements OnDestroy {
    searchQuery = new BehaviorSubject('');

    playlists$ = combineLatest([
        this.store.select(selectAllPlaylistsMeta),
        this.searchQuery,
    ]).pipe(
        // eslint-disable-next-line @ngrx/avoid-mapping-selectors
        map(([playlists, searchQuery]) =>
            playlists
                .sort((a, b) => a.position - b.position)
                .filter((item) =>
                    item.title.toLowerCase().includes(searchQuery.toLowerCase())
                )
        )
    );

    allPlaylistsLoaded$ = this.store.select(selectPlaylistsLoadingFlag);

    @Input() sidebarMode = false;

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
            IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
            (response: { result: boolean; message: string }) => {
                this.isMigrationPossible = response.result;
                this.migrationMessage = response.message || '';
            }
        ),
        new IpcCommand(
            MIGRATE_PLAYLISTS_RESPONSE,
            (response: { payload: Playlist[] }) => {
                this.store.dispatch(
                    PlaylistActions.addManyPlaylists({
                        playlists: response.payload,
                    })
                );
                this.snackBar.open(
                    `${response.payload.length} playlists were successfully migrated`,
                    null,
                    { duration: 2000 }
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

    isMigrationPossible = false;
    migrationMessage = '';

    @Output() playlistClicked = new EventEmitter<string>();

    constructor(
        private dialog: MatDialog,
        private dialogService: DialogService,
        private electronService: DataService,
        private ngZone: NgZone,
        private router: Router,
        private snackBar: MatSnackBar,
        private readonly store: Store,
        private translate: TranslateService
    ) {}

    ngOnInit(): void {
        this.setRendererListeners();
        if (this.electronService.isElectron) {
            this.electronService.sendIpcEvent(IS_PLAYLISTS_MIGRATION_POSSIBLE);
        }
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
    removePlaylist(playlistId: string): void {
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
}
