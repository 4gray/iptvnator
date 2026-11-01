import { Injectable, signal } from '@angular/core';
import { filter, MonoTypeOperatorFunction, Subject, takeUntil } from 'rxjs';

/** Effective, committed EPG preference; independent of transports and stores. */
@Injectable({ providedIn: 'root' })
export class EpgPreferencesService {
    private readonly active = signal(true);
    readonly enabled = this.active.asReadonly();
    readonly changed$ = new Subject<void>();
    private revision = 0;
    private loading: Promise<void> | undefined;
    private finishLoading: (() => void) | undefined;

    /** No request may outrun hydration of a saved opt-out. */
    beginLoad(): void {
        if (this.loading) return;
        this.loading = new Promise((resolve) => (this.finishLoading = resolve));
        this.setEnabled(false);
    }

    async apply(enabled: boolean): Promise<void> {
        // Disable the renderer first; enabling waits for the importer barrier.
        if (!enabled) this.setEnabled(false);
        try {
            await window.electron?.setEpgEnabled?.(enabled);
            this.setEnabled(enabled);
        } finally {
            this.finishLoading?.();
            this.loading = undefined;
            this.finishLoading = undefined;
        }
    }

    async ready(): Promise<boolean> {
        await this.loading;
        return this.enabled();
    }

    /** Fences late responses, including an off/on cycle during one request. */
    async run<T>(request: () => Promise<T>, empty: T): Promise<T> {
        if (!(await this.ready())) return empty;
        const revision = this.revision;
        try {
            const result = await request();
            return this.enabled() && revision === this.revision
                ? result
                : empty;
        } catch (error) {
            if (!this.enabled() || revision !== this.revision) return empty;
            throw error;
        }
    }

    guard<T>(): MonoTypeOperatorFunction<T> {
        const revision = this.revision;
        return (source) =>
            source.pipe(
                takeUntil(this.changed$),
                filter(() => this.enabled() && revision === this.revision)
            );
    }

    private setEnabled(enabled: boolean): void {
        if (this.enabled() === enabled) return;
        this.active.set(enabled);
        this.revision++;
        this.changed$.next();
    }
}
