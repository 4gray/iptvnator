import { Component, NgZone } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
} from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { getFilenameFromUrl } from '../../../shared/playlist.utils';
import { DataService } from '../services/data.service';
import { addPlaylist, parsePlaylist } from '../state/actions';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent {
    /** Loading spinner state */
    isLoading = false;

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void => {
                this.store.dispatch(
                    addPlaylist({
                        playlist: response.payload,
                    })
                );
            },
        },
        {
            id: ERROR,
            execute: () => (this.isLoading = false),
        },
    ];

    listeners = [];

    constructor(
        private dataService: DataService,
        private ngZone: NgZone,
        private snackBar: MatSnackBar,
        private readonly store: Store,
        private translateService: TranslateService
    ) {
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.dataService.isElectron) {
                this.dataService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.execute(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
        });
    }

    /**
     * Shows the filename of rejected file
     * @param filename name of the uploaded file
     */
    rejectFile(filename: string): void {
        this.showNotification(
            this.translateService.instant('HOME.FILE_UPLOAD.REJECTED', {
                filename,
            })
        );
        this.isLoading = false;
    }

    /**
     * Parse and store uploaded playlist
     * @param payload
     */
    handlePlaylist(payload: { uploadEvent: Event; file: File }): void {
        this.isLoading = true;
        const playlist = (payload.uploadEvent.target as FileReader)
            .result as string;

        this.store.dispatch(
            parsePlaylist({
                uploadType: 'FILE',
                playlist,
                title: payload.file.name,
                path: payload.file.path,
            })
        );
    }

    /**
     * Sends url of the playlist to the renderer process
     * @param playlistUrl url of the added playlist
     */
    sendPlaylistsUrl(playlistUrl: string): void {
        this.isLoading = true;
        this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
            title: getFilenameFromUrl(playlistUrl),
            url: playlistUrl,
        });
    }

    /**
     * Sends IPC event to the renderer process to parse playlist
     * @param text playlist as string
     */
    uploadAsText(playlist: string): void {
        this.isLoading = true;
        this.store.dispatch(
            parsePlaylist({
                uploadType: 'TEXT',
                playlist,
                title: 'Imported as text',
            })
        );
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
        if (this.dataService.isElectron) {
            this.commandsList.forEach((command) =>
                this.dataService.removeAllListeners(command.id)
            );
        } else {
            this.listeners.forEach((listener) => {
                window.removeEventListener('message', listener);
            });
        }
    }
}
