import { Injectable, inject, signal } from '@angular/core';
import {
    SourceHealthEvidenceService,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import {
    PlaylistMeta,
    SourceHealthSnapshot,
    SourceHealthResult,
    sourceHealthType,
    sourceHealthKey,
    sourceHealthUnknown,
    sourceHealthError,
} from '@iptvnator/shared/interfaces';
import { SourceHealthProbesService } from './source-health-probes.service';

interface Job {
    key: string;
    playlist: PlaylistMeta;
    origin: string;
    explicit: boolean;
    requestId: string;
    deadlineAt?: number;
    queueTimer?: ReturnType<typeof setTimeout>;
    controller: AbortController;
    users: Set<symbol>;
    running: boolean;
    promise: Promise<SourceHealthSnapshot>;
    resolve: (value: SourceHealthSnapshot) => void;
}
@Injectable({ providedIn: 'root' })
export class SourceHealthService {
    private readonly probes = inject(SourceHealthProbesService);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    readonly snapshots = signal<ReadonlyMap<string, SourceHealthSnapshot>>(
        new Map()
    );
    private readonly jobs = new Map<string, Job>();
    private readonly identities = new Map<string, string>();
    private readonly origins = new Map<string, number>();
    private active = 0;
    constructor() {
        const evidence = inject(SourceHealthEvidenceService);
        evidence.connections.subscribe(({ id, playlist }) => {
            if (!id) {
                [...this.identities.keys()].forEach((key) =>
                    this.invalidate(key)
                );
            } else if (
                !playlist ||
                this.identities.get(id) !== sourceHealthKey(playlist)
            ) {
                this.invalidate(id);
            }
        });
        evidence.results.subscribe(({ playlist, result }) => {
            const key = sourceHealthKey(playlist);
            if (![...this.identities.values()].includes(key)) return;
            this.publish(key, { ...result, checkedAt: Date.now() });
        });
    }
    async recheck(
        p: PlaylistMeta,
        signal?: AbortSignal
    ): Promise<SourceHealthSnapshot> {
        if (signal?.aborted)
            return { ...sourceHealthUnknown('cancelled'), checkedAt: 0 };
        if (sourceHealthType(p) !== 'm3u')
            await window.electron.resetHostConnectivityGuard(
                p.portalUrl || p.serverUrl!
            );
        return this.check(p, { fresh: true, signal });
    }
    get(p: PlaylistMeta): SourceHealthSnapshot | undefined {
        return this.snapshots().get(sourceHealthKey(p));
    }
    invalidate(id: string): void {
        const key = this.identities.get(id);
        this.identities.delete(id);
        if (!key || [...this.identities.values()].includes(key)) return;
        const job = this.jobs.get(key);
        if (job) {
            job.users.clear();
            this.cancel(job);
        }
        this.snapshots.update((map) => {
            const next = new Map(map);
            next.delete(key);
            return next;
        });
    }
    check(
        p: PlaylistMeta,
        options: {
            fresh?: boolean;
            signal?: AbortSignal;
            deadlineAt?: number;
        } = {}
    ): Promise<SourceHealthSnapshot> {
        if (
            !this.runtime.supportsSourceHealth ||
            !sourceHealthType(p) ||
            options.signal?.aborted
        )
            return Promise.resolve({ ...sourceHealthUnknown(), checkedAt: 0 });
        const key = sourceHealthKey(p);
        if (this.identities.has(p._id) && this.identities.get(p._id) !== key)
            this.invalidate(p._id);
        this.identities.set(p._id, key);
        const cached = this.snapshots().get(key);
        const ttl =
            cached?.state === 'active' || cached?.confirmedInactive
                ? 60000
                : 15000;
        if (!options.fresh && cached && Date.now() - cached.checkedAt < ttl)
            return Promise.resolve(cached);
        let job = this.jobs.get(key);
        if (options.fresh && job?.running && !job.explicit) {
            const deadlineAt = options.deadlineAt ?? Date.now() + 15000;
            return job.promise.then(() =>
                this.identities.get(p._id) === key
                    ? this.check(p, { ...options, deadlineAt })
                    : { ...sourceHealthUnknown('cancelled'), checkedAt: 0 }
            );
        }
        if (!job) {
            let resolve!: Job['resolve'];
            const promise = new Promise<SourceHealthSnapshot>((r) => {
                resolve = r;
            });
            job = {
                key,
                playlist: { ...p },
                origin: new URL(p.portalUrl || p.serverUrl || p.url!).origin,
                explicit: !!options.fresh,
                users: new Set(),
                running: false,
                requestId: crypto.randomUUID(),
                deadlineAt: options.deadlineAt,
                controller: new AbortController(),
                promise,
                resolve,
            };
            this.jobs.set(key, job);
            if (!cached)
                this.publish(key, {
                    state: 'checking',
                    reason: 'unknown',
                    confirmedInactive: false,
                    checkedAt: 0,
                });
        }
        if (options.fresh && !job.running) {
            job.explicit = true;
            job.deadlineAt ??= options.deadlineAt ?? Date.now() + 15000;
            this.boundQueueWait(job);
        }
        const user = Symbol();
        job.users.add(user);
        const ownedJob = job;
        const cancel = () => {
            ownedJob.users.delete(user);
            if (!ownedJob.users.size) this.cancel(ownedJob);
        };
        options.signal?.addEventListener('abort', cancel, { once: true });
        this.drain();
        return job.promise.finally(() =>
            options.signal?.removeEventListener('abort', cancel)
        );
    }
    private boundQueueWait(job: Job): void {
        if (job.queueTimer !== undefined) return;
        const queuedAt = Date.now();
        const initial = this.snapshots().get(job.key);
        job.queueTimer = setTimeout(
            () => {
                if (job.running || this.jobs.get(job.key) !== job) return;
                this.jobs.delete(job.key);
                const previous = this.snapshots().get(job.key);
                const snapshot =
                    previous && previous !== initial
                        ? previous
                        : {
                              ...sourceHealthUnknown('timeout'),
                              checkedAt: Date.now(),
                          };
                if (
                    job.users.size &&
                    [...this.identities.values()].includes(job.key)
                )
                    this.publish(job.key, snapshot);
                job.resolve(snapshot);
            },
            Math.max(0, job.deadlineAt! - queuedAt)
        );
    }
    private cancel(job: Job): void {
        if (this.jobs.get(job.key) !== job) return;
        clearTimeout(job.queueTimer);
        job.controller.abort();
        this.jobs.delete(job.key);
        if (job.running) void window.electron.cancelSourceProbe(job.requestId);
        else {
            this.jobs.delete(job.key);
            job.resolve({ ...sourceHealthUnknown('cancelled'), checkedAt: 0 });
        }
    }
    private drain(): void {
        const queue = [...this.jobs.values()]
            .filter((j) => !j.running && j.users.size)
            .sort((a, b) => Number(b.explicit) - Number(a.explicit));
        for (const job of queue) {
            if (this.active >= 4) break;
            if ((this.origins.get(job.origin) ?? 0) >= 2) continue;
            clearTimeout(job.queueTimer);
            job.running = true;
            this.active++;
            this.origins.set(
                job.origin,
                (this.origins.get(job.origin) ?? 0) + 1
            );
            void this.run(job);
        }
    }
    private async run(job: Job) {
        const startedAt = Date.now();
        const initial = this.snapshots().get(job.key);
        const deadlineAt =
            job.deadlineAt ?? startedAt + (job.explicit ? 15000 : 5000);
        let snapshot: SourceHealthSnapshot;
        try {
            const result =
                deadlineAt <= startedAt
                    ? sourceHealthUnknown('timeout')
                    : await this.checkWithinDeadline(job, deadlineAt);
            snapshot = { ...result, checkedAt: Date.now() };
        } catch (error) {
            snapshot = { ...sourceHealthError(error), checkedAt: Date.now() };
            if (snapshot.reason === 'cancelled' && Date.now() >= deadlineAt)
                snapshot.reason = 'timeout';
        }
        if (job.users.size && [...this.identities.values()].includes(job.key)) {
            const previous = this.snapshots().get(job.key);
            // An account dialog may have published newer evidence while this check ran.
            if (!previous || previous === initial) {
                this.publish(job.key, snapshot);
            } else {
                // Return the same newer evidence that the indicator displays.
                snapshot = previous;
            }
        }
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.active--;
        this.origins.set(job.origin, (this.origins.get(job.origin) ?? 1) - 1);
        job.resolve(snapshot);
        this.drain();
    }
    private async checkWithinDeadline(
        job: Job,
        deadlineAt: number
    ): Promise<SourceHealthResult> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const stopped = new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error('cancelled'));
            job.controller.signal.addEventListener('abort', onAbort, {
                once: true,
            });
            timer = setTimeout(
                () => {
                    // Also cancel the transport; the race bounds waits before a socket exists.
                    reject(new Error('deadline exceeded'));
                    job.controller.abort();
                    void window.electron.cancelSourceProbe(job.requestId);
                },
                Math.max(0, deadlineAt - Date.now())
            );
        });
        try {
            return await Promise.race([
                this.probes.check(
                    job.playlist,
                    { requestId: job.requestId, deadlineAt },
                    job.controller.signal
                ),
                stopped,
            ]);
        } finally {
            clearTimeout(timer);
            if (onAbort)
                job.controller.signal.removeEventListener('abort', onAbort);
        }
    }
    private publish(key: string, result: SourceHealthSnapshot) {
        const previous = this.snapshots().get(key);
        const snapshot = {
            ...result,
            lastSuccessAt:
                result.state === 'active'
                    ? result.checkedAt
                    : previous?.lastSuccessAt,
        };
        this.snapshots.update((map) => new Map(map).set(key, snapshot));
    }
}
