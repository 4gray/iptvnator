import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
    type Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map } from 'rxjs';
import type {
    EpgProgram,
    PortalActivityItem,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from '@iptvnator/services';
import {
    buildDashboardPortalLiveEpgEntry,
    DashboardPortalLiveEpgService,
    type DashboardPortalLiveEpgEntry,
} from '@iptvnator/workspace/dashboard/data-access';
import type { DashboardRailCard } from './dashboard-rail.component';
import { LIVE_EPG_TICK_MS } from './dashboard-live-epg.utils';

/**
 * The rails component's view of `DashboardPortalLiveEpgService`: which
 * portal live cards exist, which of them are on screen, and the answer for
 * a card. Component-provided, so its wanted set dies with the dashboard.
 *
 * "On screen" is what the rails report through their visibility output,
 * plus the pinned keys (the hero card, always at the top). A card the user
 * never scrolls to is never asked for. The 30 s tick re-syncs so a programme
 * that ended is asked again and progress bars keep moving; a changed display
 * offset re-syncs at once because every cached answer was just retired.
 */
@Injectable()
export class DashboardPortalLiveEpgPresenter {
    private readonly service = inject(DashboardPortalLiveEpgService);
    private readonly settingsStore = inject(SettingsStore);

    private readonly source = signal<Signal<
        readonly PortalActivityItem[]
    > | null>(null);
    private readonly visibleKeysByRail = signal<
        ReadonlyMap<string, ReadonlySet<string>>
    >(new Map());
    private readonly pinnedKeys = signal<ReadonlySet<string>>(new Set());

    /** Heartbeat shared with the XMLTV batch: shifted by one so the first
     *  emission differs from `initialValue` and is not swallowed. */
    readonly tick = toSignal(
        interval(LIVE_EPG_TICK_MS).pipe(map((tick) => tick + 1)),
        { initialValue: 0 }
    );

    private readonly entries = computed<
        ReadonlyMap<string, DashboardPortalLiveEpgEntry>
    >(() => {
        const source = this.source();
        const entries = new Map<string, DashboardPortalLiveEpgEntry>();
        for (const item of source?.() ?? []) {
            const entry = buildDashboardPortalLiveEpgEntry(item);
            if (entry && !entries.has(entry.key)) {
                entries.set(entry.key, entry);
            }
        }
        return entries;
    });

    private readonly wanted = computed<DashboardPortalLiveEpgEntry[]>(() => {
        const entries = this.entries();
        const keys = new Set<string>(this.pinnedKeys());
        for (const railKeys of this.visibleKeysByRail().values()) {
            for (const key of railKeys) keys.add(key);
        }
        const wanted: DashboardPortalLiveEpgEntry[] = [];
        for (const key of keys) {
            const entry = entries.get(key);
            if (entry) wanted.push(entry);
        }
        return wanted;
    });

    constructor() {
        effect(() => {
            const wanted = this.wanted();
            this.tick();
            this.settingsStore.resolvedEpgOffsetMinutes();
            untracked(() => this.service.sync(wanted));
        });
        // The queue lives in the root service; this presenter owns what it
        // wants. Leaving the dashboard must hand that back, or the queue
        // would keep asking for cards on a page that is gone — and a later
        // source change would ask for them again.
        inject(DestroyRef).onDestroy(() => this.service.sync([]));
    }

    /** The live rows every portal card on the dashboard is built from. */
    connect(source: Signal<readonly PortalActivityItem[]>): void {
        this.source.set(source);
    }

    /** Keys wanted regardless of scrolling (the hero card). */
    setPinnedKeys(keys: readonly (string | null | undefined)[]): void {
        this.pinnedKeys.set(
            new Set(keys.filter((key): key is string => !!key))
        );
    }

    /** A rail reported the cards inside its viewport. */
    setVisibleCards(railId: string, cards: readonly DashboardRailCard[]): void {
        const keys = new Set<string>();
        for (const card of cards) {
            if (card.liveEpgSourceKey) keys.add(card.liveEpgSourceKey);
        }
        this.visibleKeysByRail.update((byRail) => {
            const next = new Map(byRail);
            next.set(railId, keys);
            return next;
        });
    }

    /**
     * `undefined` = not asked yet or still in flight, `null` = asked and
     * nothing on air, else the programme.
     */
    programFor(key: string | null | undefined): EpgProgram | null | undefined {
        return key ? this.service.programs().get(key) : undefined;
    }

    isPending(key: string | null | undefined): boolean {
        return !!key && this.service.pending().has(key);
    }
}
