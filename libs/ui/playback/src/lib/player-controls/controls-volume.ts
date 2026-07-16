import { signal } from '@angular/core';
import {
    persistVolume,
    readStoredVolume,
    volumeIcon,
} from './controls-format.utils';
import type { PlayerController } from './player-controls.model';

const VOLUME_POPOVER_CLOSE_DELAY_MS = 220;

export interface ControlsVolumeDeps {
    /** Apply the volume to the underlying player (command). */
    apply: (value: number) => void;
    /** Flash transient feedback (icon + label). */
    flash: (icon: string, label: string) => void;
    /** Resolve the translated label used when muting. */
    mutedLabel: () => string;
    /** Open the hover popover. */
    openPopover: () => void;
    /** Close the hover popover. */
    closePopover: () => void;
}

/**
 * Owns the optimistic volume value, mute/unmute memory, and the hover-popover
 * close timer. `set` is the single mutation point: it updates the optimistic
 * value, persists it, and applies it to the player. The component still calls
 * `reveal()` around these and binds the slider to `value`.
 */
export class ControlsVolume {
    readonly value = signal(readStoredVolume());

    private mutedVolume = 0;
    private closeTimer: number | null = null;
    private readonly initializedControllers = new WeakSet<PlayerController>();
    private readonly pendingInitialSnapshots = new WeakMap<
        PlayerController,
        number
    >();

    constructor(private readonly deps: ControlsVolumeDeps) {}

    set(value: number): void {
        const clamped = Math.max(0, Math.min(1, value));
        this.value.set(clamped);
        persistVolume(clamped);
        this.deps.apply(clamped);
    }

    hasInitializedController(controller: PlayerController): boolean {
        return this.initializedControllers.has(controller);
    }

    beginCapabilityEpoch(
        controller: PlayerController,
        enabled: boolean
    ): boolean {
        if (!enabled) {
            this.deactivateController(controller);
            return false;
        }
        return !this.hasInitializedController(controller);
    }

    deactivateController(controller: PlayerController): void {
        this.initializedControllers.delete(controller);
        this.pendingInitialSnapshots.delete(controller);
    }

    initializeController(controller: PlayerController, snapshot: number): void {
        if (this.initializedControllers.has(controller)) {
            return;
        }
        this.initializedControllers.add(controller);
        if (localStorage.getItem('volume') !== null) {
            this.deps.apply(this.value());
            this.pendingInitialSnapshots.set(controller, snapshot);
        } else {
            this.reconcile(snapshot);
        }
    }

    reconcileController(controller: PlayerController, snapshot: number): void {
        if (!this.initializedControllers.has(controller)) {
            return;
        }
        if (this.pendingInitialSnapshots.get(controller) === snapshot) {
            this.pendingInitialSnapshots.delete(controller);
            return;
        }
        this.pendingInitialSnapshots.delete(controller);
        this.reconcile(snapshot);
    }

    adjust(delta: number): void {
        const next = this.value() + delta;
        this.set(next);
        this.deps.flash(
            volumeIcon(this.value()),
            `${Math.round(this.value() * 100)}%`
        );
    }

    toggleMute(): void {
        const current = this.value();
        if (current > 0) {
            this.mutedVolume = current;
            this.set(0);
            this.deps.flash('volume_off', this.deps.mutedLabel());
        } else {
            const restored = this.mutedVolume || 0.5;
            this.set(restored);
            this.deps.flash(
                volumeIcon(restored),
                `${Math.round(restored * 100)}%`
            );
        }
    }

    /** Reconcile the optimistic value with the authoritative player state. */
    reconcile(value: number): void {
        this.value.set(value);
    }

    hoverEnter(): void {
        this.clearTimer();
        this.deps.openPopover();
    }

    hoverLeave(): void {
        this.clearTimer();
        this.closeTimer = window.setTimeout(() => {
            this.deps.closePopover();
            this.closeTimer = null;
        }, VOLUME_POPOVER_CLOSE_DELAY_MS);
    }

    dispose(): void {
        this.clearTimer();
    }

    private clearTimer(): void {
        if (this.closeTimer !== null) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
    }
}
