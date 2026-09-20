import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import {
    epgProviderClockMs,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import {
    EpgSourceSettingsService,
    RuntimeCapabilitiesService,
    SettingsStore,
} from '@iptvnator/services';
import { StreamResolverService } from '@iptvnator/portal/shared/data-access';
import {
    dashboardPortalLiveEpgProgramStopMs,
    resolveDashboardPortalLiveEpgProgram,
    type DashboardPortalLiveEpgEntry,
} from './dashboard-portal-live-epg.util';

interface CachedProgram {
    readonly program: EpgProgram | null;
    readonly fetchedAt: number;
}

/**
 * Same numbers `EpgQueueService` uses against real Xtream panels: two
 * requests in flight, 200 ms between starts. A programme is trusted for a
 * minute; a programme that ended is asked again, but never more often than
 * every 30 s in case the portal keeps returning the stale row.
 *
 * An answer with no programme expires sooner (`emptyTtlMs`) because the
 * collection resolver reports a failed portal and a channel with no guide
 * identically — it catches per-channel failures and files them as `null`.
 * There is therefore no failure cooldown to keep: the short TTL is what lets
 * a transient outage recover on the next tick, at the price of re-asking a
 * genuinely guide-less channel while its card stays on screen.
 */
export const DASHBOARD_PORTAL_LIVE_EPG_TIMING = Object.freeze({
    maxConcurrency: 2,
    delayMs: 200,
    ttlMs: 60_000,
    emptyTtlMs: 30_000,
    endedRefetchFloorMs: 30_000,
});

/**
 * Lazy, per-card "what is on air" for the dashboard's Xtream and Stalker
 * live cards. `sync()` receives the cards currently worth asking for — the
 * visible ones — and the service answers each through the collection
 * resolver one card at a time, publishing every answer the moment it lands
 * (`programs`) so a slow portal never delays a fast one. The queue holds
 * only wanted keys, so a card scrolled away before its turn is never
 * requested. One instance for the app: favourites and recent rows of the
 * same channel share the key and therefore the answer.
 */
@Injectable({ providedIn: 'root' })
export class DashboardPortalLiveEpgService implements OnDestroy {
    private readonly streamResolver = inject(StreamResolverService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly sourceSettings = inject(EpgSourceSettingsService);
    private readonly sourceSubscription =
        this.sourceSettings.changed$.subscribe(() => this.retireAnswers());

    private readonly cache = new Map<string, CachedProgram>();
    private wanted = new Map<string, DashboardPortalLiveEpgEntry>();
    private queue: string[] = [];
    private readonly inFlight = new Set<string>();
    private processing = false;
    /** Display offset every cached answer was evaluated under. */
    private stateOffsetMinutes = this.offsetMinutes();

    private readonly programsState = signal<
        ReadonlyMap<string, EpgProgram | null>
    >(new Map());
    private readonly pendingState = signal<ReadonlySet<string>>(new Set());

    /** Answers by entry key; absent = not asked yet, `null` = nothing on air. */
    readonly programs = this.programsState.asReadonly();
    /** Keys queued or in flight — the cards that may show a placeholder. */
    readonly pending = this.pendingState.asReadonly();

    /**
     * Replace the wanted set. Keys without a fresh answer are queued; keys no
     * longer wanted are dropped from the queue (an in-flight request is
     * allowed to finish and is cached for when the card scrolls back).
     */
    sync(entries: readonly DashboardPortalLiveEpgEntry[]): void {
        // The collection resolver this queue asks through is gated on the
        // local XMLTV bridge (`supportsProgramLookup`, desktop only) and
        // answers nothing without it, so the PWA never queues at all rather
        // than filing an empty answer for every card.
        if (!this.runtime.supportsEpgProgramLookup) {
            return;
        }
        this.retireStateOfPreviousOffset();
        this.wanted = new Map(entries.map((entry) => [entry.key, entry]));
        this.queue = this.queue.filter((key) => this.wanted.has(key));
        const now = Date.now();
        for (const entry of entries) {
            if (
                this.needsFetch(entry.key, now) &&
                !this.queue.includes(entry.key)
            ) {
                this.queue.push(entry.key);
            }
        }
        this.publishPending();
        if (!this.processing && this.queue.length > 0) {
            void this.processQueue();
        }
    }

    ngOnDestroy(): void {
        this.sourceSubscription.unsubscribe();
    }

    private offsetMinutes(): number {
        return this.settingsStore.resolvedEpgOffsetMinutes();
    }

    private needsFetch(key: string, now: number): boolean {
        if (this.inFlight.has(key)) {
            return false;
        }
        const cached = this.cache.get(key);
        if (!cached) {
            return true;
        }
        const ttlMs = cached.program
            ? DASHBOARD_PORTAL_LIVE_EPG_TIMING.ttlMs
            : DASHBOARD_PORTAL_LIVE_EPG_TIMING.emptyTtlMs;
        if (now - cached.fetchedAt >= ttlMs) {
            return true;
        }
        const stopMs = dashboardPortalLiveEpgProgramStopMs(cached.program);
        return (
            stopMs !== null &&
            epgProviderClockMs(now, this.stateOffsetMinutes) >= stopMs &&
            now - cached.fetchedAt >=
                DASHBOARD_PORTAL_LIVE_EPG_TIMING.endedRefetchFloorMs
        );
    }

    private async processQueue(): Promise<void> {
        this.processing = true;
        try {
            while (this.queue.length > 0) {
                if (
                    this.inFlight.size >=
                    DASHBOARD_PORTAL_LIVE_EPG_TIMING.maxConcurrency
                ) {
                    await this.delay();
                    continue;
                }
                const key = this.queue.shift();
                if (
                    key == null ||
                    !this.wanted.has(key) ||
                    !this.needsFetch(key, Date.now())
                ) {
                    this.publishPending();
                    continue;
                }
                this.inFlight.add(key);
                void this.fetch(key);
                await this.delay();
            }
        } finally {
            this.processing = false;
        }
    }

    private async fetch(key: string): Promise<void> {
        const entry = this.wanted.get(key);
        if (!entry) {
            this.inFlight.delete(key);
            this.publishPending();
            return;
        }
        // Both facts this answer is evaluated against. The revision is the
        // same fence `EpgService.guard()` uses: a reconciliation bumps it, so
        // a result computed against the previous XMLTV source set can be told
        // apart from one computed against the current one.
        const offsetMinutes = this.offsetMinutes();
        const revision = this.sourceSettings.revision();
        let program: EpgProgram | null = null;
        try {
            const epgMap = await this.streamResolver.loadEpgForItems([
                entry.item,
            ]);
            program = resolveDashboardPortalLiveEpgProgram(epgMap, entry);
        } catch {
            // The resolver files a failed portal as `null` itself, so this
            // only catches a resolver-level throw. Same answer either way,
            // and `emptyTtlMs` is what makes it recoverable.
            program = null;
        }
        this.inFlight.delete(key);

        // A setting or the source set changed while the request was on the
        // wire: this answer belongs to the previous provider clock or the
        // previous guide. `retireAnswers()` could not requeue the key while
        // it was in flight, so the requeue happens here — otherwise the stale
        // answer would be published and trusted for a full TTL.
        if (
            offsetMinutes !== this.offsetMinutes() ||
            revision !== this.sourceSettings.revision()
        ) {
            this.retireStateOfPreviousOffset();
            this.requeueIfWanted(key);
            return;
        }

        this.cache.set(key, { program, fetchedAt: Date.now() });
        this.programsState.update((programs) => {
            const next = new Map(programs);
            next.set(key, program);
            return next;
        });
        this.publishPending();
    }

    private requeueIfWanted(key: string): void {
        if (this.wanted.has(key) && !this.queue.includes(key)) {
            this.queue.push(key);
        }
        this.publishPending();
        if (!this.processing && this.queue.length > 0) {
            void this.processQueue();
        }
    }

    /**
     * Every answer here is "what is on at the provider clock", so a changed
     * display offset drops all of them. The caller's own `sync` (the
     * presenter re-syncs on an offset change) asks the wanted cards again.
     */
    private retireStateOfPreviousOffset(): void {
        const current = this.offsetMinutes();
        if (current === this.stateOffsetMinutes) {
            return;
        }
        this.stateOffsetMinutes = current;
        this.dropAnswers();
    }

    /** Removed or re-imported XMLTV: drop every answer and ask again now. */
    private retireAnswers(): void {
        this.dropAnswers();
        if (this.wanted.size > 0) {
            this.sync(Array.from(this.wanted.values()));
        }
    }

    private dropAnswers(): void {
        this.cache.clear();
        this.programsState.set(new Map());
    }

    private publishPending(): void {
        const pending = new Set<string>();
        for (const key of this.queue) {
            if (this.wanted.has(key)) pending.add(key);
        }
        for (const key of this.inFlight) {
            if (this.wanted.has(key)) pending.add(key);
        }
        this.pendingState.set(pending);
    }

    private delay(): Promise<void> {
        return new Promise((resolve) =>
            setTimeout(resolve, DASHBOARD_PORTAL_LIVE_EPG_TIMING.delayMs)
        );
    }
}
