import { Observable, from, of } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { EpgLookupOptions } from './epg-runtime-bridge.service';
import { normalizeEpgPrograms } from './epg-program-normalization.util';
import { normalizeLookupSourceUrls } from './epg-lookup-normalization.util';
import type { EpgLookupContext } from './epg-lookup-context';

/**
 * "What is on air" for a single channel, and the scope ladder one channel
 * walks: the caller's sources, then the Settings-managed ones, then — for a
 * caller that asked for it — the whole imported pool. The batch lookup backs
 * its own per-channel work with these, so both shapes answer identically.
 */
export class EpgSingleProgramLookup {
    constructor(private readonly ctx: EpgLookupContext) {}

    /**
     * Gets the current EPG program for a specific channel (with caching)
     * @param channelId Channel ID (tvg-id or channel name)
     * @returns Observable of current program or null
     */
    forChannel(
        channelId: string,
        options?: EpgLookupOptions
    ): Observable<EpgProgram | null> {
        if (!this.ctx.bridge.supportsProgramLookup || !channelId) {
            return of(null);
        }

        const sourceUrls = normalizeLookupSourceUrls(options);
        if (sourceUrls.length > 0) {
            return this.scoped(
                channelId,
                sourceUrls,
                this.ctx.globalSourceUrls(sourceUrls)
            );
        }

        const globalSourceUrls = this.ctx.globalSourceUrls();
        if (globalSourceUrls.length > 0) {
            return this.scoped(channelId, globalSourceUrls, []);
        }

        return this.unscoped(channelId);
    }

    /**
     * The lookup across every imported source, cached under the source-less
     * key. Kept separate from `getCurrentProgramForChannel`, which re-applies
     * the Settings-managed scope whenever global URLs exist: a caller that
     * has already decided it wants the unscoped pool — the `anySourceFallback`
     * retry on a preload without the batch endpoint — must not have that
     * scope put back on.
     */
    unscoped(channelId: string): Observable<EpgProgram | null> {
        // Check cache first
        const cacheKey = this.ctx.cache.keyFor(channelId);

        // Fetch from backend
        return this.ctx.cache.getOrFetch(cacheKey, () =>
            from(this.ctx.bridge.getChannelPrograms(channelId)).pipe(
                this.ctx.guard(),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                map((programs: EpgProgram[]) => this.findCurrent(programs)),
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
    findCurrent(programs: EpgProgram[]): EpgProgram | null {
        const now = this.ctx.clockMs();

        return (
            programs.find((program) => {
                const start = new Date(program.start).getTime();
                const stop = new Date(program.stop).getTime();
                return start <= now && now <= stop;
            }) || null
        );
    }

    scoped(
        channelId: string,
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): Observable<EpgProgram | null> {
        const cacheKey = this.ctx.cache.keyFor(channelId, sourceUrls);

        return this.ctx.cache.getOrFetch(cacheKey, () =>
            from(
                this.ctx.bridge.getChannelPrograms(channelId, { sourceUrls })
            ).pipe(
                this.ctx.guard(),
                timeout(3000),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                switchMap((programs) => {
                    const currentProgram = this.findCurrent(programs);
                    if (currentProgram) {
                        return of(currentProgram);
                    }

                    return this.fallbackFor(channelId, fallbackSourceUrls);
                }),
                catchError((err) => {
                    console.error('EPG scoped current program error:', err);
                    return this.fallbackFor(channelId, fallbackSourceUrls);
                })
            )
        );
    }

    private fallbackFor(
        channelId: string,
        sourceUrls: string[]
    ): Observable<EpgProgram | null> {
        if (sourceUrls.length === 0) {
            return of(null);
        }

        return this.scoped(channelId, sourceUrls, []);
    }
}
