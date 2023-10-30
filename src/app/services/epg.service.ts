import { Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { setEpgAvailableFlag } from '../state/actions';
import { DataService } from './data.service';

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    /** Default options for epg snackbar notifications */
    epgSnackBarOptions: MatSnackBarConfig = {
        verticalPosition: 'bottom',
        horizontalPosition: 'start',
    };

    constructor(
        private store: Store,
        private electronService: DataService,
        private snackBar: MatSnackBar,
        private translate: TranslateService
    ) {}

    /**
     * Fetches and updates EPG from the given sources
     * @param urls epg source urls
     */
    fetchEpg(urls: string | string[]) {
        const urlsArray = Array.isArray(urls) ? urls : [urls];
        urlsArray.forEach((url) =>
            this.electronService.sendIpcEvent(EPG_FETCH, {
                url,
            })
        );
        this.showFetchSnackbar();
    }

    showFetchSnackbar() {
        this.snackBar.open(
            this.translate.instant('EPG.FETCH_EPG'),
            this.translate.instant('CLOSE'),
            this.epgSnackBarOptions
        );
    }

    onEpgFetchDone() {
        this.store.dispatch(setEpgAvailableFlag({ value: true }));
        this.snackBar.open(
            this.translate.instant('EPG.DOWNLOAD_SUCCESS'),
            null,
            {
                ...this.epgSnackBarOptions,
                duration: 2000,
            }
        );
    }

    onEpgError() {
        this.snackBar.open(this.translate.instant('EPG.ERROR'), null, {
            ...this.epgSnackBarOptions,
            duration: 2000,
        });
    }
}
