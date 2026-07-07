import { Signal, computed } from '@angular/core';
import type { ControlsFullscreen } from './controls-fullscreen';
import type { PlayerFullscreenController } from './player-controls.model';

/**
 * Resolves the fullscreen affordance for the controls component. When a host
 * supplies a {@link PlayerFullscreenController} delegate (e.g. the embedded-MPV
 * player's instant CSS + window fullscreen), it takes precedence; otherwise the
 * built-in DOM {@link ControlsFullscreen} helper is used (web/PWA players).
 *
 * Keeping this here keeps the component lean and lets the delegate vs. built-in
 * branching live in one tested place.
 */
export function createFullscreenBinding(deps: {
    delegate: Signal<PlayerFullscreenController | null>;
    builtIn: ControlsFullscreen;
}) {
    const { delegate, builtIn } = deps;

    const isFullscreen = computed(() => {
        const controller = delegate();
        return controller ? controller.isFullscreen() : builtIn.isFullscreen();
    });

    const canToggle = () => {
        const controller = delegate();
        return controller ? controller.canToggle() : builtIn.canFullscreen();
    };

    const toggle = async (): Promise<void> => {
        const controller = delegate();
        if (controller) {
            controller.toggle();
            return;
        }
        await builtIn.toggle();
    };

    return { isFullscreen, canToggle, toggle };
}
