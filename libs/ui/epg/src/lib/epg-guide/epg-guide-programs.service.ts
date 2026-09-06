import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    EPG_GUIDE_SOURCE,
    EpgGuideChannel,
    EpgGuideWindow,
} from './epg-guide-source';

/** Channels per `loadPrograms` call (the programme IPC caps at 100 keys). */
export const EPG_GUIDE_LOAD_CHUNK = 100;
/** Channels per `loadCoverage` call (the coverage IPC caps at 2000 keys). */
export const EPG_GUIDE_COVERAGE_CHUNK = 1000;

export type EpgGuideRowStatus = 'idle' | 'loading' | 'loaded' | 'none';

const EMPTY: EpgProgram[] = [];

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

    private readonly programs = signal<ReadonlyMap<string, EpgProgram[]>>(
        new Map()
    );
    private readonly statuses = signal<ReadonlyMap<string, EpgGuideRowStatus>>(
        new Map()
    );
    private readonly coverage = signal<ReadonlySet<string> | null>(null);

    private window: { fromMs: number; toMs: number } | null = null;
    private generation = 0;

    readonly coverageLoaded = computed(() => this.coverage() !== null);

    constructor() {
        // A new channel set (scope change) invalidates everything, including
        // coverage: the toggle must be answered for the new rows.
        effect(() => {
            this.source.channels();
            this.invalidate();
            this.requestCoverage();
        });
    }

    setWindow(fromMs: number, toMs: number): void {
        if (this.window?.fromMs === fromMs && this.window?.toMs === toMs) {
            return;
        }
        this.window = { fromMs, toMs };
        this.invalidate();
        this.requestCoverage();
    }

    programsFor(channelId: string): EpgProgram[] {
        return this.programs().get(channelId) ?? EMPTY;
    }

    statusFor(channelId: string): EpgGuideRowStatus {
        return this.statuses().get(channelId) ?? 'idle';
    }

    /** Unknown (coverage not loaded yet) counts as covered so rows never blink. */
    isCovered(channelId: string): boolean {
        const coverage = this.coverage();
        return coverage === null || coverage.has(channelId);
    }

    /** Request programmes for rows that are idle; chunked, generation-tagged. */
    ensureLoaded(channels: readonly EpgGuideChannel[]): void {
        const window = this.window;
        if (!window) {
            return;
        }
        const pending = channels.filter(
            (channel) => this.statusFor(channel.id) === 'idle' && channel.epgKey
        );
        if (pending.length === 0) {
            return;
        }
        this.patchStatuses(pending.map((channel) => [channel.id, 'loading']));
        const generation = this.generation;
        for (let start = 0; start < pending.length; start += EPG_GUIDE_LOAD_CHUNK) {
            const chunk = pending.slice(start, start + EPG_GUIDE_LOAD_CHUNK);
            this.loadChunk({ channels: chunk, ...window }, generation);
        }
    }

    private loadChunk(window: EpgGuideWindow, generation: number): void {
        this.source
            .loadPrograms(window)
            .then(
                (result) => result,
                () => new Map<string, EpgProgram[]>()
            )
            .then((result) => {
                if (generation !== this.generation) {
                    return;
                }
                const next = new Map(this.programs());
                for (const channel of window.channels) {
                    next.set(channel.id, result.get(channel.id) ?? EMPTY);
                }
                this.programs.set(next);
                this.patchStatuses(
                    window.channels.map((channel) => [channel.id, 'loaded'])
                );
            });
    }

    private requestCoverage(): void {
        const window = this.window;
        if (!window) {
            return;
        }
        const generation = this.generation;
        const keyed = this.source
            .channels()
            .filter((channel) => channel.epgKey !== null);
        const chunks: EpgGuideChannel[][] = [];
        for (let start = 0; start < keyed.length; start += EPG_GUIDE_COVERAGE_CHUNK) {
            chunks.push(keyed.slice(start, start + EPG_GUIDE_COVERAGE_CHUNK));
        }
        Promise.all(
            chunks.map((channels) =>
                this.source
                    .loadCoverage({ channels, ...window })
                    .then(
                        (covered) => covered,
                        () => new Set<string>()
                    )
            )
        ).then((sets) => {
            if (generation !== this.generation) {
                return;
            }
            const merged = new Set<string>();
            sets.forEach((set) => set.forEach((id) => merged.add(id)));
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
                    .filter((channel) => channel.epgKey === null)
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
