import { DestroyRef, inject } from '@angular/core';
import {
    MultiviewAnchorRegistry,
    MultiviewEntryService,
    MultiviewSessionStore,
} from '@iptvnator/playback/multiview/data-access';
import { comesFromInteractiveTarget } from '../player-controls/controls-shortcuts';

export interface MultiviewShortcutDeps {
    readonly entry: Pick<
        MultiviewEntryService,
        'hasPicker' | 'canAdd' | 'pick'
    >;
    readonly store: Pick<
        MultiviewSessionStore,
        'exists' | 'anchorId' | 'activeTileId' | 'swap' | 'setAudio'
    >;
    readonly anchors: Pick<MultiviewAnchorRegistry, 'current' | 'find'>;
}

/** The player surface the keypress would act on, for the ownership rules. */
function playerSurface(deps: MultiviewShortcutDeps): HTMLElement | null {
    if (deps.store.exists()) {
        return deps.anchors.find(deps.store.anchorId())?.element() ?? null;
    }
    return deps.anchors.current()?.player?.() ?? null;
}

/**
 * Multiview keys (spec 5.3): `Shift+M` opens the source picker, `S` swaps
 * the main and PiP tile, `A` gives the active tile the audio. Escape stays
 * the picker's own (it never ends a session) and `Alt+1–4` is phase 2.
 * Returns whether the key was taken.
 *
 * The ownership rules are the player's (`ControlsShortcuts`): not from
 * inputs, dialogs or other controls, not with Ctrl/Cmd/Alt, and not while
 * the player surface is `inert` or marked
 * `data-player-shortcuts-suspended`. Plain `M` (mute) and digits are left
 * alone.
 */
export function handleMultiviewShortcut(
    event: KeyboardEvent,
    deps: MultiviewShortcutDeps
): boolean {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey) return false;
    if (event.altKey || comesFromInteractiveTarget(event)) return false;
    const surface = playerSurface(deps);
    if (!surface?.isConnected) return false;
    if (surface.closest('[inert], [data-player-shortcuts-suspended]')) {
        return false;
    }
    const key = event.key;
    if (event.shiftKey) {
        if (key !== 'M' || !deps.entry.hasPicker || !deps.entry.canAdd()) {
            return false;
        }
        void deps.entry.pick();
        return true;
    }
    if (!deps.store.exists()) return false;
    if (key === 's' || key === 'S') {
        deps.store.swap();
        return true;
    }
    if (key === 'a' || key === 'A') {
        const active = deps.store.activeTileId();
        if (!active) return false;
        deps.store.setAudio(active);
        return true;
    }
    return false;
}

/**
 * Listens for the multiview keys for the caller's life. It listens in the
 * capture phase, so a taken `Shift+M` is marked handled before the player's
 * own `M` (mute) sees it. Must be called in an injection context.
 */
export function installMultiviewShortcuts(): void {
    if (typeof document === 'undefined') return;
    const deps: MultiviewShortcutDeps = {
        entry: inject(MultiviewEntryService),
        store: inject(MultiviewSessionStore),
        anchors: inject(MultiviewAnchorRegistry),
    };
    const listener = (event: KeyboardEvent): void => {
        if (handleMultiviewShortcut(event, deps)) event.preventDefault();
    };
    document.addEventListener('keydown', listener, true);
    inject(DestroyRef).onDestroy(() =>
        document.removeEventListener('keydown', listener, true)
    );
}
