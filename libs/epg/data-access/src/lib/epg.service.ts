import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, forkJoin, from, Observable, of } from 'rxjs';
import {
    catchError,
    finalize,
    map,
    shareReplay,
    switchMap,
    tap,
    timeout,
} from 'rxjs/operators';
import {
    createDevLogger,
    EpgChannelMetadata,
    EpgProgram,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import {
    EpgLookupOptions,
    EpgRuntimeBridgeService,
} from './epg-runtime-bridge.service';
import { normalizeEpgPrograms } from './epg-program-normalization.util';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';

interface CachedProgram {
    program: EpgProgram | null;
    timestamp: number;
}

const debugEpgService = createDevLogger('EpgService');

@Injectable({
    providedIn: 'root',
})
export class EpgService {
    private snackBar = inject(MatSnackBar);
    private translate = inject(TranslateService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);
    private readonly settingsStore = inject(SettingsStore);

    private epgAvailable = new BehaviorSubject<boolean>(false);
    private currentEpgPrograms = new BehaviorSubject<EpgProgram[]>([]);

    // Cache for channel programs with 60-second TTL
    private programCache = new Map<string, CachedProgram>();
    private fetchingCurrentPrograms = new Map<
        string,
        Observable<EpgProgram | null>
    >();
    private fetchingCurrentProgramBatches = new Map<
        string,
        Observable<Map<string, EpgProgram | null>>
    >();
    private readonly CACHE_TTL = 60000; // 60 seconds

    readonly epgAvailable$ = this.epgAvailable.asObservable();
    readonly currentEpgPrograms$ = this.currentEpgPrograms.asObservable();

    /**
     * Fetches EPG from the given URLs
     */
    fetchEpg(urls: string[]): void {
        if (!this.epgBridge.supportsImport) return;

        // Filter out empty and duplicate URLs and send all URLs at once.
        const validUrls = normalizeEpgUrls(urls);
        if (validUrls.length === 0) return;

        from(
            this.epgBridge.fetchEpg(
                validUrls,
                this.settingsStore.getTrustOptions()
            )
        )
            .pipe(
                tap((result) => {
                    if (result === null) return;

                    if (result.success) {
                        this.clearCache();
                        this.epgAvailable.next(true);
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
        if (!this.epgBridge.supportsProgramLookup) return;
        debugEpgService('Fetching EPG for channel ID:', channelId);

        from(this.epgBridge.getChannelPrograms(channelId))
            .pipe(
                timeout(3000),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
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
    getCurrentProgramForChannel(
        channelId: string,
        options?: EpgLookupOptions
    ): Observable<EpgProgram | null> {
        if (!this.epgBridge.supportsProgramLookup || !channelId) {
            return of(null);
        }

        const sourceUrls = this.normalizeSourceUrls(options);
        if (sourceUrls.length > 0) {
            return this.getScopedCurrentProgramForChannel(
                channelId,
                sourceUrls,
                this.getGlobalEpgSourceUrls(sourceUrls)
            );
        }

        const globalSourceUrls = this.getGlobalEpgSourceUrls();
        if (globalSourceUrls.length > 0) {
            return this.getScopedCurrentProgramForChannel(
                channelId,
                globalSourceUrls,
                []
            );
        }

        // Check cache first
        const cacheKey = this.createProgramCacheKey(channelId);

        // Fetch from backend
        return this.getCachedOrFetchCurrentProgram(cacheKey, () =>
            from(this.epgBridge.getChannelPrograms(channelId)).pipe(
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                map((programs: EpgProgram[]) =>
                    this.findCurrentProgram(programs)
                ),
                catchError((err) => {
                    console.error('EPG get current program error:', err);
                    return of(null);
                })
            )
        );
    }

    /**
     * Finds the current program from a list of programs
     */
    private findCurrentProgram(programs: EpgProgram[]): EpgProgram | null {
        const now = new Date();

        return (
            programs.find((program) => {
                const start = new Date(program.start);
                const stop = new Date(program.stop);
                return start <= now && now <= stop;
            }) || null
        );
    }

    /**
     * Gets current programs for multiple channels (batch operation)
     * @param channelIds Array of channel IDs
     * @returns Observable of Map with channelId -> current program
     */
    getCurrentProgramsForChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgProgram | null>> {
        if (!this.epgBridge.supportsProgramLookup) {
            return of(new Map());
        }

        if (!channelIds || channelIds.length === 0) {
            return of(new Map());
        }

        const sourceUrls = this.normalizeSourceUrls(options);
        if (
            sourceUrls.length > 0 &&
            this.epgBridge.supportsCurrentProgramBatch
        ) {
            return this.getScopedCurrentProgramsForChannels(
                channelIds,
                sourceUrls
            );
        }

        const globalSourceUrls = this.getGlobalEpgSourceUrls();
        if (
            globalSourceUrls.length > 0 &&
            this.epgBridge.supportsCurrentProgramBatch
        ) {
            return this.getScopedCurrentProgramsForChannels(
                channelIds,
                globalSourceUrls,
                []
            );
        }

        const resultMap = new Map<string, EpgProgram | null>();
        const channelsToFetch: string[] = [];
        const now = Date.now();

        // Check cache for each channel
        channelIds.forEach((channelId) => {
            const cached = this.programCache.get(channelId);
            if (cached && now - cached.timestamp < this.CACHE_TTL) {
                resultMap.set(channelId, cached.program);
            } else {
                channelsToFetch.push(channelId);
            }
        });

        // If all channels were cached, return immediately
        if (channelsToFetch.length === 0) {
            return of(resultMap);
        }

        // Single batched IPC + SQL query when the backend supports it.
        // Replaces the legacy N+1 forkJoin where each channel fired its own
        // GET_CHANNEL_PROGRAMS round-trip.
        if (this.epgBridge.supportsCurrentProgramBatch) {
            return from(
                this.epgBridge.getCurrentProgramsBatch(channelsToFetch)
            ).pipe(
                timeout(5000),
                map((batchResult) => {
                    const cacheTimestamp = Date.now();
                    channelsToFetch.forEach((channelId) => {
                        const program = batchResult?.[channelId] ?? null;
                        resultMap.set(channelId, program);
                        this.programCache.set(channelId, {
                            program,
                            timestamp: cacheTimestamp,
                        });
                    });
                    return resultMap;
                }),
                catchError((err) => {
                    console.error('EPG batch current programs error:', err);
                    return of(resultMap);
                })
            );
        }

        // Fallback for older preload bundles without the batch endpoint.
        const fetchObservables = channelsToFetch.map((channelId) =>
            this.getCurrentProgramForChannel(channelId).pipe(
                timeout(5000),
                map((program) => ({ channelId, program })),
                catchError(() => of({ channelId, program: null }))
            )
        );

        return forkJoin(fetchObservables).pipe(
            map((results) => {
                results.forEach((result) => {
                    resultMap.set(result.channelId, result.program);
                });
                return resultMap;
            })
        );
    }

    private getScopedCurrentProgramsForChannels(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls = this.getGlobalEpgSourceUrls(sourceUrls)
    ): Observable<Map<string, EpgProgram | null>> {
        const normalizedChannelIds = this.normalizeChannelIds(channelIds);
        if (normalizedChannelIds.length === 0) {
            return of(new Map());
        }

        const resultMap = new Map<string, EpgProgram | null>();
        const channelsToFetch: string[] = [];

        normalizedChannelIds.forEach((channelId) => {
            const cached = this.getCachedProgram(
                this.createProgramCacheKey(channelId, sourceUrls)
            );
            if (cached) {
                resultMap.set(channelId, cached.program);
            } else {
                channelsToFetch.push(channelId);
            }
        });

        if (channelsToFetch.length === 0) {
            return of(resultMap);
        }

        const batchCacheKey = this.createProgramBatchCacheKey(
            channelsToFetch,
            sourceUrls,
            fallbackSourceUrls
        );
        const existingRequest =
            this.fetchingCurrentProgramBatches.get(batchCacheKey);
        const request$ =
            existingRequest ??
            this.fetchScopedCurrentProgramsBatch(
                channelsToFetch,
                sourceUrls,
                fallbackSourceUrls
            ).pipe(
                tap((fetchedMap) => {
                    const cacheTimestamp = Date.now();
                    channelsToFetch.forEach((channelId) => {
                        this.programCache.set(
                            this.createProgramCacheKey(channelId, sourceUrls),
                            {
                                program: fetchedMap.get(channelId) ?? null,
                                timestamp: cacheTimestamp,
                            }
                        );
                    });
                }),
                finalize(() => {
                    this.fetchingCurrentProgramBatches.delete(batchCacheKey);
                }),
                shareReplay({ bufferSize: 1, refCount: false })
            );

        if (!existingRequest) {
            this.fetchingCurrentProgramBatches.set(batchCacheKey, request$);
        }

        return request$.pipe(
            map((fetchedMap) => {
                const mergedResultMap = new Map(resultMap);
                channelsToFetch.forEach((channelId) => {
                    mergedResultMap.set(
                        channelId,
                        fetchedMap.get(channelId) ?? null
                    );
                });
                return mergedResultMap;
            })
        );
    }

    private fetchScopedCurrentProgramsBatch(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): Observable<Map<string, EpgProgram | null>> {
        return from(
            this.epgBridge.getCurrentProgramsBatch(channelIds, {
                sourceUrls,
            })
        ).pipe(
            timeout(5000),
            switchMap((scopedResult) => {
                const resultMap = new Map<string, EpgProgram | null>();
                const fallbackChannelIds: string[] = [];

                channelIds.forEach((channelId) => {
                    const program = scopedResult?.[channelId] ?? null;
                    resultMap.set(channelId, program);
                    if (!program) {
                        fallbackChannelIds.push(channelId);
                    }
                });

                if (fallbackChannelIds.length === 0) {
                    return of(resultMap);
                }

                if (fallbackSourceUrls.length === 0) {
                    return of(resultMap);
                }

                return from(
                    this.epgBridge.getCurrentProgramsBatch(fallbackChannelIds, {
                        sourceUrls: fallbackSourceUrls,
                    })
                ).pipe(
                    timeout(5000),
                    map((globalResult) => {
                        fallbackChannelIds.forEach((channelId) => {
                            resultMap.set(
                                channelId,
                                globalResult?.[channelId] ?? null
                            );
                        });
                        return resultMap;
                    }),
                    catchError((err) => {
                        console.error(
                            'EPG global fallback current programs error:',
                            err
                        );
                        return of(resultMap);
                    })
                );
            }),
            catchError((err) => {
                console.error('EPG scoped batch current programs error:', err);
                return of(this.createNullProgramMap(channelIds));
            })
        );
    }

    getChannelMetadataForChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgChannelMetadata | null>> {
        if (!this.epgBridge.supportsChannelMetadata) {
            return of(new Map());
        }

        const normalizedChannelIds = this.normalizeChannelIds(channelIds);

        if (normalizedChannelIds.length === 0) {
            return of(new Map());
        }

        const sourceUrls = this.normalizeSourceUrls(options);
        const globalSourceUrls =
            sourceUrls.length > 0
                ? this.getGlobalEpgSourceUrls(sourceUrls)
                : this.getGlobalEpgSourceUrls();
        const effectiveSourceUrls =
            sourceUrls.length > 0 ? sourceUrls : globalSourceUrls;

        return this.getChannelMetadataMapForSourceUrls(
            normalizedChannelIds,
            effectiveSourceUrls
        ).pipe(
            switchMap((metadataMap) => {
                const fallbackChannelIds =
                    sourceUrls.length > 0 && globalSourceUrls.length > 0
                        ? normalizedChannelIds.filter(
                              (channelId) => !metadataMap.get(channelId)
                          )
                        : [];

                if (fallbackChannelIds.length === 0) {
                    return of(metadataMap);
                }

                return this.getChannelMetadataMapForSourceUrls(
                    fallbackChannelIds,
                    globalSourceUrls
                ).pipe(
                    map((globalMetadataMap) => {
                        fallbackChannelIds.forEach((channelId) => {
                            metadataMap.set(
                                channelId,
                                globalMetadataMap.get(channelId) ?? null
                            );
                        });
                        return metadataMap;
                    }),
                    catchError((err) => {
                        console.error(
                            'EPG global fallback channel metadata error:',
                            err
                        );
                        return of(metadataMap);
                    })
                );
            })
        );
    }

    private normalizeChannelIds(channelIds: string[]): string[] {
        return Array.from(
            new Set(
                channelIds
                    .map((channelId) => channelId.trim())
                    .filter((channelId) => channelId.length > 0)
            )
        );
    }

    private normalizeSourceUrls(options?: EpgLookupOptions): string[] {
        return normalizeEpgUrls(options?.sourceUrls ?? []);
    }

    private getChannelMetadataMapForSourceUrls(
        channelIds: string[],
        sourceUrls: string[]
    ): Observable<Map<string, EpgChannelMetadata | null>> {
        return from(
            this.epgBridge.getChannelMetadata(
                channelIds,
                sourceUrls.length > 0 ? { sourceUrls } : undefined
            )
        ).pipe(
            map((metadataByChannelId) => {
                return new Map<string, EpgChannelMetadata | null>(
                    channelIds.map((channelId) => [
                        channelId,
                        metadataByChannelId?.[channelId] ?? null,
                    ])
                );
            }),
            catchError((err) => {
                console.error('EPG get channel metadata error:', err);
                return of(new Map<string, EpgChannelMetadata | null>());
            })
        );
    }

    private createProgramCacheKey(
        channelId: string,
        sourceUrls: string[] = []
    ): string {
        const normalizedSourceUrls = normalizeEpgUrls(sourceUrls);
        if (normalizedSourceUrls.length === 0) {
            return channelId;
        }

        return `source:${channelId}:${JSON.stringify(normalizedSourceUrls)}`;
    }

    private createProgramBatchCacheKey(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): string {
        return JSON.stringify({
            channelIds: [...channelIds].sort(),
            sourceUrls: normalizeEpgUrls(sourceUrls),
            fallbackSourceUrls: normalizeEpgUrls(fallbackSourceUrls),
        });
    }

    private getCachedProgram(cacheKey: string): CachedProgram | undefined {
        const cached = this.programCache.get(cacheKey);
        if (!cached) {
            return undefined;
        }

        if (Date.now() - cached.timestamp >= this.CACHE_TTL) {
            this.programCache.delete(cacheKey);
            return undefined;
        }

        return cached;
    }

    private getCachedOrFetchCurrentProgram(
        cacheKey: string,
        fetchProgram: () => Observable<EpgProgram | null>
    ): Observable<EpgProgram | null> {
        const cached = this.getCachedProgram(cacheKey);
        if (cached) {
            return of(cached.program);
        }

        const existingRequest = this.fetchingCurrentPrograms.get(cacheKey);
        if (existingRequest) {
            return existingRequest;
        }

        const request$ = fetchProgram().pipe(
            tap((program) => {
                this.programCache.set(cacheKey, {
                    program,
                    timestamp: Date.now(),
                });
            }),
            finalize(() => {
                this.fetchingCurrentPrograms.delete(cacheKey);
            }),
            shareReplay({ bufferSize: 1, refCount: false })
        );
        this.fetchingCurrentPrograms.set(cacheKey, request$);
        return request$;
    }

    private getScopedCurrentProgramForChannel(
        channelId: string,
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): Observable<EpgProgram | null> {
        const cacheKey = this.createProgramCacheKey(channelId, sourceUrls);

        return this.getCachedOrFetchCurrentProgram(cacheKey, () =>
            from(
                this.epgBridge.getChannelPrograms(channelId, { sourceUrls })
            ).pipe(
                timeout(3000),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                switchMap((programs) => {
                    const currentProgram = this.findCurrentProgram(programs);
                    if (currentProgram) {
                        return of(currentProgram);
                    }

                    return this.getFallbackCurrentProgramForChannel(
                        channelId,
                        fallbackSourceUrls
                    );
                }),
                catchError((err) => {
                    console.error('EPG scoped current program error:', err);
                    return this.getFallbackCurrentProgramForChannel(
                        channelId,
                        fallbackSourceUrls
                    );
                })
            )
        );
    }

    private getFallbackCurrentProgramForChannel(
        channelId: string,
        sourceUrls: string[]
    ): Observable<EpgProgram | null> {
        if (sourceUrls.length === 0) {
            return of(null);
        }

        return this.getScopedCurrentProgramForChannel(
            channelId,
            sourceUrls,
            []
        );
    }

    private createNullProgramMap(
        channelIds: string[]
    ): Map<string, EpgProgram | null> {
        return new Map(channelIds.map((channelId) => [channelId, null]));
    }

    private getGlobalEpgSourceUrls(excluding: string[] = []): string[] {
        const excludedUrls = new Set(excluding);
        return normalizeEpgUrls(
            this.settingsStore.getSettings().epgUrl ?? []
        ).filter((url) => !excludedUrls.has(url));
    }

    /**
     * Clears the program cache (useful when EPG is refreshed)
     */
    clearCache(): void {
        this.programCache.clear();
        this.fetchingCurrentPrograms.clear();
        this.fetchingCurrentProgramBatches.clear();
    }
}
