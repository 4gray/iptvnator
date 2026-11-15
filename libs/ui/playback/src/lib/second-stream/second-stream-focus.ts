import { afterNextRender, DestroyRef, inject, Injector } from '@angular/core';
import {
    PLAYER_SHORTCUTS_SUSPENDED_SELECTOR,
    targetsInteractivePlayerControl,
} from '../player-controls/controls-shortcuts';
import type { CompanionSlot, MultiviewSlot } from './second-stream-open-stream';

const SLOT_KEYS = new Map<string, MultiviewSlot>([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
]);

export class SecondStreamFocus {
    private readonly injector = inject(Injector);
    private readonly destroyRef = inject(DestroyRef);

    constructor(private readonly host: () => HTMLElement) {}

    async pick(
        result: Promise<CompanionSlot | null>,
        trigger = this.entry()
    ): Promise<void> {
        const slot = await result;
        this.restore(() => {
            if (slot === null)
                return trigger?.isConnected ? trigger : this.entry();
            return (
                this.host().querySelector<HTMLElement>(
                    `[data-multiview-control="${slot}"]:not([aria-disabled="true"])`
                ) ?? this.host().querySelector('[data-multiview-stage]')
            );
        }, trigger);
    }

    async close(result: Promise<void>, slot?: CompanionSlot): Promise<void> {
        const origin = this.host().ownerDocument.activeElement;
        if (!this.host().contains(origin)) return;
        await result;
        this.restore(
            () =>
                (slot === undefined
                    ? null
                    : this.host().querySelector<HTMLElement>(
                          `[data-multiview-add="${slot}"]`
                      )) ?? this.entry(),
            origin
        );
    }

    enterGrid(trigger = this.entry()): void {
        this.restore(
            () => this.host().querySelector('[data-multiview-stage]'),
            trigger
        );
    }

    slotFromKey(event: KeyboardEvent): MultiviewSlot | null {
        const slot = SLOT_KEYS.get(event.key);
        if (
            slot === undefined ||
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !(event.target instanceof Element) ||
            !this.host().contains(event.target) ||
            event.target.closest(PLAYER_SHORTCUTS_SUSPENDED_SELECTOR) ||
            targetsInteractivePlayerControl(event)
        ) {
            return null;
        }
        return slot;
    }

    private entry(): HTMLElement | null {
        return this.host().querySelector('[data-multiview-trigger]');
    }

    private restore(
        target: () => HTMLElement | null,
        origin: Element | null
    ): void {
        if (this.destroyRef.destroyed) return;
        afterNextRender(
            {
                mixedReadWrite: () => {
                    const host = this.host();
                    const document = host.ownerDocument;
                    const current = document.activeElement;
                    // Moving to another control or leaving the player while
                    // an asynchronous action settles takes priority.
                    if (
                        host.isConnected &&
                        (current === origin ||
                            current === document.body ||
                            !current?.isConnected)
                    ) {
                        target()?.focus();
                    }
                },
            },
            { injector: this.injector }
        );
    }
}
