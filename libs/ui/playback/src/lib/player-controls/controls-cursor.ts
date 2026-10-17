import { Signal, effect } from '@angular/core';

/**
 * Hides the pointer over the player surface while the controls are idle,
 * and gives the surface back the cursor it had before — unless something
 * else replaced the `none` in the meantime. Must run in an injection
 * context (a component constructor).
 */
export function bindSurfaceCursor(
    surface: Signal<HTMLElement | null>,
    hide: Signal<boolean>
): void {
    effect((onCleanup) => {
        const element = surface();
        if (!element || !hide()) {
            return;
        }
        const previousCursor = element.style.cursor;
        element.style.cursor = 'none';
        onCleanup(() => {
            if (element.style.cursor === 'none') {
                element.style.cursor = previousCursor;
            }
        });
    });
}
