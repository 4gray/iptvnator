import { signal } from '@angular/core';

/**
 * Owns the fullscreen lifecycle for a player surface: tracks the current
 * fullscreen state, listens for `fullscreenchange`, and toggles fullscreen on
 * the target element. The component keeps the capability gating and the
 * label/icon derivation; this helper only deals with the browser API.
 */
export class ControlsFullscreen {
    readonly isFullscreen = signal(false);

    private readonly onFullscreenChange = () => {
        this.sync();
        this.onChange?.();
    };

    constructor(
        private readonly target: () => HTMLElement | null,
        private readonly onChange?: () => void
    ) {
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }
    }

    sync(): void {
        const target = this.target();
        this.isFullscreen.set(
            Boolean(
                target &&
                typeof document !== 'undefined' &&
                document.fullscreenElement === target
            )
        );
    }

    canFullscreen(): boolean {
        const target = this.target();
        return (
            typeof document !== 'undefined' &&
            Boolean(target?.requestFullscreen) &&
            Boolean(document.exitFullscreen)
        );
    }

    async toggle(): Promise<void> {
        const target = this.target();
        if (!target || !this.canFullscreen()) {
            return;
        }
        try {
            if (document.fullscreenElement === target) {
                await document.exitFullscreen();
            } else {
                await target.requestFullscreen();
            }
        } catch {
            return;
        }
    }

    dispose(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'fullscreenchange',
                this.onFullscreenChange
            );
        }
    }
}
