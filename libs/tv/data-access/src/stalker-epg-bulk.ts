import { unwrap } from './stalker-series';
import { StalkerSession } from './stalker-session';

type Bulk = Record<string, unknown>;
type Subscriber = (error?: unknown, value?: Bulk) => void;
interface Flight {
    controller: AbortController;
    subscribers: Set<Subscriber>;
}

const abortError = () => new DOMException('Aborted', 'AbortError');
const lifetimeMs = 5 * 60 * 1000;

/** The promise's value, or undefined if it has not settled within `ms`. */
function settledWithin<T>(
    promise: Promise<T>,
    ms: number
): Promise<T | undefined> {
    // It may still reject after we stop waiting; that must not go unhandled.
    promise.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Per-source bulk guide shared by preview and visible grid rows. */
export class StalkerEpgBulk {
    private cached?: { value: Bulk; expires: number };
    private pending?: Flight;
    private disposed = false;
    /** A download that outlasted one caller's wait. */
    private late?: Flight;

    constructor(private readonly session: StalkerSession) {}

    /**
     * Like get(), but resolves undefined after `waitMs`. The shared download
     * keeps running for the caller's subscription, and later callers skip the
     * wait while that same download runs, so a slow portal costs one wait,
     * not one per row.
     */
    async getWithin(signal: AbortSignal, waitMs: number) {
        const late = !!this.pending && this.pending === this.late;
        const pending = this.get(signal);
        const flight = this.pending;
        const value = await settledWithin(pending, late ? 0 : waitMs);
        if (value === undefined) this.late = flight;
        return value;
    }

    /** The bulk guide if it has landed and not expired; never waits. */
    peek(): Bulk | undefined {
        return this.cached && this.cached.expires > Date.now()
            ? this.cached.value
            : undefined;
    }

    get(signal: AbortSignal): Promise<Bulk> {
        if (signal.aborted || this.disposed)
            return Promise.reject(abortError());
        const cached = this.peek();
        if (cached) return Promise.resolve(cached);
        const flight = this.pending ?? {
            controller: new AbortController(),
            subscribers: new Set<Subscriber>(),
        };
        if (!this.pending) {
            this.pending = flight;
            // Subscribe before starting, including for immediately resolved mocks.
            void Promise.resolve().then(() => this.load(flight));
        }
        return new Promise((resolve, reject) => {
            const complete: Subscriber = (error, value) => {
                signal.removeEventListener('abort', cancel);
                flight.subscribers.delete(complete);
                if (error) reject(error);
                else resolve(value ?? {});
            };
            const cancel = () => {
                complete(abortError());
                if (!flight.subscribers.size && this.pending === flight) {
                    this.pending = undefined;
                    flight.controller.abort();
                }
            };
            flight.subscribers.add(complete);
            signal.addEventListener('abort', cancel, { once: true });
        });
    }

    private async load(flight: Flight) {
        if (flight.controller.signal.aborted || this.disposed) return;
        try {
            const response = unwrap(
                await this.session.request(
                    { type: 'itv', action: 'get_epg_info', period: 168 },
                    flight.controller.signal
                )
            );
            if (this.pending !== flight || this.disposed) return;
            const value =
                response &&
                typeof response === 'object' &&
                !Array.isArray(response)
                    ? (response as Bulk)
                    : {};
            this.cached = { value, expires: Date.now() + lifetimeMs };
            this.finish(flight, undefined, value);
        } catch (error) {
            if (this.pending === flight) this.finish(flight, error);
        }
    }

    private finish(flight: Flight, error?: unknown, value?: Bulk) {
        this.pending = undefined;
        for (const complete of flight.subscribers) complete(error, value);
    }

    dispose() {
        this.disposed = true;
        this.cached = undefined;
        if (this.pending) {
            const flight = this.pending;
            flight.controller.abort();
            this.finish(flight, abortError());
        }
    }
}
