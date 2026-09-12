import { Injectable, inject, signal } from '@angular/core';
import { PlaylistDeleteActionService } from '@iptvnator/services';
import {
    PlaylistMeta,
    SourceHealthSnapshot,
    sourceHealthKey,
    sourceHealthType,
    sourceHealthError,
} from '@iptvnator/shared/interfaces';
import { SourceHealthService } from './source-health.service';

export interface SourceCleanupEntry {
    playlist: PlaylistMeta;
    health?: SourceHealthSnapshot;
    selected: boolean;
    status:
        'checking' | 'ready' | 'skipped' | 'deleting' | 'deleted' | 'failed';
    warning?: boolean;
}
export interface SourceCleanupContext {
    current: (id: string) => PlaylistMeta | undefined;
    protected: (id: string) => boolean;
    removed: (id: string) => void;
}
/** One instance per dialog; closing it retires only its own status requests. */
@Injectable()
export class SourceCleanupService {
    private readonly health = inject(SourceHealthService);
    private readonly deletion = inject(PlaylistDeleteActionService);
    readonly entries = signal<SourceCleanupEntry[]>([]);
    readonly phase = signal<'checking' | 'ready' | 'deleting' | 'done'>(
        'checking'
    );
    readonly stopRequested = signal(false);
    readonly totalSelected = signal(0);
    readonly processed = signal(0);
    private readonly controller = new AbortController();
    private context!: SourceCleanupContext;
    private readonly touched = new Set<string>();
    private round = 0;
    async start(
        playlists: readonly PlaylistMeta[],
        context: SourceCleanupContext
    ): Promise<void> {
        this.context = context;
        const entries = playlists
            .filter((p) => sourceHealthType(p))
            .map((p) => ({
                playlist: { ...p },
                selected: false,
                status: 'checking' as const,
            }));
        this.entries.set(entries);
        await Promise.all(entries.map((entry) => this.check(entry)));
        if (!this.controller.signal.aborted) this.phase.set('ready');
    }
    candidate(entry: SourceCleanupEntry): boolean {
        return (
            ['ready', 'failed'].includes(entry.status) &&
            !!entry.health &&
            entry.health.state !== 'active' &&
            entry.health.reason !== 'cancelled'
        );
    }
    select(id: string, selected: boolean): void {
        this.touched.add(id);
        this.update(id, (entry) => ({
            ...entry,
            selected: selected && this.candidate(entry),
        }));
    }
    selectAll(selected: boolean): void {
        this.entries().forEach((e) => this.select(e.playlist._id, selected));
    }
    async recheck(entry: SourceCleanupEntry): Promise<void> {
        if (this.phase() === 'deleting') return;
        await this.check(entry, true);
    }
    private async check(
        entry: SourceCleanupEntry,
        retry = false
    ): Promise<void> {
        const id = entry.playlist._id;
        if (this.context.protected(id) || !this.context.current(id)) {
            this.update(id, (e) => ({
                ...e,
                status: 'skipped',
                selected: false,
            }));
            return;
        }
        this.update(id, (e) => ({ ...e, status: 'checking' }));
        let result: SourceHealthSnapshot;
        try {
            result = retry
                ? await this.health.recheck(
                      entry.playlist,
                      this.controller.signal
                  )
                : await this.health.check(entry.playlist, {
                      fresh: true,
                      signal: this.controller.signal,
                  });
        } catch (error) {
            result = { ...sourceHealthError(error), checkedAt: Date.now() };
        }
        if (this.controller.signal.aborted) return;
        this.update(id, (e) => ({
            ...e,
            health: result,
            status: 'ready',
            selected:
                result.state !== 'active' &&
                result.reason !== 'cancelled' &&
                (this.touched.has(id) ? e.selected : result.confirmedInactive),
        }));
    }
    async removeSelected(): Promise<void> {
        if (
            this.phase() === 'deleting' ||
            this.entries().some((e) => e.status === 'checking')
        )
            return;
        const selected = this.entries().filter(
            (e) => e.selected && this.candidate(e)
        );
        if (!selected.length) return;
        const stale = selected.filter(
            (e) => !e.health || Date.now() - e.health.checkedAt > 300000
        );
        if (stale.length) {
            this.phase.set('checking');
            await Promise.all(stale.map((e) => this.check(e)));
            this.phase.set('ready');
            return;
        }
        const round = ++this.round;
        this.totalSelected.set(selected.length);
        this.processed.set(0);
        this.phase.set('deleting');
        this.stopRequested.set(false);
        for (const entry of selected) {
            if (this.stopRequested() || round !== this.round) break;
            if (entry.health && Date.now() - entry.health.checkedAt > 300000) {
                await this.check(entry);
                this.phase.set('ready');
                return;
            }
            const id = entry.playlist._id;
            const current = this.context.current(id);
            const latest = current ? this.health.get(current) : undefined;
            if (
                !current ||
                this.context.protected(id) ||
                sourceHealthKey(current) !== sourceHealthKey(entry.playlist) ||
                latest?.state === 'active'
            ) {
                this.update(id, (e) => ({
                    ...e,
                    status: 'skipped',
                    selected: false,
                }));
                this.processed.update((n) => n + 1);
                continue;
            }
            if (latest && !latest.confirmedInactive && !this.touched.has(id)) {
                this.update(id, (e) => ({
                    ...e,
                    health: latest,
                    status: 'ready',
                    selected: false,
                }));
                this.processed.update((n) => n + 1);
                continue;
            }
            this.update(id, (e) => ({ ...e, status: 'deleting' }));
            this.health.invalidate(id);
            try {
                const result =
                    await this.deletion.deletePlaylistWithResult(current);
                if (!result.success) throw new Error('Deletion failed');
                this.context.removed(id);
                this.update(id, (e) => ({
                    ...e,
                    status: 'deleted',
                    selected: false,
                    warning: !!result.cleanupWarnings,
                }));
            } catch {
                this.update(id, (e) => ({
                    ...e,
                    status: 'failed',
                    selected: false,
                }));
            }
            this.processed.update((n) => n + 1);
        }
        this.phase.set('done');
    }
    stop(): void {
        this.stopRequested.set(true);
    }
    dispose(): void {
        this.stop();
        this.controller.abort();
    }
    private update(
        id: string,
        update: (entry: SourceCleanupEntry) => SourceCleanupEntry
    ): void {
        this.entries.update((entries) =>
            entries.map((e) => (e.playlist._id === id ? update(e) : e))
        );
    }
}
