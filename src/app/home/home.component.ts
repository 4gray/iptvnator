import { Component, NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
    PLAYLIST_PARSE,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_PARSE_TEXT,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { DataService } from '../services/data.service';
import { PlaylistMeta } from '../shared/playlist-meta.type';
import { setPlaylist } from '../state/actions';
import { selectChannels } from '../state/selectors';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
    /** Added playlists */
    playlists: PlaylistMeta[] = [];

    channels$ = this.store.select(selectChannels);

    /** Loading spinner state */
    isLoading = false;

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void => {
                this.store.dispatch(
                    setPlaylist({ playlist: response.payload })
                );
                this.navigateToPlayer();
            },
        },
    ];

    listeners = [];

    /**
     * Creates an instanceof HomeComponent
     * @param store channels store
     * @param electronService electron service
     * @param ngZone angular ngZone module
     * @param router angular router
     * @param snackBar snackbar for notification messages
     */
    constructor(
        private electronService: DataService,
        private ngZone: NgZone,
        private readonly store: Store,
        private router: Router,
        private snackBar: MatSnackBar
    ) {
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.electronService.isElectron) {
                this.electronService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.execute(response.data);
                    }
                };
                this.electronService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
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
    handlePlaylist(payload: { uploadEvent: Event; file: File }): void {
        this.isLoading = true;
        const result = (payload.uploadEvent.target as FileReader).result;
        const array = (result as string).split('\n');
        this.electronService.sendIpcEvent(PLAYLIST_PARSE, {
            title: payload.file.name,
            playlist: array,
            path: payload.file.path,
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
        this.electronService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            title: this.getLastUrlSegment(playlistUrl),
            url: playlistUrl,
        });
    }

    /**
     * Sends IPC event to the renderer process to parse playlist
     * @param text playlist as string
     */
    uploadAsText(text: string): void {
        this.isLoading = true;
        this.electronService.sendIpcEvent(PLAYLIST_PARSE_TEXT, {
            text,
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
