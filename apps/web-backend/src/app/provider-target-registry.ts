import { createHash } from 'node:crypto';

interface TargetEntry {
    readonly url: URL;
    readonly usedAt: number;
}

interface RegistryOptions {
    readonly capacity?: number;
    readonly ttlMs?: number;
    readonly now?: () => number;
}

/** App-local LRU; expired entries are removed on access or registration. */
export class ProviderTargetRegistry {
    private readonly entries = new Map<string, TargetEntry>();
    private readonly capacity: number;
    private readonly ttlMs: number;
    private readonly now: () => number;

    constructor(options: RegistryOptions = {}) {
        this.capacity = options.capacity ?? 1024;
        this.ttlMs = options.ttlMs ?? 30 * 60_000;
        this.now = options.now ?? Date.now;
    }

    register(url: URL): string {
        const now = this.now();
        for (const [id, entry] of this.entries) {
            if (now - entry.usedAt >= this.ttlMs) this.entries.delete(id);
        }
        const id = createHash('sha256').update(url.href).digest('hex');
        this.entries.delete(id);
        while (this.entries.size >= this.capacity) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
        this.entries.set(id, { url, usedAt: now });
        return id;
    }

    get(id: string): URL | undefined {
        const entry = this.entries.get(id);
        if (!entry) return undefined;
        this.entries.delete(id);
        const now = this.now();
        if (now - entry.usedAt >= this.ttlMs) return undefined;
        this.entries.set(id, { url: entry.url, usedAt: now });
        return entry.url;
    }
}
