import { NgIf } from '@angular/common';
import { Component, NgZone } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { ERROR, PLAYLIST_PARSE_RESPONSE } from '../../../shared/ipc-commands';
import { Playlist } from '../../../shared/playlist.interface';
import { DataService } from '../services/data.service';
import { HeaderComponent } from '../shared/components/header/header.component';
import { addPlaylist } from '../state/actions';
import { RecentPlaylistsComponent } from './recent-playlists/recent-playlists.component';

@Component({
    standalone: true,
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    imports: [
        HeaderComponent,
        MatProgressBarModule,
        NgIf,
        RecentPlaylistsComponent,
        TranslateModule,
    ],
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
            execute: (error: { message: string; status: string }) => {
                //this.isLoading = false;
                this.showNotification('Error: ' + error.message);
            },
        },
    ];

    listeners = [];

    constructor(
        private dataService: DataService,
        private ngZone: NgZone,
        private snackBar: MatSnackBar,
        private readonly store: Store
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
