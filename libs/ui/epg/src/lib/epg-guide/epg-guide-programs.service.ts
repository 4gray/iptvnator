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
const COVERAGE_BATCH_MS = 200;

const debugEpgGuidePrograms = createDevLogger('EpgGuideProgramsService');

interface CoverageScan {
    controller: AbortController;
    progress?: {
        confirmed: Set<string>;
        uncovered: Map<string, number>;
        timer?: ReturnType<typeof setTimeout>;
    };
}

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
    private readonly uncovered = signal<ReadonlyMap<string, number> | null>(
        null
    );

    private range: { fromMs: number; toMs: number } | null = null;
    private readonly programRequests = new Map<
        AbortController,
        EpgGuideChannel[]
    >();
    private coverageRequest?: CoverageScan;
    private coverageRequested = false;
    private readonly failedCoverage = new Set<string>();
    private readonly rowExpiry = new Map<string, number>();
    private visibleRows = new Set<string>();
    /** Last channel reference seen by the constructor effect (see below). */
    private seenChannels: readonly EpgGuideChannel[] | null = null;
    private seenRevision: unknown;

    readonly coverageLoaded = computed(() => this.uncovered() !== null);
    readonly coverageStatus = signal<'idle' | 'loading' | 'error'>('idle');

    constructor() {
        inject(DestroyRef).onDestroy(() => {
            this.cancelProgramRequests();
            this.cancelCoverageRequest();
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
            if (next === this.seenChannels && revision === this.seenRevision)
                return;
            const first = this.seenChannels === null;
            this.seenChannels = next;
            this.seenRevision = revision;
            if (first) return;
            this.invalidate();
            this.requestCoverage();
        });
    }

    setCoverageRequested(requested: boolean): void {
        if (
            !this.source.deferredCoverage ||
            requested === this.coverageRequested
        )
            return;
        this.coverageRequested = requested;
        if (requested) {
            this.requestCoverage();
        } else {
            this.cancelCoverageRequest();
            this.coverageStatus.set('idle');
        }
    }

    setWindow(fromMs: number, toMs: number): void {
        if (this.range?.fromMs === fromMs && this.range?.toMs === toMs) return;
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
    isCovered(channelId: string, nowMs?: number): boolean {
        const expiry = this.uncovered()?.get(channelId);
        return (
            expiry === undefined ||
            (expiry < Infinity && expiry <= (nowMs ?? Date.now()))
        );
    }

    refreshExpiredCoverage(nowMs: number): void {
        if (!this.coverageRequested || this.coverageRequest) return;
        const uncovered = this.uncovered();
        const expired =
            uncovered &&
            this.source
                .channels()
                .filter(({ id }) => (uncovered.get(id) ?? Infinity) <= nowMs);
        if (expired?.length) this.requestCoverage(expired);
    }

    /** Request programmes for rows that are idle, discarding obsolete per-stream work. */
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const range = this.range;
        if (!range) return;
        const previousRows = this.visibleRows;
        const visible = new Set(channels.map((channel) => channel.id));
        this.visibleRows = visible;
        if (this.source.programBatchSize) {
            for (const [request, rows] of this.programRequests) {
                if (rows.some((row) => visible.has(row.id))) continue;
                request.abort();
                this.programRequests.delete(request);
            }
            const departed = [...previousRows].filter((id) => !visible.has(id));
            if (departed.length) {
                const programs = new Map(this.programs());
                const statuses = new Map(this.statuses());
                for (const id of departed) {
                    programs.delete(id);
                    if (statuses.get(id) !== 'none') statuses.delete(id);
                    this.rowExpiry.delete(id);
                }
                this.programs.set(programs);
                this.statuses.set(statuses);
            }
        }
        const now = Date.now();
        const pending = channels.filter((channel) => {
            const status = this.statusFor(channel.id);
            return (
                hasEpgKey(channel) &&
                (status === 'idle' ||
                    (status === 'loaded' &&
                        (this.rowExpiry.get(channel.id) ?? Infinity) <= now) ||
                    (status === 'error' && !previousRows.has(channel.id)))
            );
        });
        if (!pending.length) return;
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
                this.storePrograms(
                    request.channels
                        .filter(
                            ({ id }) =>
                                !this.source.programBatchSize ||
                                this.visibleRows.has(id)
                        )
                        .map(({ id }) => [id, result?.get(id)])
                );
                const uncovered = this.uncovered();
                if (this.source.deferredCoverage && result) {
                    let updated: Map<string, number> | undefined;
                    for (const [id, programs] of result) {
                        const hasPrograms = programs.length > 0;
                        const scan = this.coverageRequest;
                        if (scan?.progress) {
                            this.reportCoverage(scan, id, hasPrograms);
                            continue;
                        }
                        if (
                            uncovered &&
                            this.failedCoverage.delete(id) &&
                            this.failedCoverage.size === 0
                        ) {
                            this.coverageStatus.set('idle');
                        }
                        if (!uncovered) continue;
                        const expiry = this.negativeCoverageExpiry(
                            id,
                            hasPrograms
                        );
                        if (uncovered.get(id) === expiry) continue;
                        updated ??= new Map(uncovered);
                        if (expiry === undefined) updated.delete(id);
                        else updated.set(id, expiry);
                    }
                    if (updated) this.uncovered.set(updated);
                }
            });
    }

    private storePrograms(
        entries: ReadonlyArray<
            readonly [string, readonly EpgProgram[] | undefined]
        >
    ): void {
        const next = new Map(this.programs());
        for (const [id, programs] of entries) {
            next.set(id, programs ?? EMPTY);
            const expiresAt = programs
                ? this.source.programsExpireAt?.(id)
                : undefined;
            if (expiresAt !== undefined) this.rowExpiry.set(id, expiresAt);
        }
        this.programs.set(next);
        this.patchStatuses(
            entries.map(([id, programs]) => [id, programs ? 'loaded' : 'error'])
        );
    }

    private negativeCoverageExpiry(
        id: string,
        hasPrograms: boolean
    ): number | undefined {
        return hasPrograms
            ? undefined
            : (this.source.programsExpireAt?.(id) ?? Infinity);
    }

    private reportCoverage(
        scan: CoverageScan,
        id: string,
        hasPrograms: boolean
    ): void {
        const progress = scan.progress;
        if (!progress) return;
        progress.confirmed.add(id);
        this.failedCoverage.delete(id);
        const expiry = this.negativeCoverageExpiry(id, hasPrograms);
        if (progress.uncovered.get(id) === expiry) return;
        if (expiry === undefined) progress.uncovered.delete(id);
        else progress.uncovered.set(id, expiry);
        progress.timer ??= setTimeout(() => {
            progress.timer = undefined;
            this.uncovered.set(new Map(progress.uncovered));
        }, COVERAGE_BATCH_MS);
    }

    private requestCoverage(recheck?: readonly EpgGuideChannel[]): void {
        const range = this.range;
        if (!range || (this.source.deferredCoverage && !this.coverageRequested))
            return;
        const request = new AbortController();
        const scan: CoverageScan = { controller: request };
        if (this.source.deferredCoverage) {
            scan.progress = {
                confirmed: new Set(),
                uncovered: new Map(recheck ? this.uncovered() : null),
            };
            if (!recheck) this.uncovered.set(null);
        }
        this.coverageRequest = scan;
        this.coverageStatus.set('loading');
        const channels = recheck ?? this.source.channels();
        const keyed = channels.filter(hasEpgKey);
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
                    .loadCoverage(
                        { channels, ...range, signal: request.signal },
                        (id, programs) => {
                            if (request.signal.aborted) return;
                            if (programs === null) {
                                if (!scan.progress?.confirmed.has(id))
                                    this.failedCoverage.add(id);
                                return;
                            }
                            this.reportCoverage(scan, id, programs.length > 0);
                            if (
                                this.visibleRows.has(id) &&
                                this.statusFor(id) === 'error'
                            ) {
                                this.storePrograms([[id, programs]]);
                            }
                        }
                    )
                    .then(
                        (covered) => covered,
                        () => null
                    )
            )
        ).then((sets) => {
            if (request.signal.aborted) return;
            this.coverageRequest = undefined;
            clearTimeout(scan.progress?.timer);
            if (sets.some((set) => set === null)) {
                if (scan.progress?.uncovered.size)
                    this.uncovered.set(scan.progress.uncovered);
                debugEpgGuidePrograms(
                    'loadCoverage failed for a chunk; leaving coverage unknown',
                    { chunkCount: sets.length }
                );
                this.coverageStatus.set('error');
                return;
            }
            const merged = new Set<string>();
            for (const set of sets) set?.forEach((id) => merged.add(id));
            const uncovered =
                scan.progress?.uncovered ?? new Map<string, number>();
            for (const { id } of channels) {
                if (scan.progress?.confirmed.has(id)) continue;
                if (merged.has(id)) uncovered.delete(id);
                else uncovered.set(id, Infinity);
            }
            this.uncovered.set(uncovered);
            this.coverageStatus.set(
                this.failedCoverage.size ? 'error' : 'idle'
            );
        });
    }

    private invalidate(): void {
        this.cancelProgramRequests();
        this.rowExpiry.clear();
        this.visibleRows.clear();
        this.cancelCoverageRequest();
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
        this.uncovered.set(null);
    }

    private cancelCoverageRequest(): void {
        this.coverageRequest?.controller.abort();
        clearTimeout(this.coverageRequest?.progress?.timer);
        this.coverageRequest = undefined;
        this.failedCoverage.clear();
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
