import { EpgProgram } from '@iptvnator/shared/interfaces';

const CONCURRENT_REQUESTS = 2;
const REQUEST_PAUSE_MS = 200;
const CACHED_STREAMS = 256;
const SCHEDULE_TTL_MS = 5 * 60_000;

/** The guide can scan an entire portal without retaining every schedule. */
export class XtreamGuideScheduleCache {
    private readonly cached = new Map<
        string,
        { programs: EpgProgram[]; expiresAt: number }
    >();
    private readonly pending = new Map<string, Promise<EpgProgram[]>>();
    private readonly slots = new Set<Promise<void>>();

    clear(): void {
        this.cached.clear();
        this.pending.clear();
    }

    async load(
        id: string,
        checkCurrent: () => void,
        fetch: () => Promise<EpgProgram[]>
    ): Promise<EpgProgram[]> {
        for (;;) {
            checkCurrent();
            const cached = this.cached.get(id);
            if (cached) {
                this.cached.delete(id);
                if (cached.expiresAt > Date.now()) {
                    this.cached.set(id, cached);
                    return cached.programs;
                }
            }
            const pending = this.pending.get(id);
            if (pending) return pending;
            if (this.slots.size < CONCURRENT_REQUESTS) break;
            await Promise.race([...this.slots]);
        }

        const work = fetch();
        this.pending.set(id, work);
        const slot = work.then(this.pause, this.pause).finally(() => {
            this.slots.delete(slot);
        });
        this.slots.add(slot);

        try {
            const programs = await work;
            if (this.pending.get(id) === work) {
                this.cached.set(id, {
                    programs,
                    expiresAt: Date.now() + SCHEDULE_TTL_MS,
                });
                if (this.cached.size > CACHED_STREAMS) {
                    const oldest = this.cached.keys().next().value;
                    if (oldest !== undefined) this.cached.delete(oldest);
                }
            }
            return programs;
        } finally {
            if (this.pending.get(id) === work) this.pending.delete(id);
        }
    }

    private pause(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
    }
}
