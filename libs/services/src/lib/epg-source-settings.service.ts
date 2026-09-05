import { inject, Injectable, Injector, signal } from '@angular/core';
import {
    firstValueFrom,
    Subject,
    Observable,
    MonoTypeOperatorFunction,
    filter,
    takeUntil,
} from 'rxjs';
import { PlaylistsService } from './playlists.service';

export class EpgSourceReconciliationError extends Error {
    constructor() {
        super('Failed to reconcile EPG sources');
    }
}

function normalizeEpgSourceUrls(urls: string[] | string | undefined): string[] {
    return [
        ...new Set(
            (Array.isArray(urls) ? urls : [urls ?? ''])
                .map((url) => url.trim())
                .filter(Boolean)
        ),
    ];
}

export function epgSourceUrlsChanged(
    previous: string[] | string | undefined,
    next: string[] | string | undefined
): boolean {
    return (
        next !== undefined &&
        JSON.stringify(normalizeEpgSourceUrls(previous).sort()) !==
            JSON.stringify(normalizeEpgSourceUrls(next).sort())
    );
}

/** Synchronizes committed global XMLTV settings, never unsaved form edits. */
@Injectable({ providedIn: 'root' })
export class EpgSourceSettingsService {
    private readonly injector = inject(Injector);
    private activeUrls = new Set<string>();
    private reconciliation: Promise<void> | undefined;
    readonly revision = signal(0);
    readonly changed$ = new Subject<void>();

    retainCurrentSources(urls: string[], requestedRevision: number): string[] {
        return requestedRevision === this.revision()
            ? urls
            : urls.filter((url) => this.activeUrls.has(url));
    }

    guard<T>(): MonoTypeOperatorFunction<T> {
        const revision = this.revision();
        return (source: Observable<T>) =>
            source.pipe(
                takeUntil(this.changed$),
                filter(() => revision === this.revision())
            );
    }

    async waitForReconciliation(): Promise<void> {
        while (this.reconciliation) {
            await this.reconciliation.catch(() => undefined);
        }
    }

    async synchronize(urls: string[] | string | undefined): Promise<void> {
        if (
            typeof window === 'undefined' ||
            !window.electron?.reconcileEpgSources
        )
            return;
        // Fence existing lookups before playlist migration or IPC can yield.
        this.revision.update((revision) => revision + 1);
        const previous = this.reconciliation;
        const operation = previous
            ? previous.catch(() => undefined).then(() => this.reconcile(urls))
            : this.reconcile(urls);
        const pending = operation.finally(() => {
            if (this.reconciliation === pending)
                this.reconciliation = undefined;
        });
        this.reconciliation = pending;
        return pending;
    }

    private async reconcile(
        urls: string[] | string | undefined
    ): Promise<void> {
        const normalized = normalizeEpgSourceUrls(urls);
        // These globals are committed even if playlist ownership or cleanup
        // cannot be read. Never keep the previous global list on failure.
        this.activeUrls = new Set(normalized);
        try {
            // This includes the legacy IndexedDB → SQLite playlist migration.
            const playlists = await firstValueFrom(
                this.injector.get(PlaylistsService).getAllPlaylists()
            );
            for (const playlist of playlists) {
                if (playlist.serverUrl || playlist.macAddress) continue;
                for (const url of playlist.epgUrls ?? []) {
                    if (url.trim()) this.activeUrls.add(url.trim());
                }
            }
            const result =
                await window.electron.reconcileEpgSources(normalized);
            if (!result.success)
                throw new Error('EPG source reconciliation failed');
        } catch {
            throw new EpgSourceReconciliationError();
        } finally {
            this.revision.update((revision) => revision + 1);
            this.changed$.next();
        }
    }
}
