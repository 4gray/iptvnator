import { computed, signal } from '@angular/core';

export type ControlsMenu = 'volume' | 'audio' | 'subtitle' | 'speed' | 'aspect';

/**
 * Tracks which menu/popover is currently open and exposes individual signals
 * the template binds to. Only one menu can be open at a time.
 */
export class ControlsMenuState {
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

    toggle(menu: ControlsMenu): void {
        const target = this.signalFor(menu);
        const next = !target();
        this.closeAll();
        target.set(next);
    }

    open(menu: ControlsMenu): void {
        if (this.signalFor(menu)()) {
            return;
        }
        this.closeAll();
        this.signalFor(menu).set(true);
    }

    close(menu: ControlsMenu): void {
        this.signalFor(menu).set(false);
    }

    closeAll(): void {
        this.volumeOpen.set(false);
        this.audioOpen.set(false);
        this.subtitleOpen.set(false);
        this.speedOpen.set(false);
        this.aspectOpen.set(false);
    }

    private signalFor(menu: ControlsMenu) {
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
