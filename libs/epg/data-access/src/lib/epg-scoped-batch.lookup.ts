import { Observable, from, of } from 'rxjs';
import {
    catchError,
    finalize,
    map,
    shareReplay,
    switchMap,
    tap,
    timeout,
} from 'rxjs/operators';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { normalizeLookupChannelIds } from './epg-lookup-normalization.util';
import type { EpgLookupContext } from './epg-lookup-context';

/**
 * How ONE scope is asked: the per-channel cache in front of the request, the
 * order-insensitive deduplication of identical batches still in flight, and
 * the retry of whatever that scope could not answer against the fallback
 * scope. `EpgCurrentProgramsLookup` decides WHICH scope to ask.
 */
export class EpgScopedBatchLookup {
    constructor(private readonly ctx: EpgLookupContext) {}

    forChannels(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls = this.ctx.globalSourceUrls(sourceUrls)
    ): Observable<Map<string, EpgProgram | null>> {
        const normalizedChannelIds = normalizeLookupChannelIds(channelIds);
        if (normalizedChannelIds.length === 0) {
            return of(new Map());
        }

        const resultMap = new Map<string, EpgProgram | null>();
        const channelsToFetch: string[] = [];

        normalizedChannelIds.forEach((channelId) => {
            const cached = this.ctx.cache.get(
                this.ctx.cache.keyFor(channelId, sourceUrls)
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

        const batchCacheKey = this.ctx.cache.batchKeyFor(
            channelsToFetch,
            sourceUrls,
            fallbackSourceUrls
        );
        const existingRequest = this.ctx.cache.batchInFlight(batchCacheKey);
        // Tag entries with the offset the verdict was computed with, not the
        // one current when the response lands.
        const offsetMinutes = this.ctx.offsetMinutes();
        const request$ =
            existingRequest ??
            this.fetchBatch(
                channelsToFetch,
                sourceUrls,
                fallbackSourceUrls
            ).pipe(
                this.ctx.guard(),
                tap((fetchedMap) => {
                    const cacheTimestamp = Date.now();
                    channelsToFetch.forEach((channelId) => {
                        this.ctx.cache.set(
                            this.ctx.cache.keyFor(channelId, sourceUrls),
                            fetchedMap.get(channelId) ?? null,
                            offsetMinutes,
                            cacheTimestamp
                        );
                    });
                }),
                finalize(() =>
                    this.ctx.cache.releaseBatch(batchCacheKey, request$)
                ),
                shareReplay({ bufferSize: 1, refCount: false })
            );

        if (!existingRequest) {
            this.ctx.cache.registerBatch(batchCacheKey, request$);
        }

        return request$.pipe(
            this.ctx.guard(),
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

    private fetchBatch(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): Observable<Map<string, EpgProgram | null>> {
        const nowMs = this.ctx.clockMs();
        return from(
            this.ctx.bridge.getCurrentProgramsBatch(channelIds, {
                sourceUrls,
                nowMs,
            })
        ).pipe(
            this.ctx.guard(),
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
                    this.ctx.bridge.getCurrentProgramsBatch(
                        fallbackChannelIds,
                        {
                            sourceUrls: fallbackSourceUrls,
                            nowMs,
                        }
                    )
                ).pipe(
                    this.ctx.guard(),
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
                return of(this.nullProgramMap(channelIds));
            })
        );
    }

    private nullProgramMap(
        channelIds: string[]
    ): Map<string, EpgProgram | null> {
        return new Map(channelIds.map((channelId) => [channelId, null]));
    }
}
