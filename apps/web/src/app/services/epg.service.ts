import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { BehaviorSubject, from } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { EpgProgram } from '../player/models/epg-program.model';
import * as PlaylistActions from '../state/actions';

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    private epgAvailable = new BehaviorSubject<boolean>(false);
    private currentEpgPrograms = new BehaviorSubject<EpgProgram[]>([]);

    epgAvailable$ = this.epgAvailable.asObservable();
    currentEpgPrograms$ = this.currentEpgPrograms.asObservable();

    constructor(
        private snackBar: MatSnackBar,
        private translate: TranslateService,
        private store: Store
    ) {}

    /**
     * Fetches EPG from the given URLs
     */
    fetchEpg(urls: string[]): void {
        if (!isTauri()) return;
        this.showFetchSnackbar();

        // Filter out empty URLs and send all URLs at once
        const validUrls = urls.filter((url) => url?.trim());
        if (validUrls.length === 0) return;

        from(invoke('fetch_epg', { url: validUrls }))
            .pipe(
                tap(() => {
                    this.epgAvailable.next(true);
                    this.showSuccessSnackbar();
                }),
                catchError((err) => {
                    console.error('EPG fetch error:', err);
                    this.epgAvailable.next(false);
                    this.showErrorSnackbar();
                    throw err;
                })
            )
            .subscribe();
    }

    /**
     * Gets EPG programs for a specific channel
     */
    getChannelPrograms(channelId: string): void {
        if (!isTauri()) return;
        console.log('Fetching EPG for channel ID:', channelId);
        from(invoke<EpgProgram[]>('get_channel_programs', { channelId }))
            .pipe(
                tap((programs) => {
                    console.log('Received programs:', programs);
                }),
                map((programs) =>
                    programs.map((program) => ({
                        ...program,
                        start: new Date(program.start).toISOString(),
                        stop: new Date(program.stop).toISOString(),
                    }))
                ),
                catchError((err) => {
                    console.error('EPG get programs error:', err);
                    this.showErrorSnackbar();
                    this.currentEpgPrograms.next([]);
                    throw err;
                })
            )
            .subscribe((programs) => {
                if (programs.length === 0) {
                    this.store.dispatch(
                        PlaylistActions.setEpgAvailableFlag({ value: false })
                    );
                } else {
                    this.store.dispatch(
                        PlaylistActions.setEpgAvailableFlag({ value: true })
                    );
                }
                this.currentEpgPrograms.next(programs);
                console.log('Updated programs:', programs); // Debug log
            });
    }

    /**
     * Shows fetch in progress snackbar
     */
    showFetchSnackbar(): void {
        this.snackBar.open(this.translate.instant('EPG.FETCH_EPG'), null, {
            duration: 2000,
            horizontalPosition: 'start',
        });
    }

    /**
     * Shows success snackbar
     */
    private showSuccessSnackbar(): void {
        this.snackBar.open(this.translate.instant('EPG.FETCH_SUCCESS'), null, {
            duration: 2000,
            horizontalPosition: 'start',
        });
    }

    /**
     * Shows error snackbar
     */
    private showErrorSnackbar(): void {
        this.snackBar.open(
            this.translate.instant('EPG.ERROR'),
            this.translate.instant('CLOSE'),
            {
                duration: 2000,
                horizontalPosition: 'start',
            }
        );
    }
}
