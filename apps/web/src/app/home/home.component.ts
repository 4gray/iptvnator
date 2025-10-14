import { Component, inject, OnDestroy } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DataService } from '@iptvnator/services';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { RecentPlaylistsComponent } from 'components';
import { addPlaylist } from 'm3u-state';
import { ERROR, Playlist, PLAYLIST_PARSE_RESPONSE } from 'shared-interfaces';
import { HeaderComponent } from '../shared/components/header/header.component';

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    imports: [
        HeaderComponent,
        MatProgressBarModule,
        RecentPlaylistsComponent,
        TranslatePipe,
    ],
})
export class HomeComponent implements OnDestroy {
    private dataService = inject(DataService);
    private snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);

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
                this.showNotification('Error: ' + error.message);
            },
        },
    ];

    listeners = [];

    constructor() {
        this.setRendererListeners();
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            /* if (this.dataService.isElectron) {
                this.dataService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else { */
            const cb = (response) => {
                if (response.data.type === command.id) {
                    command.execute(response.data);
                }
            };
            this.dataService.listenOn(command.id, cb);
            this.listeners.push(cb);
            /* } */
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
