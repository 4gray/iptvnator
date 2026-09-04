import type { EpgProgram } from '@iptvnator/shared/interfaces';

/**
 * Per-channel short-EPG fallback for the ITV channel-list previews.
 *
 * The bulk `get_epg_info` guide is the primary source for the "now playing"
 * row previews, but some portals return only future programmes from it (the
 * currently airing one is missing) or no usable data at all. `get_short_epg`
 * always starts at the current programme, so channels the bulk guide cannot
 * answer are fetched individually — throttled and cached, mirroring the
 * Xtream `EpgQueueService`, so scrolling a large list cannot flood the
 * portal.
 */

/** Programmes requested per channel: current + a small safety margin. */
export const EPG_PREVIEW_FETCH_SIZE = 3;
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
const PREVIEW_MAX_CONCURRENCY = 2;
const PREVIEW_DELAY_MS = 200;
/**
 * Per-sync backlog cap. The list can render 100+ rows at once, and request
 * count must track user engagement, not render size: one sync fetches at
 * most this many channels (top of the list first — where a freshly opened
 * category is scrolled to), and the host re-syncs on scroll to fill the
 * next gaps as the user moves through the list.
 */
const PREVIEW_MAX_PER_SYNC = 30;

interface StalkerEpgPreviewQueueHost {
    /** Fetch the short EPG for one channel; resolves [] on failure. */
    fetchPrograms: (channelId: string) => Promise<EpgProgram[]>;
    /** Called for each non-empty result so the host can update its previews. */
    onPrograms: (channelId: string, programs: EpgProgram[]) => void;
    /**
     * Current EPG display offset. Cached windows are tagged with the offset
     * they were fetched for and become stale when it changes, since the
     * window size and the "now" they answer both depend on it.
     */
    epgOffsetMinutes?: () => number;
}

interface StalkerEpgPreviewQueueOptions {
    /** Test-only overrides for the throttling constants. */
    delayMs?: number;
    maxPerSync?: number;
}

interface PreviewCacheEntry {
    programs: EpgProgram[];
    timestamp: number;
    offsetMinutes: number;
}

export class StalkerEpgPreviewQueue {
    private readonly cache = new Map<string, PreviewCacheEntry>();
    private readonly inFlight = new Set<string>();
    private queue: string[] = [];
    private visibleSet = new Set<string>();
    private processing = false;
    /** Bumped by reset() so an in-flight result of the old portal is dropped. */
    private generation = 0;
    private destroyed = false;
    private readonly delayMs: number;
    private readonly maxPerSync: number;

    constructor(
        private readonly host: StalkerEpgPreviewQueueHost,
        options: StalkerEpgPreviewQueueOptions = {}
    ) {
        this.delayMs = options.delayMs ?? PREVIEW_DELAY_MS;
        this.maxPerSync = options.maxPerSync ?? PREVIEW_MAX_PER_SYNC;
    }

    getCachedPrograms(channelId: string): EpgProgram[] | null {
        const entry = this.cache.get(channelId);
        if (!entry) {
            return null;
        }
        if (
            Date.now() - entry.timestamp > PREVIEW_CACHE_TTL_MS ||
            entry.offsetMinutes !== this.currentOffsetMinutes()
        ) {
            this.cache.delete(channelId);
            return null;
        }
        return entry.programs;
    }

    private currentOffsetMinutes(): number {
        return this.host.epgOffsetMinutes?.() ?? 0;
    }

    /**
     * Replace the work list with the currently rendered channels that still
     * need a preview. Later calls supersede earlier ones, so fast scrolling
     * never accumulates stale requests.
     */
    sync(channelIds: readonly string[]): void {
        if (this.destroyed) {
            return;
        }
        this.visibleSet = new Set(channelIds);
        this.queue = channelIds
            .filter((id) => this.shouldFetch(id))
            .slice(0, this.maxPerSync);
        if (!this.processing && this.queue.length > 0) {
            void this.processQueue();
        }
    }

    /** Drop all cached data — channel ids are only unique per portal. */
    reset(): void {
        this.generation += 1;
        this.cache.clear();
        this.inFlight.clear();
        this.queue = [];
        this.visibleSet = new Set();
    }

    destroy(): void {
        this.destroyed = true;
        this.reset();
    }

    private shouldFetch(channelId: string): boolean {
        return (
            this.getCachedPrograms(channelId) === null &&
            !this.inFlight.has(channelId)
        );
    }

    private async processQueue(): Promise<void> {
        this.processing = true;
        try {
            while (this.queue.length > 0 && !this.destroyed) {
                if (this.inFlight.size >= PREVIEW_MAX_CONCURRENCY) {
                    await delay(this.delayMs);
                    continue;
                }

                const channelId = this.queue.shift();
                if (
                    !channelId ||
                    !this.visibleSet.has(channelId) ||
                    !this.shouldFetch(channelId)
                ) {
                    continue;
                }

                this.inFlight.add(channelId);
                void this.fetchOne(channelId);

                await delay(this.delayMs);
            }
        } finally {
            this.processing = false;
        }
    }

    private async fetchOne(channelId: string): Promise<void> {
        const generation = this.generation;
        const offsetMinutes = this.currentOffsetMinutes();
        try {
            const programs = await this.host.fetchPrograms(channelId);
            if (this.destroyed || generation !== this.generation) {
                return;
            }
            // The setting changed while the request was on the wire: its
            // window was sized for the previous offset, and the sync the
            // change triggered skipped this channel because it was in
            // flight. Drop the result and fetch again if the row is still
            // visible instead of committing a window nobody asked for.
            if (offsetMinutes !== this.currentOffsetMinutes()) {
                this.inFlight.delete(channelId);
                this.requeue(channelId);
                return;
            }
            // Empty results are cached too: they mean the portal has no
            // short EPG for the channel, and refetching on every render
            // would hammer it for nothing.
            this.cache.set(channelId, {
                programs,
                timestamp: Date.now(),
                offsetMinutes,
            });
            if (programs.length > 0) {
                this.host.onPrograms(channelId, programs);
            }
        } finally {
            if (generation === this.generation) {
                this.inFlight.delete(channelId);
            }
        }
    }

    private requeue(channelId: string): void {
        if (!this.visibleSet.has(channelId) || this.queue.includes(channelId)) {
            return;
        }
        this.queue.push(channelId);
        if (!this.processing) {
            void this.processQueue();
        }
    }
}

/**
 * Merge the bulk-EPG programme list with the short-EPG fallback for the
 * active-channel panel. The bulk guide may cover days ahead yet miss the
 * currently airing programme; the short EPG starts at "now" but only spans a
 * few entries. Primary entries win on an exact start-time collision.
 */
export function mergeEpgProgramLists(
    primary: EpgProgram[],
    secondary: EpgProgram[]
): EpgProgram[] {
    if (secondary.length === 0) {
        return primary;
    }
    if (primary.length === 0) {
        return secondary;
    }

    const primaryStarts = new Set<number>();
    for (const program of primary) {
        const startMs = getEpgProgramStartMs(program);
        if (startMs !== null) {
            primaryStarts.add(startMs);
        }
    }

    const merged = [...primary];
    for (const program of secondary) {
        const startMs = getEpgProgramStartMs(program);
        if (startMs === null || !primaryStarts.has(startMs)) {
            merged.push(program);
        }
    }

    return merged.sort(
        (left, right) =>
            (getEpgProgramStartMs(left) ?? 0) -
            (getEpgProgramStartMs(right) ?? 0)
    );
}

function getEpgProgramStartMs(program: EpgProgram): number | null {
    if (
        Number.isFinite(program.startTimestamp) &&
        Number(program.startTimestamp) > 0
    ) {
        return Number(program.startTimestamp) * 1000;
    }

    const parsedDate = Date.parse(program.start);
    return Number.isFinite(parsedDate) ? parsedDate : null;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
