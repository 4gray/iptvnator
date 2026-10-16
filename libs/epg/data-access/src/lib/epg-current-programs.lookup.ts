import { Observable, forkJoin, from, of } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgLookupOptions } from './epg-runtime-bridge.service';
import {
    normalizeLookupChannelIds,
    normalizeLookupSourceUrls,
} from './epg-lookup-normalization.util';
import type { EpgLookupContext } from './epg-lookup-context';
import { EpgSingleProgramLookup } from './epg-single-program.lookup';
import { EpgScopedBatchLookup } from './epg-scoped-batch.lookup';

/**
 * "What is on air right now" for a batch of channels.
 *
 * The source-scope ladder lives here: the caller's playlist sources first,
 * then the Settings-managed global ones, and — only when the caller opts in
 * with `anySourceFallback` — a final retry across every imported guide. A
 * bridge without the batch endpoint walks the same ladder one channel at a
 * time through `EpgSingleProgramLookup`, so both shapes answer identically.
 */
export class EpgCurrentProgramsLookup {
    constructor(
        private readonly ctx: EpgLookupContext,
        private readonly single: EpgSingleProgramLookup,
        private readonly scopedBatch: EpgScopedBatchLookup
    ) {}

    /**
     * Gets current programs for multiple channels (batch operation)
     * @param channelIds Array of channel IDs
     * @returns Observable of Map with channelId -> current program
     */
    forChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgProgram | null>> {
        if (!this.ctx.bridge.supportsProgramLookup) {
            return of(new Map());
        }

        if (!channelIds || channelIds.length === 0) {
            return of(new Map());
        }

        const scoped$ = this.getSourceScopedCurrentProgramsForChannels(
            channelIds,
            options
        );
        if (!scoped$) {
            // Nothing declares a scope — neither the caller nor Settings — so
            // the pool of every imported source is the only answer there is.
            return this.getUnscopedCurrentProgramsForChannels(channelIds);
        }
        if (!options?.anySourceFallback) {
            return scoped$;
        }

        return scoped$.pipe(
            switchMap((scopedMap) => this.fillFromAnySource(scopedMap))
        );
    }

    /**
     * The scoped lookup: the caller's playlist sources first (with the global
     * sources as fallback), else the Settings-managed global sources alone.
     * `null` when no scope applies and the unscoped pool is the only answer.
     *
     * The ladder is the same whether or not the bridge has the batch
     * endpoint. Collapsing a legacy preload straight into the source-less
     * lookup would drop the caller's scope entirely, which is exactly what
     * the scopes exist to prevent: two imported guides reusing one XMLTV id
     * would answer each other's channels.
     */
    private getSourceScopedCurrentProgramsForChannels(
        channelIds: string[],
        options?: EpgLookupOptions
    ): Observable<Map<string, EpgProgram | null>> | null {
        const sourceUrls = normalizeLookupSourceUrls(options);
        if (sourceUrls.length > 0) {
            return this.scopedCurrentProgramsForChannels(
                channelIds,
                sourceUrls,
                this.ctx.globalSourceUrls(sourceUrls)
            );
        }

        const globalSourceUrls = this.ctx.globalSourceUrls();
        if (globalSourceUrls.length > 0) {
            return this.scopedCurrentProgramsForChannels(
                channelIds,
                globalSourceUrls,
                []
            );
        }

        return null;
    }

    /** One scoped batch, or its per-channel equivalent on an older preload. */
    private scopedCurrentProgramsForChannels(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): Observable<Map<string, EpgProgram | null>> {
        if (this.ctx.bridge.supportsCurrentProgramBatch) {
            return this.scopedBatch.forChannels(
                channelIds,
                sourceUrls,
                fallbackSourceUrls
            );
        }

        const normalizedChannelIds = normalizeLookupChannelIds(channelIds);
        if (normalizedChannelIds.length === 0) {
            return of(new Map());
        }

        // The per-channel lookup walks the same scope -> fallback-scope
        // ladder the batch query does, and caches under the same scoped key.
        return forkJoin(
            normalizedChannelIds.map((channelId) =>
                this.single
                    .scoped(channelId, sourceUrls, fallbackSourceUrls)
                    .pipe(
                        this.ctx.guard(),
                        timeout(5000),
                        map((program) => ({ channelId, program })),
                        catchError(() => of({ channelId, program: null }))
                    )
            )
        ).pipe(
            this.ctx.guard(),
            map(
                (results) =>
                    new Map(
                        results.map((result) => [
                            result.channelId,
                            result.program,
                        ])
                    )
            )
        );
    }

    /**
     * `anySourceFallback`: keys the scope answered with `null` are retried
     * against every imported source. A scoped miss is kept as the answer
     * when the pool has nothing either, so the merged map still names every
     * requested key.
     */
    private fillFromAnySource(
        scopedMap: Map<string, EpgProgram | null>
    ): Observable<Map<string, EpgProgram | null>> {
        const unresolvedIds = Array.from(scopedMap.entries())
            .filter(([, program]) => !program)
            .map(([channelId]) => channelId);
        if (unresolvedIds.length === 0) {
            return of(scopedMap);
        }

        return this.getUnscopedCurrentProgramsForChannels(unresolvedIds).pipe(
            map((anySourceMap) => {
                const mergedMap = new Map(scopedMap);
                anySourceMap.forEach((program, channelId) => {
                    if (program) {
                        mergedMap.set(channelId, program);
                    }
                });
                return mergedMap;
            })
        );
    }

    /** Lookup across every imported source, cached under the source-less key. */
    private getUnscopedCurrentProgramsForChannels(
        channelIds: string[]
    ): Observable<Map<string, EpgProgram | null>> {
        const resultMap = new Map<string, EpgProgram | null>();
        const channelsToFetch: string[] = [];
        const now = Date.now();
        const offsetMinutes = this.ctx.offsetMinutes();

        // Check cache for each channel
        channelIds.forEach((channelId) => {
            const cached = this.ctx.cache.getFresh(channelId, now);
            if (cached && cached.offsetMinutes === offsetMinutes) {
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
        if (this.ctx.bridge.supportsCurrentProgramBatch) {
            return from(
                this.ctx.bridge.getCurrentProgramsBatch(channelsToFetch, {
                    nowMs: this.ctx.clockMs(),
                })
            ).pipe(
                this.ctx.guard(),
                timeout(5000),
                map((batchResult) => {
                    const cacheTimestamp = Date.now();
                    channelsToFetch.forEach((channelId) => {
                        const program = batchResult?.[channelId] ?? null;
                        resultMap.set(channelId, program);
                        this.ctx.cache.set(
                            channelId,
                            program,
                            offsetMinutes,
                            cacheTimestamp
                        );
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
        // Deliberately the unscoped per-channel lookup: everything reaching
        // here wants the source-less pool — either nothing declared a scope,
        // or this is the any-source retry after the scoped pass. The public
        // `getCurrentProgramForChannel` would put the Settings scope back on
        // and make the retry re-ask the question the scoped pass answered.
        const fetchObservables = channelsToFetch.map((channelId) =>
            this.single.unscoped(channelId).pipe(
                this.ctx.guard(),
                timeout(5000),
                map((program) => ({ channelId, program })),
                catchError(() => of({ channelId, program: null }))
            )
        );

        return forkJoin(fetchObservables).pipe(
            this.ctx.guard(),
            map((results) => {
                results.forEach((result) => {
                    resultMap.set(result.channelId, result.program);
                });
                return resultMap;
            })
        );
    }
}
