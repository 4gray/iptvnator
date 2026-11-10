import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
} from '@angular/core';
import { createDevLogger, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideWindow,
} from './epg-guide-source';

/** Channels per `loadPrograms` call (the programme IPC caps at 100 keys). */
export const EPG_GUIDE_LOAD_CHUNK = 100;
/**
 * Channels per `loadCoverage` call. Deliberately half the IPC's 2000-key cap:
 * it leaves headroom for the host to append keys to the same request (e.g. a
 * scope change mid-flight) without immediately needing a second chunk and a
 * new round-trip contract.
 */
export const EPG_GUIDE_COVERAGE_CHUNK = 1000;

export type EpgGuideRowStatus =
    'idle' | 'loading' | 'loaded' | 'none' | 'error';

const EMPTY: readonly EpgProgram[] = [];

const debugEpgGuidePrograms = createDevLogger('EpgGuideProgramsService');

/** A channel is only ever requested when it carries a real, non-blank key. */
function hasEpgKey(channel: EpgGuideChannel): boolean {
    return (
        typeof channel.epgKey === 'string' && channel.epgKey.trim().length > 0
    );
}

/**
 * Per-day programme cache for the guide. Programmes load lazily for the rows
 * the viewport asks about. Coverage checks the whole scope, on demand for
 * per-stream providers. Window, scope and source changes abort old reads.
 */
@Injectable()
export class EpgGuideProgramsService {
    private readonly source = inject(EPG_GUIDE_SOURCE);

    private readonly programs = signal<
        ReadonlyMap<string, readonly EpgProgram[]>
    >(new Map());
    private readonly statuses = signal<ReadonlyMap<string, EpgGuideRowStatus>>(
        new Map()
    );
    private readonly coverage = signal<ReadonlySet<string> | null>(null);

    private range: { fromMs: number; toMs: number } | null = null;
    private readonly programRequests = new Map<
        AbortController,
        EpgGuideChannel[]
    >();
    private coverageRequest?: AbortController;
    private coverageRequested = false;
    private visibleRows = new Set<string>();
    /** Last channel reference seen by the constructor effect (see below). */
    private seenChannels: readonly EpgGuideChannel[] | null = null;
    private seenRevision: unknown;

    readonly coverageLoaded = computed(() => this.coverage() !== null);
    readonly coverageStatus = signal<'idle' | 'loading' | 'error'>('idle');

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.cancelProgramRequests();
            this.coverageRequest?.abort();
        });
        // A new channel set (scope change) invalidates everything, including
        // coverage: the toggle must be answered for the new rows. The first
        // effect run must NOT invalidate: a host can call `setWindow` (and
        // thus `ensureLoaded`) before the initial change-detection flush, and
        // invalidating here would bump the generation and drop that
        // in-flight request's answer along with any coverage it kicked off.
        effect(() => {
            const next = this.source.channels();
            const revision = this.source.revision?.();
            if (next === this.seenChannels && revision === this.seenRevision) {
                return;
            }
            const first = this.seenChannels === null;
            this.seenChannels = next;
            this.seenRevision = revision;
            if (first) {
                return;
            }
            this.invalidate();
            this.requestCoverage();
        });
    }

    setCoverageRequested(requested: boolean): void {
        if (
            !this.source.deferredCoverage ||
            requested === this.coverageRequested
        ) {
            return;
        }
        this.coverageRequested = requested;
        if (requested && !this.coverageLoaded()) {
            this.requestCoverage();
        } else if (!requested) {
            this.coverageRequest?.abort();
            this.coverageStatus.set('idle');
        }
    }

    setWindow(fromMs: number, toMs: number): void {
        if (this.range?.fromMs === fromMs && this.range?.toMs === toMs) {
            return;
        }
        this.range = { fromMs, toMs };
        this.invalidate();
        this.requestCoverage();
    }

    programsFor(channelId: string): readonly EpgProgram[] {
        return this.programs().get(channelId) ?? EMPTY;
    }

    statusFor(channelId: string): EpgGuideRowStatus {
        return this.statuses().get(channelId) ?? 'idle';
    }

    /** Unknown (coverage not loaded yet, or a chunk failed) counts as covered
     * so rows never blink. */
    isCovered(channelId: string): boolean {
        const coverage = this.coverage();
        return coverage === null || coverage.has(channelId);
    }

    /** Request programmes for rows that are idle, discarding obsolete per-stream work. */
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const range = this.range;
        if (!range) {
            return;
        }
        const previousRows = this.visibleRows;
        const visible = new Set(channels.map((channel) => channel.id));
        this.visibleRows = visible;
        if (this.source.programBatchSize) {
            const cancelled: Array<[string, EpgGuideRowStatus]> = [];
            for (const [request, rows] of this.programRequests) {
                if (rows.some((row) => visible.has(row.id))) continue;
                request.abort();
                this.programRequests.delete(request);
                cancelled.push(
                    ...rows.map((row): [string, EpgGuideRowStatus] => [
                        row.id,
                        'idle',
                    ])
                );
            }
            if (cancelled.length) this.patchStatuses(cancelled);
        }
        const pending = channels.filter((channel) => {
            const status = this.statusFor(channel.id);
            return (
                hasEpgKey(channel) &&
                (status === 'idle' ||
                    (status === 'error' && !previousRows.has(channel.id)))
            );
        });
        if (pending.length === 0) {
            return;
        }
        this.patchStatuses(pending.map((channel) => [channel.id, 'loading']));
        const batchSize = this.source.programBatchSize ?? EPG_GUIDE_LOAD_CHUNK;
        for (let start = 0; start < pending.length; start += batchSize) {
            const chunk = pending.slice(start, start + batchSize);
            const request = new AbortController();
            this.programRequests.set(request, chunk);
            this.loadChunk(
                { channels: chunk, ...range, signal: request.signal },
                request
            );
        }
    }

    private loadChunk(
        request: EpgGuideWindow,
        controller: AbortController
    ): void {
        this.source
            .loadPrograms(request)
            .then(
                (result) => result,
                () => {
                    if (!controller.signal.aborted)
                        debugEpgGuidePrograms(
                            'loadPrograms failed for a chunk',
                            { channelCount: request.channels.length }
                        );
                    return null;
                }
            )
            .then((result) => {
                this.programRequests.delete(controller);
                if (controller.signal.aborted) {
                    return;
                }
                const next = new Map(this.programs());
                for (const channel of request.channels) {
                    next.set(channel.id, result?.get(channel.id) ?? EMPTY);
                }
                this.programs.set(next);
                this.patchStatuses(
                    request.channels.map((channel) => [
                        channel.id,
                        result?.has(channel.id) ? 'loaded' : 'error',
                    ])
                );
            });
    }

    private requestCoverage(): void {
        const range = this.range;
        if (
            !range ||
            (this.source.deferredCoverage && !this.coverageRequested)
        ) {
            return;
        }
        const request = new AbortController();
        this.coverageRequest = request;
        this.coverageStatus.set('loading');
        const keyed = this.source.channels().filter(hasEpgKey);
        const chunks: EpgGuideChannel[][] = [];
        for (
            let start = 0;
            start < keyed.length;
            start += EPG_GUIDE_COVERAGE_CHUNK
        ) {
            chunks.push(keyed.slice(start, start + EPG_GUIDE_COVERAGE_CHUNK));
        }
        Promise.all(
            chunks.map((channels) =>
                this.source
                    .loadCoverage({
                        channels,
                        ...range,
                        signal: request.signal,
                    })
                    .then(
                        (covered) => covered,
                        () => null
                    )
            )
        ).then((sets) => {
            if (request.signal.aborted) {
                return;
            }
            // Fail open: if any chunk failed, coverage stays unknown (`null`)
            // rather than publishing a partial/empty set that would hide rows
            // that do have programmes.
            if (sets.some((set) => set === null)) {
                debugEpgGuidePrograms(
                    'loadCoverage failed for a chunk; leaving coverage unknown',
                    { chunkCount: sets.length }
                );
                this.coverageStatus.set('error');
                return;
            }
            const merged = new Set<string>();
            for (const set of sets) {
                if (set === null) {
                    continue;
                }
                set.forEach((id) => merged.add(id));
            }
            this.coverage.set(merged);
            this.coverageStatus.set('idle');
        });
    }

    private invalidate(): void {
        this.cancelProgramRequests();
        this.visibleRows.clear();
        this.coverageRequest?.abort();
        this.coverageStatus.set('idle');
        this.programs.set(new Map());
        this.statuses.set(
            new Map(
                this.source
                    .channels()
                    .filter((channel) => !hasEpgKey(channel))
                    .map((channel) => [channel.id, 'none' as const])
            )
        );
        this.coverage.set(null);
    }

    private cancelProgramRequests(): void {
        this.programRequests.forEach((_rows, controller) => controller.abort());
        this.programRequests.clear();
    }

    private patchStatuses(entries: Array<[string, EpgGuideRowStatus]>): void {
        const next = new Map(this.statuses());
        for (const [id, status] of entries) {
            next.set(id, status);
        }
        this.statuses.set(next);
    }
}
