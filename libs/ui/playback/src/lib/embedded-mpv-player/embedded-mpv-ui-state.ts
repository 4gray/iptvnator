import { computed, signal } from '@angular/core';

export type EmbeddedMpvMenu =
    | 'volume'
    | 'audio'
    | 'subtitle'
    | 'speed'
    | 'aspect';

/**
 * Tracks which menu/popover is currently open and exposes individual signals
 * the template binds to. Only one menu can be open at a time.
 */
export class EmbeddedMpvMenuState {
    readonly volumeOpen = signal(false);
    readonly audioOpen = signal(false);
    readonly subtitleOpen = signal(false);
    readonly speedOpen = signal(false);
    readonly aspectOpen = signal(false);

    readonly anyOpen = computed(
        () =>
            this.volumeOpen() ||
            this.audioOpen() ||
            this.subtitleOpen() ||
            this.speedOpen() ||
            this.aspectOpen()
    );

    toggle(menu: EmbeddedMpvMenu): void {
        const target = this.signalFor(menu);
        const next = !target();
        this.closeAll();
        target.set(next);
    }

    open(menu: EmbeddedMpvMenu): void {
        if (this.signalFor(menu)()) {
            return;
        }
        this.closeAll();
        this.signalFor(menu).set(true);
    }

    close(menu: EmbeddedMpvMenu): void {
        this.signalFor(menu).set(false);
    }

    closeAll(): void {
        this.volumeOpen.set(false);
        this.audioOpen.set(false);
        this.subtitleOpen.set(false);
        this.speedOpen.set(false);
        this.aspectOpen.set(false);
    }

    private signalFor(menu: EmbeddedMpvMenu) {
        switch (menu) {
            case 'volume':
                return this.volumeOpen;
            case 'audio':
                return this.audioOpen;
            case 'subtitle':
                return this.subtitleOpen;
            case 'speed':
                return this.speedOpen;
            case 'aspect':
                return this.aspectOpen;
        }
    }
}

/**
 * Transient feedback overlay shown when the user adjusts volume/seek/mute via
 * keyboard. Caller calls flash() with an icon + label; auto-clears after the
 * given duration.
 */
export class EmbeddedMpvFeedback {
    readonly current = signal<{
        icon: string;
        label: string;
        key: number;
    } | null>(null);

    private timer: number | null = null;
    private nextKey = 0;

    flash(icon: string, label: string, durationMs = 700): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
        }
        this.nextKey += 1;
        this.current.set({ icon, label, key: this.nextKey });
        this.timer = window.setTimeout(() => {
            this.current.set(null);
            this.timer = null;
        }, durationMs);
    }

    clear(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.current.set(null);
    }

    dispose(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
