import {
    computed,
    effect,
    inject,
    Injector,
    signal,
    untracked,
} from '@angular/core';
import {
    SecondStreamCatalogService,
    UnifiedRecentDataService,
    type SecondStreamSelection,
} from '@iptvnator/portal/shared/data-access';
import { PORTAL_PLAYBACK_POSITIONS } from '@iptvnator/portal/shared/util';
import { PLAYBACK_ACTIVITY_EVENTS } from '@iptvnator/services/activity-events';
import type { CompanionSlot } from './second-stream-open-stream';
import { SecondStreamSlotProgress } from './second-stream-slot-progress';

export class SecondStreamSlots {
    readonly numbers = [2, 3, 4] as const;
    private readonly entries = signal(
        new Map<CompanionSlot, SecondStreamSlotProgress>()
    );
    private readonly withheld = signal<ReadonlySet<CompanionSlot>>(new Set());
    private readonly closing = signal<ReadonlySet<CompanionSlot>>(new Set());
    private pending?: Promise<void>;
    private destroyed = false;
    private readonly catalog = inject(SecondStreamCatalogService);
    private readonly positions = inject(PORTAL_PLAYBACK_POSITIONS, {
        optional: true,
    });
    private readonly activity = inject(PLAYBACK_ACTIVITY_EVENTS);
    private readonly injector = inject(Injector);
    readonly busy = computed(
        () =>
            this.closing().size > 0 ||
            this.numbers.some((slot) => this.isWithheld(slot))
    );
    readonly playable = computed(() =>
        this.numbers.filter((slot) => this.at(slot) && !this.isWithheld(slot))
    );

    constructor(
        private readonly retireSound: (
            slots: ReadonlySet<CompanionSlot>
        ) => Promise<void>,
        private readonly removed: (slots: ReadonlySet<CompanionSlot>) => void
    ) {
        effect(() => {
            const slots = this.numbers.filter(
                (slot) => this.isWithheld(slot) && !this.isClosing(slot)
            );
            if (slots.length)
                untracked(() => {
                    this.withheld.update(
                        (current) => new Set([...current, ...slots])
                    );
                    void this.retire(slots);
                });
        });
    }

    at(slot: CompanionSlot): SecondStreamSlotProgress | undefined {
        return this.entries().get(slot);
    }

    isWithheld(slot: CompanionSlot): boolean {
        const selection = this.at(slot)?.selection;
        return Boolean(
            selection &&
            (this.withheld().has(slot) ||
                !this.catalog.isAllowed(selection.item))
        );
    }

    isClosing(slot: CompanionSlot): boolean {
        return this.closing().has(slot);
    }

    accept(slot: CompanionSlot, selection: SecondStreamSelection): void {
        const next = new Map(this.entries());
        next.get(slot)?.flush();
        next.set(
            slot,
            new SecondStreamSlotProgress(
                selection,
                this.activity,
                (playlistId, position) =>
                    void this.positions
                        ?.savePlaybackPosition(playlistId, position)
                        .catch(() => undefined),
                () =>
                    void this.injector
                        .get(UnifiedRecentDataService)
                        .recordPlayback(selection.item)
                        .catch(() => undefined)
            )
        );
        this.entries.set(next);
    }

    retire(slots: readonly CompanionSlot[]): Promise<void> {
        this.closing.update(
            (current) =>
                new Set([...current, ...slots.filter((slot) => this.at(slot))])
        );
        if (!this.closing().size) return Promise.resolve();
        this.pending ??= this.drain();
        return this.pending;
    }

    private async drain(): Promise<void> {
        try {
            while (this.closing().size && !this.destroyed) {
                const batch = this.closing();
                await this.retireSound(batch);
                if (this.destroyed) return;
                const next = new Map(this.entries());
                for (const slot of batch) {
                    next.get(slot)?.flush();
                    next.delete(slot);
                }
                this.entries.set(next);
                this.withheld.update(
                    (slots) =>
                        new Set([...slots].filter((slot) => !batch.has(slot)))
                );
                this.closing.update(
                    (slots) =>
                        new Set([...slots].filter((slot) => !batch.has(slot)))
                );
                this.removed(batch);
            }
        } finally {
            this.pending = undefined;
        }
    }

    destroy(): void {
        this.destroyed = true;
        for (const entry of this.entries().values()) entry.flush();
    }
}
