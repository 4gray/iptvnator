import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { ChannelStore } from '../state';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    /** Default options for epg snackbar notifications */
    epgSnackBarOptions: MatSnackBarConfig = {
        verticalPosition: 'bottom',
        horizontalPosition: 'right',
    };

    constructor(
        private channelStore: ChannelStore,
        private electronService: DataService,
        private snackBar: MatSnackBar,
        private translate: TranslateService
    ) {}

    /**
     * Fetches and updates EPG from the given URL
     * @param urls epg source urls
     */
    fetchEpg(urls: string | string[]): void {
        if (!Array.isArray(urls)) {
            urls = [urls];
        }
        urls.forEach((url) =>
            this.electronService.sendIpcEvent(EPG_FETCH, {
                url,
            })
        );
        this.snackBar.open(
            this.translate.instant('EPG.FETCH_EPG'),
            this.translate.instant('CLOSE'),
            this.epgSnackBarOptions
        );
    }

    /**
     * Handles the event when the EPG fetching is done
     */
    onEpgFetchDone(): void {
        this.channelStore.setEpgAvailableFlag(true);
        this.snackBar.open(
            this.translate.instant('EPG.DOWNLOAD_SUCCESS'),
            null,
            {
                ...this.epgSnackBarOptions,
                duration: 2000,
            }
        );
    }

    /**
     * Handles epg error
     */
    onEpgError(): void {
        this.snackBar.open(this.translate.instant('EPG.ERROR'), null, {
            ...this.epgSnackBarOptions,
            duration: 2000,
        });
    }
}
