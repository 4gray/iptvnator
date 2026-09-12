import { Injectable, signal } from '@angular/core';

/** Shared renderer work that source cleanup must not interrupt. */
@Injectable({ providedIn: 'root' })
export class SourceActivityService {
    private readonly counts = signal<ReadonlyMap<string, number>>(new Map());
    isBusy(id: string): boolean {
        return (this.counts().get(id) ?? 0) > 0;
    }
    begin(ids: readonly string[]): () => void {
        const unique = [...new Set(ids)];
        this.counts.update((value) => {
            const next = new Map(value);
            unique.forEach((id) => next.set(id, (next.get(id) ?? 0) + 1));
            return next;
        });
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.counts.update((value) => {
                const next = new Map(value);
                unique.forEach((id) => {
                    const remaining = (next.get(id) ?? 1) - 1;
                    if (remaining) next.set(id, remaining);
                    else next.delete(id);
                });
                return next;
            });
        };
    }
}
