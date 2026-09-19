import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import {
    epgProviderClockMs,
    type EpgProgram,
} from '@iptvnator/shared/interfaces';
import { EpgSourceSettingsService, SettingsStore } from '@iptvnator/services';
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
 * requests in flight, 200 ms between starts. A card's answer is trusted for
 * a minute; a portal that failed is left alone for 30 s; a programme that
 * ended is asked again, but never more often than every 30 s in case the
 * portal keeps returning the stale row.
 */
export const DASHBOARD_PORTAL_LIVE_EPG_TIMING = Object.freeze({
    maxConcurrency: 2,
    delayMs: 200,
    ttlMs: 60_000,
    failureCooldownMs: 30_000,
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
    private readonly sourceSubscription = inject(
        EpgSourceSettingsService
    ).changed$.subscribe(() => this.retireAnswers());

    private readonly cache = new Map<string, CachedProgram>();
    private readonly failureAt = new Map<string, number>();
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
        if (this.inFlight.has(key) || this.isCoolingDown(key, now)) {
            return false;
        }
        const cached = this.cache.get(key);
        if (!cached) {
            return true;
        }
        if (now - cached.fetchedAt >= DASHBOARD_PORTAL_LIVE_EPG_TIMING.ttlMs) {
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

    private isCoolingDown(key: string, now: number): boolean {
        const failedAt = this.failureAt.get(key);
        if (failedAt == null) {
            return false;
        }
        if (
            now - failedAt >=
            DASHBOARD_PORTAL_LIVE_EPG_TIMING.failureCooldownMs
        ) {
            this.failureAt.delete(key);
            return false;
        }
        return true;
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
        const offsetMinutes = this.offsetMinutes();
        let program: EpgProgram | null = null;
        let failed = false;
        try {
            const epgMap = await this.streamResolver.loadEpgForItems([
                entry.item,
            ]);
            program = resolveDashboardPortalLiveEpgProgram(epgMap, entry);
        } catch {
            failed = true;
        }
        this.inFlight.delete(key);

        // The setting changed while the request was on the wire: this answer
        // belongs to the previous provider clock. Retire it and ask again if
        // the card is still wanted.
        if (offsetMinutes !== this.offsetMinutes()) {
            this.retireStateOfPreviousOffset();
            this.requeueIfWanted(key);
            return;
        }

        if (failed) {
            this.failureAt.set(key, Date.now());
        } else {
            this.cache.set(key, { program, fetchedAt: Date.now() });
            this.programsState.update((programs) => {
                const next = new Map(programs);
                next.set(key, program);
                return next;
            });
        }
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
        this.failureAt.clear();
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
