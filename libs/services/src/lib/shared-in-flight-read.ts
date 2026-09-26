/**
 * Lets concurrent callers share one pending read. A settled read is never
 * reused, and `detach()` (called when a write is issued) makes the next
 * caller start a fresh read, so a caller that follows a write never receives
 * a result that was read before it. The first caller receives the read's own
 * result; callers that join it receive a copy, so no caller can mutate what
 * another one holds.
 */
export class SharedInFlightRead<T> {
    private pending: Promise<T> | null = null;

    constructor(private readonly copy: (value: T) => T = copyPlainData) {}

    run(read: () => Promise<T>): Promise<T> {
        if (this.pending) {
            return this.pending.then(this.copy);
        }
        const pending = read();
        this.pending = pending;
        const settle = () => {
            if (this.pending === pending) this.pending = null;
        };
        pending.then(settle, settle);
        return pending;
    }

    detach(): void {
        this.pending = null;
    }
}

/**
 * Deep-copies arrays and plain objects (the shape of worker results); any
 * other value, such as a `Date`, is shared by reference.
 */
export function copyPlainData<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => copyPlainData(item)) as T;
    }
    if (
        value !== null &&
        typeof value === 'object' &&
        Object.getPrototypeOf(value) === Object.prototype
    ) {
        const copy: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            copy[key] = copyPlainData(item);
        }
        return copy as T;
    }
    return value;
}
