import { EpgProgram } from '@iptvnator/shared/interfaces';

const CONCURRENT_REQUESTS = 2;
const REQUEST_PAUSE_MS = 200;
const CACHED_STREAMS = 256;
const SCHEDULE_TTL_MS = 5 * 60_000;

type FetchSchedule<T> = (options: {
    signal: AbortSignal;
    sessionId?: string;
}) => Promise<T>;

interface PendingSchedule<T> {
    readonly work: Promise<T>;
    readonly abort: () => void;
    consumers: number;
}

function waitFor<T>(
    work: Promise<T>,
    signals: readonly AbortSignal[]
): Promise<T> {
    let abort!: (event: Event) => void;
    return new Promise<T>((resolve, reject) => {
        abort = (event) => reject((event.target as AbortSignal).reason);
        work.then(resolve, reject);
        const retired = signals.find((signal) => signal.aborted);
        if (retired) reject(retired.reason);
        else
            signals.forEach((signal) =>
                signal.addEventListener('abort', abort, { once: true })
            );
    }).finally(() =>
        signals.forEach((signal) => signal.removeEventListener('abort', abort))
    );
}

/** The guide can scan an entire portal without retaining every schedule. */
export class XtreamGuideScheduleCache<T = EpgProgram[]> {
    private readonly cached = new Map<
        string,
        { value: T; expiresAt: number }
    >();
    private readonly pending = new Map<string, PendingSchedule<T>>();
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

    peek(id: string): T | undefined {
        const cached = this.cached.get(id);
        return cached && cached.expiresAt > Date.now()
            ? cached.value
            : undefined;
    }

    async load(
        id: string,
        checkCurrent: () => void,
        fetch: FetchSchedule<T>,
        consumer?: AbortSignal
    ): Promise<T> {
        const signals = consumer
            ? [this.controller.signal, consumer]
            : [this.controller.signal];
        for (;;) {
            signals.forEach((signal) => signal.throwIfAborted());
            checkCurrent();
            const cached = this.cached.get(id);
            if (cached) {
                this.cached.delete(id);
                if (cached.expiresAt > Date.now()) {
                    this.cached.set(id, cached);
                    return cached.value;
                }
            }
            const entry = this.pending.get(id);
            if (entry) return this.consume(id, entry, signals);
            if (this.slots.size < CONCURRENT_REQUESTS)
                return this.consume(id, this.start(id, fetch), signals);
            await waitFor(Promise.race([...this.slots]), signals);
        }
    }

    private start(id: string, fetch: FetchSchedule<T>): PendingSchedule<T> {
        const controller = new AbortController();
        const sessionId = globalThis.crypto.randomUUID?.();
        const work = waitFor(fetch({ signal: controller.signal, sessionId }), [
            controller.signal,
        ]);
        const entry: PendingSchedule<T> = {
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
        entry: PendingSchedule<T>,
        signals: readonly AbortSignal[]
    ): Promise<T> {
        entry.consumers++;
        try {
            return await waitFor(entry.work, signals);
        } finally {
            if (--entry.consumers === 0 && this.pending.get(id) === entry) {
                this.pending.delete(id);
                entry.abort();
            }
        }
    }

    private finish(id: string, entry: PendingSchedule<T>, value?: T): void {
        if (this.pending.get(id) !== entry) return;
        this.pending.delete(id);
        if (value === undefined) return;
        this.cached.set(id, {
            value,
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
