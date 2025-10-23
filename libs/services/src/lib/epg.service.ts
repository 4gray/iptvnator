import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import * as PlaylistActions from 'm3u-state';
import { BehaviorSubject, from, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { EpgProgram } from 'shared-interfaces';

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);

    // TODO: do not use store directly in the service
    private store = inject(Store);

    private epgAvailable = new BehaviorSubject<boolean>(false);
    private currentEpgPrograms = new BehaviorSubject<EpgProgram[]>([]);

    private readonly isDesktop = !!window.electron;

    readonly epgAvailable$ = this.epgAvailable.asObservable();
    readonly currentEpgPrograms$ = this.currentEpgPrograms.asObservable();

    /**
     * Fetches EPG from the given URLs
     */
    fetchEpg(urls: string[]): void {
        if (!this.isDesktop) return;
        this.showFetchSnackbar();

        // Filter out empty URLs and send all URLs at once
        const validUrls = urls.filter((url) => url?.trim());
        if (validUrls.length === 0) return;

        from(window.electron.fetchEpg(validUrls))
            .pipe(
                tap((result) => {
                    if (result.success) {
                        this.epgAvailable.next(true);
                        this.showSuccessSnackbar();
                    } else {
                        this.epgAvailable.next(false);
                        this.showErrorSnackbar(result.message);
                    }
                }),
                catchError((err) => {
                    console.error('EPG fetch error:', err);
                    this.epgAvailable.next(false);
                    this.showErrorSnackbar();
                    return of(null);
                })
            )
            .subscribe();
    }

    /**
     * Gets EPG programs for a specific channel
     */
    getChannelPrograms(channelId: string): void {
        if (!this.isDesktop) return;
        console.log('Fetching EPG for channel ID:', channelId);

        from(window.electron.getChannelPrograms(channelId))
            .pipe(
                map((programs: EpgProgram[]) =>
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
                    return of([]);
                })
            )
            .subscribe((programs) => {
                this.store.dispatch(
                    PlaylistActions.setEpgAvailableFlag({
                        value: programs.length === 0 ? false : true,
                    })
                );
                this.currentEpgPrograms.next(programs);
            });
    }

    /**
     * Shows fetch in progress snackbar
     */
    showFetchSnackbar(): void {
        this.snackBar.open(this.translate.instant('EPG.FETCH_EPG'), undefined, {
            duration: 2000,
            horizontalPosition: 'start',
        });
    }

    /**
     * Shows success snackbar
     */
    private showSuccessSnackbar(): void {
        this.snackBar.open(
            this.translate.instant('EPG.FETCH_SUCCESS'),
            undefined,
            {
                duration: 2000,
                horizontalPosition: 'start',
            }
        );
    }

    /**
     * Shows error snackbar
     */
    private showErrorSnackbar(message?: string): void {
        const errorMessage = message || this.translate.instant('EPG.ERROR');
        this.snackBar.open(errorMessage, this.translate.instant('CLOSE'), {
            duration: 3000,
            horizontalPosition: 'start',
        });
    }
}
