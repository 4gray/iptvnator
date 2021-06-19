import { TranslateService } from '@ngx-translate/core';
import { Component, NgZone } from '@angular/core';
import { UploadFile } from 'ngx-uploader';
import { ChannelStore, createChannel } from '../state';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Playlist } from '../../../playlist.interface';
import { ElectronService } from '../services/electron.service';
import {
    ERROR,
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
} from './../../../ipc-commands';
import { DialogService } from './../services/dialog.service';

/** Type to describe meta data of a playlist */
export type PlaylistMeta = Pick<
    Playlist,
    | 'count'
    | 'title'
    | 'filename'
    | '_id'
    | 'url'
    | 'importDate'
    | 'userAgent'
    | 'filePath'
    | 'updateDate'
    | 'updateState'
>;

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
    /** Added playlists */
    playlists: PlaylistMeta[] = [];
    /** Loading spinner state */
    isLoading = false;
    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void =>
                this.setPlaylist(response.payload),
        },
        {
            id: 'playlist-all-result',
            execute: (response: { payload: Partial<PlaylistMeta[]> }): void => {
                this.playlists = response.payload;
            },
        },
        {
            id: 'playlist-remove-by-id-result',
            execute: (): void => {
                this.snackBar.open('Done! Playlist was removed.', null, {
                    duration: 2000,
                });
                this.electronService.ipcRenderer.send('playlists-all');
            },
        },
        {
            id: ERROR,
            execute: (response: { message: string; status: number }): void => {
                this.isLoading = false;
                this.showNotification(
                    `Error: ${response.status} ${response.message}.`
                );
            },
        },
        {
            id: PLAYLIST_UPDATE_RESPONSE,
            execute: (response: { message: string }): void =>
                this.showNotification(response.message),
        },
    ];

    /**
     * Creates an instanceof HomeComponent
     * @param channelStore channels store
     * @param electronService electron service
     * @param ngZone angulars ngZone module
     * @param router angulars router
     * @param snackBar snackbars with notification messages
     */
    constructor(
        private channelStore: ChannelStore,
        private dialogService: DialogService,
        private electronService: ElectronService,
        private ngZone: NgZone,
        private router: Router,
        private snackBar: MatSnackBar,
        private translate: TranslateService
    ) {
        // get all playlists
        this.electronService.ipcRenderer.send('playlists-all');
        // set all renderer listeners
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            this.electronService.ipcRenderer.on(
                command.id,
                (event, response) => {
                    this.ngZone.run(() => command.execute(response));
                }
            );
        });
    }

    /**
     * Shows the filename of rejected file
     * @param fileName name of the uploaded file
     */
    rejectFile(fileName: string): void {
        this.showNotification(
            `File was rejected, unsupported file format (${fileName}).`
        );
        this.isLoading = false;
    }

    /**
     * Parse and store uploaded playlist
     * @param payload
     */
    handlePlaylist(payload: { uploadEvent: Event; file: UploadFile }): void {
        this.isLoading = true;
        const result = (payload.uploadEvent.target as FileReader).result;
        const array = (result as string).split('\n');
        this.electronService.ipcRenderer.send(PLAYLIST_PARSE, {
            title: payload.file.name,
            playlist: array,
            path: payload.file.nativeFile.path,
        });
    }

    /**
     * Navigates to the video player route
     */
    navigateToPlayer(): void {
        this.isLoading = false;
        this.router.navigateByUrl('/iptv', { skipLocationChange: true });
    }

    /**
     * Sends url of the playlist to the renderer process
     * @param playlistUrl url of the added playlist
     */
    sendPlaylistsUrl(playlistUrl: string): void {
        this.isLoading = true;
        this.electronService.ipcRenderer.send('parse-playlist-by-url', {
            title: this.getLastUrlSegment(playlistUrl),
            url: playlistUrl,
        });
    }

    /**
     * Sets the given playlist as active for the current session
     * @param playlist playlist object
     */
    setPlaylist(playlist: Playlist): void {
        this.channelStore.remove();
        const favorites = playlist.favorites || [];
        const channels = playlist.playlist.items.map((element) =>
            createChannel(element)
        );
        this.channelStore.upsertMany(channels);
        this.channelStore.update((store) => ({
            ...store,
            active: undefined,
            favorites,
            playlistId: playlist.id,
        }));
        this.navigateToPlayer();
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
        this.electronService.ipcRenderer.send('playlist-remove-by-id', {
            id: playlistId,
        });
    }

    /**
     * Sends an IPC event with the playlist details to the main process to trigger the refresh operation
     * @param item playlist to update
     */
    refreshPlaylist(item: PlaylistMeta): void {
        this.electronService.ipcRenderer.send(PLAYLIST_UPDATE, {
            id: item._id,
            ...(item.url ? { url: item.url } : { filePath: item.filePath }),
        });
    }

    /**
     * Requests playlist by id
     * @param playlistId playlist id
     */
    getPlaylist(playlistId: string): void {
        this.electronService.ipcRenderer.send('playlist-by-id', {
            id: playlistId,
        });
    }

    /**
     * Returns last segment (part after last slash "/") of the given URL
     * @param value URL as string
     */
    getLastUrlSegment(value: string): string {
        if (value && value.length > 1) {
            return value.substr(value.lastIndexOf('/') + 1);
        } else {
            return '';
        }
    }

    /**
     * Shows snack bar notification with a given message
     * @param message message to show
     * @param duration visibility duration of the snackbar
     */
    showNotification(message: string, duration = 2000): void {
        this.snackBar.open(message, null, {
            duration,
        });
    }

    /**
     * Remove ipcRenderer listeners after component destroy
     */
    ngOnDestroy(): void {
        this.commandsList.forEach((command) =>
            this.electronService.ipcRenderer.removeAllListeners(command.id)
        );
    }
}
