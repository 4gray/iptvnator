import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

/** The playlist and series one generation of position reads and writes belongs to. */
export interface StalkerSeriesPositionContext {
    readonly generation: number;
    readonly playlistId: string;
    readonly seriesXtreamId: number;
    readonly mutationKey: string;
}

/** What the queue needs from the owner of the position rows. */
export interface StalkerSeriesPositionQueueHost {
    /** Whether the page still shows the playlist and series of `context`. */
    readonly isShown: (context: StalkerSeriesPositionContext) => boolean;
    /** Reads the persisted position rows of `context`. */
    readonly read: (
        context: StalkerSeriesPositionContext
    ) => Promise<PlaybackPositionData[]>;
    /** Takes over rows read for a context that is still the active one. */
    readonly publish: (
        context: StalkerSeriesPositionContext,
        positions: PlaybackPositionData[]
    ) => void;
}

/**
 * Orders the position reads and writes of the Stalker series view. Writes of
 * one playlist/series run one after another; a read waits for the writes
 * queued before it, and its answer is dropped once a newer read or write
 * started or the page moved on to another series. A write that overtakes a
 * read still in flight re-reads the rows after the queue drained.
 */
export class StalkerSeriesPositionQueue {
    private activeContext: StalkerSeriesPositionContext | null = null;
    private contextGeneration = 0;
    private readonly mutationQueues = new Map<string, Promise<void>>();
    private readonly pendingLoads = new Map<
        StalkerSeriesPositionContext,
        Set<number>
    >();
    private readonly reloadKeys = new Set<string>();
    private loadGeneration = 0;

    constructor(private readonly host: StalkerSeriesPositionQueueHost) {}

    /** Makes `playlistId`/`seriesXtreamId` the series reads and writes apply to. */
    activate(
        playlistId: string,
        seriesXtreamId: number
    ): StalkerSeriesPositionContext {
        const context: StalkerSeriesPositionContext = {
            generation: ++this.contextGeneration,
            playlistId,
            seriesXtreamId,
            mutationKey: JSON.stringify([playlistId, seriesXtreamId]),
        };
        this.activeContext = context;
        return context;
    }

    /** No series is shown: retires the active context and every read in flight. */
    deactivate(): void {
        this.activeContext = null;
        this.contextGeneration++;
        this.loadGeneration++;
    }

    isActive(context: StalkerSeriesPositionContext): boolean {
        const activeContext = this.activeContext;
        return (
            activeContext === context &&
            activeContext.generation === context.generation &&
            this.host.isShown(context)
        );
    }

    /** The active context when it belongs to `playlistId` (and `seriesXtreamId`, if given). */
    mutationContext(
        playlistId: string,
        seriesXtreamId?: number | null
    ): StalkerSeriesPositionContext | null {
        const context = this.activeContext;
        if (
            !context ||
            context.playlistId !== playlistId ||
            (seriesXtreamId != null &&
                context.seriesXtreamId !== seriesXtreamId)
        ) {
            return null;
        }
        return context;
    }

    async load(context: StalkerSeriesPositionContext): Promise<void> {
        const generation = ++this.loadGeneration;
        this.trackPendingLoad(context, generation);
        try {
            await this.waitForMutations(context.mutationKey);

            if (generation !== this.loadGeneration || !this.isActive(context)) {
                return;
            }

            const positions = await this.host.read(context);

            if (generation !== this.loadGeneration || !this.isActive(context)) {
                return;
            }

            this.host.publish(context, positions);
        } finally {
            this.untrackPendingLoad(context, generation);
        }
    }

    enqueue(
        context: StalkerSeriesPositionContext,
        operation: () => Promise<void>
    ): Promise<void> {
        if (this.hasCurrentPendingLoad(context)) {
            this.reloadKeys.add(context.mutationKey);
        }
        this.loadGeneration++;
        const previous = this.waitForMutations(context.mutationKey);
        const result = previous.then(operation);
        const barrier = result.then(
            () => undefined,
            () => undefined
        );
        this.mutationQueues.set(context.mutationKey, barrier);
        void barrier.then(() => {
            if (this.mutationQueues.get(context.mutationKey) === barrier) {
                this.mutationQueues.delete(context.mutationKey);
                this.reloadAfterMutations(context.mutationKey);
            }
        });
        return result;
    }

    private waitForMutations(mutationKey: string): Promise<void> {
        return this.mutationQueues.get(mutationKey) ?? Promise.resolve();
    }

    private trackPendingLoad(
        context: StalkerSeriesPositionContext,
        generation: number
    ): void {
        const generations = this.pendingLoads.get(context) ?? new Set<number>();
        generations.add(generation);
        this.pendingLoads.set(context, generations);
    }

    private untrackPendingLoad(
        context: StalkerSeriesPositionContext,
        generation: number
    ): void {
        const generations = this.pendingLoads.get(context);
        generations?.delete(generation);
        if (generations?.size === 0) {
            this.pendingLoads.delete(context);
        }
    }

    private hasCurrentPendingLoad(
        context: StalkerSeriesPositionContext
    ): boolean {
        return Boolean(
            this.pendingLoads.get(context)?.has(this.loadGeneration)
        );
    }

    private reloadAfterMutations(mutationKey: string): void {
        if (!this.reloadKeys.delete(mutationKey)) {
            return;
        }
        const context = this.activeContext;
        if (
            !context ||
            context.mutationKey !== mutationKey ||
            !this.isActive(context) ||
            this.hasCurrentPendingLoad(context)
        ) {
            return;
        }
        void this.load(context);
    }
}
