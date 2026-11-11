import { EpgProgram } from '@iptvnator/shared/interfaces';

const CONCURRENT_REQUESTS = 2;
const REQUEST_PAUSE_MS = 200;
const CACHED_STREAMS = 256;
const SCHEDULE_TTL_MS = 5 * 60_000;

type FetchSchedule = (options: {
    signal: AbortSignal;
    sessionId?: string;
}) => Promise<EpgProgram[]>;

interface PendingSchedule {
    readonly work: Promise<EpgProgram[]>;
    readonly abort: () => void;
    consumers: number;
}

function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    let abort!: () => void;
    return new Promise<T>((resolve, reject) => {
        abort = () => reject(signal.reason);
        work.then(resolve, reject);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
    }).finally(() => signal.removeEventListener('abort', abort));
}

/** The guide can scan an entire portal without retaining every schedule. */
export class XtreamGuideScheduleCache {
    private readonly cached = new Map<
        string,
        { programs: EpgProgram[]; expiresAt: number }
    >();
    private readonly pending = new Map<string, PendingSchedule>();
    private readonly slots = new Set<Promise<void>>();
    private controller = new AbortController();

    constructor(
        private readonly cancelTransport: (sessionId: string) => void
    ) {}

    clear(): void {
        this.controller.abort();
        for (const entry of this.pending.values()) entry.abort();
        this.controller = new AbortController();
        this.cached.clear();
        this.pending.clear();
        this.slots.clear();
    }

    expiresAt(id: string): number {
        return this.cached.get(id)?.expiresAt ?? 0;
    }

    async load(
        id: string,
        checkCurrent: () => void,
        fetch: FetchSchedule,
        consumer?: AbortSignal
    ): Promise<EpgProgram[]> {
        const signal = consumer
            ? AbortSignal.any([this.controller.signal, consumer])
            : this.controller.signal;
        for (;;) {
            signal.throwIfAborted();
            checkCurrent();
            const cached = this.cached.get(id);
            if (cached) {
                this.cached.delete(id);
                if (cached.expiresAt > Date.now()) {
                    this.cached.set(id, cached);
                    return cached.programs;
                }
            }
            const entry = this.pending.get(id);
            if (entry) return this.consume(id, entry, signal);
            if (this.slots.size < CONCURRENT_REQUESTS)
                return this.consume(id, this.start(id, fetch), signal);
            await waitFor(Promise.race([...this.slots]), signal);
        }
    }

    private start(id: string, fetch: FetchSchedule): PendingSchedule {
        const controller = new AbortController();
        const sessionId = globalThis.crypto.randomUUID?.();
        const work = waitFor(
            fetch({ signal: controller.signal, sessionId }),
            controller.signal
        );
        const entry: PendingSchedule = {
            work,
            consumers: 0,
            abort: () => {
                if (controller.signal.aborted) return;
                controller.abort();
                if (sessionId) this.cancelTransport(sessionId);
            },
        };
        this.pending.set(id, entry);
        const slot = work
            .then(
                (programs) => this.finish(id, entry, programs),
                () => this.finish(id, entry)
            )
            .then(this.pause)
            .finally(() => this.slots.delete(slot));
        this.slots.add(slot);
        return entry;
    }

    private async consume(
        id: string,
        entry: PendingSchedule,
        signal: AbortSignal
    ): Promise<EpgProgram[]> {
        entry.consumers++;
        try {
            return await waitFor(entry.work, signal);
        } finally {
            if (--entry.consumers === 0 && this.pending.get(id) === entry) {
                this.pending.delete(id);
                entry.abort();
            }
        }
    }

    private finish(
        id: string,
        entry: PendingSchedule,
        programs?: EpgProgram[]
    ): void {
        if (this.pending.get(id) !== entry) return;
        this.pending.delete(id);
        if (!programs) return;
        this.cached.set(id, {
            programs,
            expiresAt: Date.now() + SCHEDULE_TTL_MS,
        });
        if (this.cached.size > CACHED_STREAMS) {
            const oldest = this.cached.keys().next().value;
            if (oldest !== undefined) this.cached.delete(oldest);
        }
    }

    private pause(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
    }
}
