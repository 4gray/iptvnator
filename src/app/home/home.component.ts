/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, NgZone } from '@angular/core';
import { UploadFile } from 'ngx-uploader';
import { ChannelStore, createChannel } from '../state';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Playlist } from './playlist.interface';
import { ElectronService } from '../services/electron.service';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
    /** Added playlists */
    playlists: Pick<
        Playlist,
        'count' | 'title' | 'filename' | '_id' | 'url' | 'importDate'
    >[] = [];
    /** Loading spinner state */
    isLoading = false;
    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: 'parse-response',
            execute: (response: any) => this.setPlaylist(response.payload),
        },
        {
            id: 'playlist-all-result',
            execute: (response: { payload: Partial<Playlist[]> }) =>
                (this.playlists = response.payload.sort((a, b) =>
                    b.importDate.localeCompare(a.importDate)
                )),
        },
        {
            id: 'playlist-remove-by-id-result',
            execute: () => {
                this.snackBar.open('Done! Playlist was removed.', null, {
                    duration: 2000,
                });
                this.electronService.ipcRenderer.send('playlists-all');
            },
        },
        {
            id: 'error',
            execute: (response: { message: string; status: number }) =>
                this.showNotification(
                    `Error: ${response.status} ${response.message}. Please check the entered playlist URL again.`
                ),
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
        private electronService: ElectronService,
        private ngZone: NgZone,
        private router: Router,
        private snackBar: MatSnackBar
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
        this.electronService.ipcRenderer.send('parse-playlist', {
            title: payload.file.name,
            playlist: array,
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
        this.channelStore.reset();
        const favorites = playlist.favorites || [];
        const channels = playlist.playlist.items.map((element) =>
            createChannel(element)
        );
        this.channelStore.upsertMany(channels);
        this.channelStore.update(() => ({
            favorites,
            playlistId: playlist.id,
        }));
        this.navigateToPlayer();
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
}
