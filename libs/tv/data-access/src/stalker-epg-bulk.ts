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

/** Per-source bulk guide shared by preview and visible grid rows. */
export class StalkerEpgBulk {
    private cached?: { value: Bulk; expires: number };
    private pending?: Flight;
    private disposed = false;

    constructor(private readonly session: StalkerSession) {}

    get(signal: AbortSignal): Promise<Bulk> {
        if (signal.aborted || this.disposed)
            return Promise.reject(abortError());
        if (this.cached && this.cached.expires > Date.now())
            return Promise.resolve(this.cached.value);
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
