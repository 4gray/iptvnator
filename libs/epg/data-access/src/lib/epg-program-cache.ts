import { MonoTypeOperatorFunction, Observable, of } from 'rxjs';
import { finalize, shareReplay, tap } from 'rxjs/operators';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';

export interface CachedProgram {
    program: EpgProgram | null;
    timestamp: number;
    /** Display offset the "now" verdict was computed with; a changed setting invalidates the entry. */
    offsetMinutes: number;
}

const CACHE_TTL_MS = 60000;

/**
 * The 60 s "currently airing" memory behind every lookup in `EpgService`,
 * plus the in-flight requests sharing one answer.
 *
 * Owning it here keeps one rule in one place: an entry answers "what is on
 * at the provider clock, in this source scope", so the scope and the display
 * offset are both part of its identity. A lookup issued after the offset
 * changed must neither read the previous entry nor join a request still in
 * flight for it.
 *
 * Deliberately not `@Injectable`: it has no dependencies of its own, it
 * takes the two facts it cannot know (the current offset, and the operator
 * that retires work across an EPG source change) from its owner.
 */
export class EpgProgramCache {
    private readonly programs = new Map<string, CachedProgram>();
    private readonly inFlight = new Map<
        string,
        Observable<EpgProgram | null>
    >();
    private readonly inFlightBatches = new Map<
        string,
        Observable<Map<string, EpgProgram | null>>
    >();

    constructor(
        private readonly offsetMinutes: () => number,
        private readonly guard: <T>() => MonoTypeOperatorFunction<T>
    ) {}

    /** Cache and in-flight identity of a single-channel lookup. */
    keyFor(channelId: string, sourceUrls: string[] = []): string {
        const normalizedSourceUrls = normalizeEpgUrls(sourceUrls);
        const key =
            normalizedSourceUrls.length === 0
                ? channelId
                : `source:${channelId}:${JSON.stringify(normalizedSourceUrls)}`;
        const offsetMinutes = this.offsetMinutes();
        return offsetMinutes === 0 ? key : `${key}|offset:${offsetMinutes}`;
    }

    /** Identity of a batch request; order-insensitive in the channel ids. */
    batchKeyFor(
        channelIds: string[],
        sourceUrls: string[],
        fallbackSourceUrls: string[]
    ): string {
        return JSON.stringify({
            channelIds: [...channelIds].sort(),
            sourceUrls: normalizeEpgUrls(sourceUrls),
            fallbackSourceUrls: normalizeEpgUrls(fallbackSourceUrls),
            offsetMinutes: this.offsetMinutes(),
        });
    }

    /** A live entry, or `undefined` once it expired or the offset moved. */
    get(cacheKey: string): CachedProgram | undefined {
        const cached = this.programs.get(cacheKey);
        if (!cached) {
            return undefined;
        }

        if (
            Date.now() - cached.timestamp >= CACHE_TTL_MS ||
            cached.offsetMinutes !== this.offsetMinutes()
        ) {
            this.programs.delete(cacheKey);
            return undefined;
        }

        return cached;
    }

    /**
     * `offsetMinutes` is the offset the verdict was computed with, not the
     * one current when the answer lands.
     */
    set(
        cacheKey: string,
        program: EpgProgram | null,
        offsetMinutes: number,
        timestamp = Date.now()
    ): void {
        this.programs.set(cacheKey, { program, timestamp, offsetMinutes });
    }

    /** Unexpired entry without the scope/offset checks `get` applies. */
    getFresh(cacheKey: string, now: number): CachedProgram | undefined {
        const cached = this.programs.get(cacheKey);
        return cached && now - cached.timestamp < CACHE_TTL_MS
            ? cached
            : undefined;
    }

    /** The cached answer, an in-flight one, else one started from `fetch`. */
    getOrFetch(
        cacheKey: string,
        fetchProgram: () => Observable<EpgProgram | null>
    ): Observable<EpgProgram | null> {
        const cached = this.get(cacheKey);
        if (cached) {
            return of(cached.program);
        }

        const existingRequest = this.inFlight.get(cacheKey);
        if (existingRequest) {
            return existingRequest;
        }

        const offsetMinutes = this.offsetMinutes();
        const request$ = fetchProgram().pipe(
            this.guard<EpgProgram | null>(),
            tap((program) => this.set(cacheKey, program, offsetMinutes)),
            finalize(() => {
                if (this.inFlight.get(cacheKey) === request$)
                    this.inFlight.delete(cacheKey);
            }),
            shareReplay({ bufferSize: 1, refCount: false })
        );
        this.inFlight.set(cacheKey, request$);
        return request$;
    }

    batchInFlight(
        batchCacheKey: string
    ): Observable<Map<string, EpgProgram | null>> | undefined {
        return this.inFlightBatches.get(batchCacheKey);
    }

    registerBatch(
        batchCacheKey: string,
        request$: Observable<Map<string, EpgProgram | null>>
    ): void {
        this.inFlightBatches.set(batchCacheKey, request$);
    }

    /** Only the request that owns the slot may release it. */
    releaseBatch(
        batchCacheKey: string,
        request$: Observable<Map<string, EpgProgram | null>>
    ): void {
        if (this.inFlightBatches.get(batchCacheKey) === request$) {
            this.inFlightBatches.delete(batchCacheKey);
        }
    }

    clear(): void {
        this.programs.clear();
        this.inFlight.clear();
        this.inFlightBatches.clear();
    }
}
