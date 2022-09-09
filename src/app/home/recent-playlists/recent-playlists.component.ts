import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, NgZone, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { IpcCommand } from '../../../../shared/ipc-command.class';
import { DataService } from '../../services/data.service';
import {
    PLAYLIST_GET_ALL,
    PLAYLIST_GET_ALL_RESPONSE,
    PLAYLIST_GET_BY_ID,
    PLAYLIST_REMOVE_BY_ID,
    PLAYLIST_REMOVE_BY_ID_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_POSITIONS,
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
    /** All available playlists */
    playlists: PlaylistMeta[] = [];

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        new IpcCommand(
            PLAYLIST_GET_ALL_RESPONSE,
            (response: { payload: Partial<PlaylistMeta[]> }) => {
                this.playlists = response.payload;
            }
        ),
        new IpcCommand(PLAYLIST_REMOVE_BY_ID_RESPONSE, (): void => {
            this.snackBar.open('Done! Playlist was removed.', null, {
                duration: 2000,
            });
            this.electronService.sendIpcEvent(PLAYLIST_GET_ALL);
        }),
        new IpcCommand(
            PLAYLIST_UPDATE_RESPONSE,
            (response: { message: string }) => {
                this.snackBar.open(response.message, null, { duration: 2000 });
            }
        ),
    ];

    listeners = [];

    /**
     * Creates an instance of the component
     * @param dialog angular material dialog reference
     * @param dialogService dialog service
     * @param electronService electron service
     * @param snackBar angular material snackbar reference
     * @param translate translate service
     */
    constructor(
        private dialog: MatDialog,
        private dialogService: DialogService,
        private electronService: DataService,
        private ngZone: NgZone,
        private snackBar: MatSnackBar,
        private translate: TranslateService
    ) {}

    ngOnInit(): void {
        // get all playlists
        this.electronService.sendIpcEvent(PLAYLIST_GET_ALL);
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
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.callback(response.data);
                    }
                };
                this.electronService.listenOn(command.id, cb);
                this.listeners.push(cb);
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
    drop(event: CdkDragDrop<PlaylistMeta[]>): void {
        moveItemInArray(
            this.playlists,
            event.previousIndex,
            event.currentIndex
        );
        this.electronService.sendIpcEvent(
            PLAYLIST_UPDATE_POSITIONS,
            this.playlists
        );
    }

    /**
     * Requests playlist by id
     * @param playlistId playlist id
     */
    getPlaylist(playlistId: string): void {
        this.electronService.sendIpcEvent(PLAYLIST_GET_BY_ID, {
            id: playlistId,
        });
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
        this.electronService.sendIpcEvent(PLAYLIST_REMOVE_BY_ID, {
            id: playlistId,
        });
    }

    /**
     * Sends an IPC event with the playlist details to the main process to trigger the refresh operation
     * @param item playlist to update
     */
    refreshPlaylist(item: PlaylistMeta): void {
        this.electronService.sendIpcEvent(PLAYLIST_UPDATE, {
            id: item._id,
            ...(item.url ? { url: item.url } : { filePath: item.filePath }),
        });
    }

    /**
     * Removes command listeners on component destroy
     */
    ngOnDestroy(): void {
        if (this.electronService.isElectron) {
            this.commandsList.forEach((command) =>
                this.electronService.removeAllListeners(command.id)
            );
        } else {
            this.listeners.forEach((listener) => {
                window.removeEventListener('message', listener);
            });
        }
    }
}
