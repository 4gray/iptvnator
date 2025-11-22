import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, map, tap, timeout } from 'rxjs/operators';
import { EpgProgram } from 'shared-interfaces';

interface CachedProgram {
    program: EpgProgram | null;
    timestamp: number;
}

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);

    private epgAvailable = new BehaviorSubject<boolean>(false);
    private currentEpgPrograms = new BehaviorSubject<EpgProgram[]>([]);

    // Cache for channel programs with 60-second TTL
    private programCache = new Map<string, CachedProgram>();
    private readonly CACHE_TTL = 60000; // 60 seconds

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
                    this.epgAvailable.next(false);
                    return of([]);
                })
            )
            .subscribe((programs) => {
                this.epgAvailable.next(programs.length > 0);
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

    /**
     * Gets the current EPG program for a specific channel (with caching)
     * @param channelId Channel ID (tvg-id or channel name)
     * @returns Observable of current program or null
     */
    getCurrentProgramForChannel(channelId: string): Observable<EpgProgram | null> {
        if (!this.isDesktop || !channelId) {
            return of(null);
        }

        // Check cache first
        const cached = this.programCache.get(channelId);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
            return of(cached.program);
        }

        // Fetch from backend
        return from(window.electron.getChannelPrograms(channelId)).pipe(
            map((programs: EpgProgram[]) => {
                if (!programs || programs.length === 0) {
                    this.programCache.set(channelId, { program: null, timestamp: now });
                    return null;
                }

                // Normalize date formats to ISO strings for consistency
                const transformedPrograms = programs.map((program) => ({
                    ...program,
                    start: new Date(program.start).toISOString(),
                    stop: new Date(program.stop).toISOString(),
                }));

                // Find current program from transformed programs
                const currentProgram = this.findCurrentProgram(transformedPrograms);

                // Cache the result
                this.programCache.set(channelId, {
                    program: currentProgram,
                    timestamp: now
                });

                return currentProgram;
            }),
            catchError((err) => {
                console.error('EPG get current program error:', err);
                this.programCache.set(channelId, { program: null, timestamp: now });
                return of(null);
            })
        );
    }

    /**
     * Finds the current program from a list of programs
     */
    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | null {
        const now = new Date();

        return programs.find(program => {
            const start = new Date(program.start);
            const stop = new Date(program.stop);
            return start <= now && now <= stop;
        }) || null;
    }

    /**
     * Gets current programs for multiple channels (batch operation)
     * @param channelIds Array of channel IDs
     * @returns Observable of Map with channelId -> current program
     */
    getCurrentProgramsForChannels(channelIds: string[]): Observable<Map<string, EpgProgram | null>> {
        if (!this.isDesktop) {
            return of(new Map());
        }

        if (!channelIds || channelIds.length === 0) {
            return of(new Map());
        }

        const resultMap = new Map<string, EpgProgram | null>();
        const channelsToFetch: string[] = [];
        const now = Date.now();

        // Check cache for each channel
        channelIds.forEach(channelId => {
            const cached = this.programCache.get(channelId);
            if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
                resultMap.set(channelId, cached.program);
            } else {
                channelsToFetch.push(channelId);
            }
        });

        // If all channels were cached, return immediately
        if (channelsToFetch.length === 0) {
            return of(resultMap);
        }

        // Fetch uncached channels with timeout and error handling per request
        const fetchObservables = channelsToFetch.map(channelId =>
            this.getCurrentProgramForChannel(channelId).pipe(
                timeout(5000), // 5 second timeout per request
                map(program => ({ channelId, program })),
                catchError(() => of({ channelId, program: null }))
            )
        );

        // Combine all fetches using forkJoin
        return forkJoin(fetchObservables).pipe(
            map(results => {
                results.forEach(result => {
                    resultMap.set(result.channelId, result.program);
                });
                return resultMap;
            })
        );
    }

    /**
     * Clears the program cache (useful when EPG is refreshed)
     */
    clearCache(): void {
        this.programCache.clear();
    }
}
