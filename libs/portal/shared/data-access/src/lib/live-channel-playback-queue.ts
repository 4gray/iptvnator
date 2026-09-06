import { signal } from '@angular/core';

interface PlaybackQueueSnapshot<T> {
    readonly owner: string;
    readonly scope: string;
    readonly items: readonly T[];
}

/** Component-owned playback order, independent of the list being browsed. */
export class LiveChannelPlaybackQueue<T> {
    private readonly snapshot = signal<PlaybackQueueSnapshot<T> | null>(null);

    constructor(
        private readonly getId: (item: T) => string | number | null | undefined
    ) {}

    items(owner: string): readonly T[] {
        const snapshot = this.snapshot();
        return snapshot?.owner === owner ? snapshot.items : [];
    }

    capture(
        owner: string,
        scope: string,
        items: readonly T[],
        active: T
    ): void {
        const activeId = this.key(active);
        if (!activeId) {
            this.clear();
            return;
        }
        const unique = this.unique(items);
        this.snapshot.set({
            owner,
            scope,
            items: unique.has(activeId) ? [...unique.values()] : [active],
        });
    }

    /** Append loaded pages only for the scope that supplied this queue. */
    extend(owner: string, scope: string, items: readonly T[]): void {
        const previous = this.snapshot();
        if (!previous || previous.owner !== owner || previous.scope !== scope)
            return;
        const incoming = this.unique(items);
        const next = previous.items.map((item) => {
            const id = this.key(item);
            const current = incoming.get(id) ?? item;
            incoming.delete(id);
            return current;
        });
        next.push(...incoming.values());
        if (
            next.length === previous.items.length &&
            next.every((item, index) => item === previous.items[index])
        )
            return;
        this.snapshot.set({ ...previous, items: next });
    }

    clear(): void {
        this.snapshot.set(null);
    }

    private key(item: T): string {
        const id = this.getId(item);
        return id == null ? '' : String(id);
    }

    private unique(items: readonly T[]): Map<string, T> {
        const result = new Map<string, T>();
        for (const item of items) {
            const id = this.key(item);
            if (id && !result.has(id)) result.set(id, item);
        }
        return result;
    }
}
