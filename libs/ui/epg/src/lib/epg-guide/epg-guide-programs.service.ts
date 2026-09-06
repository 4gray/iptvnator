import { computed, effect, inject, Injectable, signal } from '@angular/core';
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

export type EpgGuideRowStatus = 'idle' | 'loading' | 'loaded' | 'none';

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
 * the viewport asks about; coverage (which rows have anything at all) loads
 * eagerly for the whole scope so "Only with EPG" can answer before rows
 * scroll into view. Every response is tagged with the generation it was
 * requested under, so a window or scope change makes older answers no-ops.
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
    private generation = 0;
    /** Last channel reference seen by the constructor effect (see below). */
    private seenChannels: readonly EpgGuideChannel[] | null = null;

    readonly coverageLoaded = computed(() => this.coverage() !== null);

    constructor() {
        // A new channel set (scope change) invalidates everything, including
        // coverage: the toggle must be answered for the new rows. The first
        // effect run must NOT invalidate: a host can call `setWindow` (and
        // thus `ensureLoaded`) before the initial change-detection flush, and
        // invalidating here would bump the generation and drop that
        // in-flight request's answer along with any coverage it kicked off.
        effect(() => {
            const next = this.source.channels();
            if (next === this.seenChannels) {
                return;
            }
            const first = this.seenChannels === null;
            this.seenChannels = next;
            if (first) {
                return;
            }
            this.invalidate();
            this.requestCoverage();
        });
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

    /** Request programmes for rows that are idle; chunked, generation-tagged. */
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const range = this.range;
        if (!range) {
            return;
        }
        const pending = channels.filter(
            (channel) =>
                this.statusFor(channel.id) === 'idle' && hasEpgKey(channel)
        );
        if (pending.length === 0) {
            return;
        }
        this.patchStatuses(pending.map((channel) => [channel.id, 'loading']));
        const generation = this.generation;
        for (
            let start = 0;
            start < pending.length;
            start += EPG_GUIDE_LOAD_CHUNK
        ) {
            const chunk = pending.slice(start, start + EPG_GUIDE_LOAD_CHUNK);
            this.loadChunk({ channels: chunk, ...range }, generation);
        }
    }

    private loadChunk(request: EpgGuideWindow, generation: number): void {
        this.source
            .loadPrograms(request)
            .then(
                (result) => result,
                () => {
                    debugEpgGuidePrograms(
                        'loadPrograms failed for a chunk; marking as loaded-empty',
                        { channelCount: request.channels.length }
                    );
                    return null;
                }
            )
            .then((result) => {
                if (generation !== this.generation) {
                    return;
                }
                const next = new Map(this.programs());
                for (const channel of request.channels) {
                    next.set(channel.id, result?.get(channel.id) ?? EMPTY);
                }
                this.programs.set(next);
                this.patchStatuses(
                    request.channels.map((channel) => [channel.id, 'loaded'])
                );
            });
    }

    private requestCoverage(): void {
        const range = this.range;
        if (!range) {
            return;
        }
        const generation = this.generation;
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
                this.source.loadCoverage({ channels, ...range }).then(
                    (covered) => covered,
                    () => null
                )
            )
        ).then((sets) => {
            if (generation !== this.generation) {
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
        });
    }

    private invalidate(): void {
        this.generation += 1;
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

    private patchStatuses(entries: Array<[string, EpgGuideRowStatus]>): void {
        const next = new Map(this.statuses());
        for (const [id, status] of entries) {
            next.set(id, status);
        }
        this.statuses.set(next);
    }
}
