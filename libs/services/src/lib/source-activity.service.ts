import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';

/** Shared renderer work that source cleanup must not interrupt. */
@Injectable({ providedIn: 'root' })
export class SourceActivityService {
    private readonly counts = signal<ReadonlyMap<string, number>>(new Map());
    private readonly waiters = new Set<() => void>();
    private readonly liveCatalogReplacements = new Subject<string>();
    readonly liveCatalogReplacements$ =
        this.liveCatalogReplacements.asObservable();

    notifyLiveCatalogReplacement(sourceId: string): void {
        this.liveCatalogReplacements.next(sourceId);
    }

    /** Subscribe to completed activity holds; callers can recheck availability. */
    onRelease(check: () => void): () => void {
        this.waiters.add(check);
        return () => this.waiters.delete(check);
    }

    isBusy(id: string, ownHolds = 0): boolean {
        return (this.counts().get(id) ?? 0) > ownHolds;
    }
    begin(ids: readonly string[]): () => void {
        const unique = [...new Set(ids)];
        this.adjust(unique, 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.adjust(unique, -1);
            this.waiters.forEach((check) => check());
        };
    }

    /** Wait for source work, then keep cleanup from starting during the operation. */
    async runWhenIdle<T>(
        sourceIds: string | readonly string[],
        operation: () => Promise<T>
    ): Promise<T> {
        const ids = typeof sourceIds === 'string' ? [sourceIds] : sourceIds;
        const busy = () => ids.some((id) => this.isBusy(id));
        while (busy()) {
            await new Promise<void>((resolve) => {
                const unsubscribe = this.onRelease(() => {
                    if (busy()) return;
                    unsubscribe();
                    resolve();
                });
            });
        }
        const release = this.begin(ids);
        try {
            return await operation();
        } finally {
            release();
        }
    }

    private adjust(ids: readonly string[], delta: number): void {
        this.counts.update((value) => {
            const next = new Map(value);
            for (const id of ids) {
                const remaining = (next.get(id) ?? 0) + delta;
                if (remaining) next.set(id, remaining);
                else next.delete(id);
            }
            return next;
        });
    }
}
