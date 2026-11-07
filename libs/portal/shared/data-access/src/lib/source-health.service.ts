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
import { fingerprintSourceHealthKey } from './source-health-identity';
import { SourceHealthHistoryService } from './source-health-history.service';
import { SourceHealthProbesService } from './source-health-probes.service';

interface Job {
    key: string;
    playlist: PlaylistMeta;
    origin: string;
    explicit: boolean;
    retried: boolean;
    waitingRetries: number;
    initial?: SourceHealthSnapshot;
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
    private readonly history = inject(SourceHealthHistoryService);
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
        if (
            options.fresh &&
            job &&
            !job.explicit &&
            (job.running || job.retried)
        )
            return this.waitForBackground(
                job,
                p,
                options.deadlineAt ?? Date.now() + 15000,
                options.signal
            );
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
                retried: false,
                waitingRetries: 0,
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
        const release = this.consume(job);
        options.signal?.addEventListener('abort', release, { once: true });
        this.drain();
        return job.promise.finally(() =>
            options.signal?.removeEventListener('abort', release)
        );
    }
    private async waitForBackground(
        job: Job,
        p: PlaylistMeta,
        deadlineAt: number,
        signal?: AbortSignal
    ): Promise<SourceHealthSnapshot> {
        const release = this.consume(job);
        job.waitingRetries++;
        let stop!: () => void;
        const stopped = new Promise<void>((resolve) => {
            stop = resolve;
        });
        const timer = setTimeout(stop, Math.max(0, deadlineAt - Date.now()));
        signal?.addEventListener('abort', stop, { once: true });
        try {
            this.drain();
            const snapshot = await Promise.race([job.promise, stopped]);
            if (signal?.aborted || this.identities.get(p._id) !== job.key)
                return { ...sourceHealthUnknown('cancelled'), checkedAt: 0 };
            if (!snapshot || Date.now() >= deadlineAt) {
                const previous = this.snapshots().get(job.key);
                if (previous && previous !== job.initial) return previous;
                const timeout = {
                    ...sourceHealthUnknown('timeout'),
                    checkedAt: Date.now(),
                };
                if (job.users.size === 1 && this.jobs.get(job.key) === job) {
                    if (job.running) this.publish(job.key, timeout);
                    else if (previous?.state === 'checking')
                        this.publish(job.key, {
                            ...sourceHealthUnknown(),
                            checkedAt: 0,
                        });
                }
                return timeout;
            }
            if (job.retried) return snapshot;
            return this.check(p, { fresh: true, deadlineAt, signal });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', stop);
            job.waitingRetries--;
            release();
        }
    }
    private consume(job: Job): () => void {
        const user = Symbol();
        job.users.add(user);
        return () => {
            job.users.delete(user);
            if (!job.users.size) this.cancel(job);
        };
    }
    private boundQueueWait(job: Job): void {
        if (job.queueTimer !== undefined) return;
        job.initial = this.snapshots().get(job.key);
        job.queueTimer = setTimeout(
            () => this.expireQueued(job),
            Math.max(0, job.deadlineAt! - Date.now())
        );
    }
    private expireQueued(job: Job): void {
        if (job.running || this.jobs.get(job.key) !== job) return;
        clearTimeout(job.queueTimer);
        this.jobs.delete(job.key);
        const previous = this.snapshots().get(job.key);
        const snapshot =
            previous && previous !== job.initial
                ? previous
                : { ...sourceHealthUnknown('timeout'), checkedAt: Date.now() };
        // A wait in the local queue is not evidence against the source.
        if (previous === job.initial && previous?.state === 'checking')
            this.publish(job.key, { ...sourceHealthUnknown(), checkedAt: 0 });
        job.resolve(snapshot);
    }
    private cancel(job: Job): void {
        if (this.jobs.get(job.key) !== job) return;
        clearTimeout(job.queueTimer);
        job.controller.abort();
        this.jobs.delete(job.key);
        if (job.running) void window.electron.cancelSourceProbe(job.requestId);
        else job.resolve({ ...sourceHealthUnknown('cancelled'), checkedAt: 0 });
    }
    private drain(): void {
        const queue = [...this.jobs.values()]
            .filter((j) => !j.running && j.users.size)
            .sort(
                (a, b) =>
                    Number(b.explicit || b.waitingRetries > 0) -
                    Number(a.explicit || a.waitingRetries > 0)
            );
        for (const job of queue) {
            if (job.deadlineAt !== undefined && job.deadlineAt <= Date.now()) {
                this.expireQueued(job);
                continue;
            }
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
        const initial = this.snapshots().get(job.key);
        if (!job.retried) job.initial = initial;
        let snapshot = await (initial && initial !== job.initial
            ? initial
            : this.attempt(job));
        const previous = this.snapshots().get(job.key);
        this.active--;
        this.origins.set(job.origin, (this.origins.get(job.origin) ?? 1) - 1);
        if (
            !job.explicit &&
            !job.retried &&
            snapshot.reason === 'timeout' &&
            this.jobs.get(job.key) === job &&
            previous === job.initial
        ) {
            // A passive retry goes behind the work that is already queued.
            job.retried = true;
            job.running = false;
            job.requestId = crypto.randomUUID();
            job.controller = new AbortController();
            this.jobs.delete(job.key);
            this.jobs.set(job.key, job);
        } else {
            if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
            if (
                job.users.size &&
                [...this.identities.values()].includes(job.key)
            ) {
                // Keep any newer account evidence published during the check.
                if (previous && previous !== job.initial) {
                    snapshot = previous;
                } else {
                    this.publish(job.key, snapshot);
                }
            }
            job.resolve(snapshot);
        }
        this.drain();
    }
    private async attempt(job: Job): Promise<SourceHealthSnapshot> {
        const startedAt = Date.now();
        const deadlineAt =
            job.deadlineAt ??
            startedAt + (job.explicit || job.retried ? 15000 : 5000);
        try {
            const result =
                deadlineAt <= startedAt
                    ? sourceHealthUnknown('timeout')
                    : await this.checkWithinDeadline(job, deadlineAt);
            return { ...result, checkedAt: Date.now() };
        } catch (error) {
            const snapshot = {
                ...sourceHealthError(error),
                checkedAt: Date.now(),
            };
            if (snapshot.reason === 'cancelled' && Date.now() >= deadlineAt)
                snapshot.reason = 'timeout';
            return snapshot;
        }
    }
    private async checkWithinDeadline(
        job: Job,
        deadlineAt: number
    ): Promise<SourceHealthResult> {
        // This attempt's transport: an escalation replaces the job's.
        const { controller, requestId } = job;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const stopped = new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error('cancelled'));
            controller.signal.addEventListener('abort', onAbort, {
                once: true,
            });
            timer = setTimeout(
                () => {
                    // Also cancel the transport; the race bounds waits before a socket exists.
                    reject(new Error('deadline exceeded'));
                    controller.abort();
                    void window.electron.cancelSourceProbe(requestId);
                },
                Math.max(0, deadlineAt - Date.now())
            );
        });
        try {
            return await Promise.race([
                this.probes.check(
                    job.playlist,
                    { requestId, deadlineAt },
                    controller.signal
                ),
                stopped,
            ]);
        } finally {
            clearTimeout(timer);
            if (onAbort)
                controller.signal.removeEventListener('abort', onAbort);
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
        // Every playlist with these connection details shares the result.
        const ids = [...this.identities]
            .filter(([, identity]) => identity === key)
            .map(([id]) => id);
        if (ids.length)
            this.history.record(ids, snapshot, fingerprintSourceHealthKey(key));
    }
}
