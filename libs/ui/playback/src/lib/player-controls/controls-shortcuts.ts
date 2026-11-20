import {
    PLAYER_SUSPENDED_ATTRIBUTE,
    watchPlayerSuspension,
} from './controls-suspension';

export interface ControlsShortcutHandlers {
    isAvailable: () => boolean;
    /**
     * The player's host element, used to opt out of global shortcuts while
     * an ancestor is `inert` (e.g. behind the workspace's phone context
     * drawer) or marked `data-player-shortcuts-suspended` (a host surface
     * that owns the keyboard itself, such as the programme guide with the
     * player docked): both strip the player of keyboard ownership, but
     * document-level keydown listeners still fire, so shortcuts must check
     * it themselves.
     */
    hostElement?: () => HTMLElement | null;
    canTogglePaused: () => boolean;
    canSeek: () => boolean;
    canAdjustVolume: () => boolean;
    canToggleFullscreen: () => boolean;
    /**
     * Escape, before any other check. Return true when it closed something
     * (a popover, the Up next card) so the key goes no further.
     */
    onEscape: () => boolean | void;
    captureInlineEscape?: boolean;
    togglePaused: () => void;
    toggleFullscreen: () => void;
    seekBy: (deltaSeconds: number) => void;
    adjustVolume: (delta: number) => void;
    toggleMute: () => void;
}

export const PLAYER_SHORTCUTS_SUSPENDED_SELECTOR = `[inert], [${PLAYER_SUSPENDED_ATTRIBUTE}]`;

const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'summary',
    'textarea',
    '[contenteditable]:not([contenteditable="false"])',
    '[role="button"]',
    '[role="checkbox"]',
    '[role="combobox"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="link"]',
    '[role="listbox"]',
    '[role^="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="slider"]',
    '[role="switch"]',
    '[role="textbox"]',
].join(',');

export function targetsInteractivePlayerControl(event: KeyboardEvent): boolean {
    const path =
        typeof event.composedPath === 'function' ? event.composedPath() : [];
    const nodes = path.length > 0 ? path : [event.target];
    return nodes.some((node) => {
        const element = node as HTMLElement | null;
        if (!element || typeof element.tagName !== 'string') {
            return false;
        }
        if (
            typeof element.matches === 'function' &&
            element.matches(INTERACTIVE_SELECTOR)
        ) {
            return true;
        }
        return element.isContentEditable === true;
    });
}

export class ControlsShortcuts {
    private static readonly instances = new Set<ControlsShortcuts>();
    private static active: ControlsShortcuts | null = null;

    private handlers: ControlsShortcutHandlers | null = null;
    private stopSuspensionWatch: (() => void) | null = null;
    private readonly listener = (event: KeyboardEvent) => this.handle(event);

    // The inline detail shell sees a bubbling Escape before document listeners.
    private readonly inlineEscapeListener = (event: KeyboardEvent) => {
        if (
            event.key !== 'Escape' ||
            event.defaultPrevented ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            document.fullscreenElement ||
            !this.handlers?.captureInlineEscape
        )
            return;
        const host = this.handlers.hostElement?.();
        if (
            !host?.closest('app-portal-detail-shell') ||
            ControlsShortcuts.resolvePlaybackOwner() !== this
        )
            return;
        const target = event.target;
        if (
            target instanceof HTMLElement &&
            (target.isContentEditable ||
                target.closest('input, textarea, select'))
        )
            return;

        const overlays = document.querySelectorAll<HTMLElement>(
            '.cdk-overlay-backdrop, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'
        );
        if (
            Array.from(overlays).some(
                (overlay) =>
                    !host.contains(overlay) &&
                    !overlay.closest(
                        '[hidden], [inert], [aria-hidden="true"]'
                    ) &&
                    overlay.checkVisibility?.({ checkVisibilityCSS: true }) !==
                        false
            )
        )
            return;
        this.handle(event);
    };

    attach(handlers: ControlsShortcutHandlers): void {
        this.handlers = handlers;
        // Being suspended acts like Escape for the popovers: the surface
        // that takes over (the docked guide) owns the chrome, and a settings
        // sheet left open would keep the bar inert under hidden controls.
        this.stopSuspensionWatch?.();
        const host = handlers.hostElement?.();
        this.stopSuspensionWatch = host
            ? watchPlayerSuspension(host, () => handlers.onEscape())
            : null;
        ControlsShortcuts.instances.add(this);
        ControlsShortcuts.active ??= this;
        if (typeof document !== 'undefined') {
            document.addEventListener(
                'keydown',
                this.inlineEscapeListener,
                true
            );
            document.addEventListener('keydown', this.listener);
        }
    }

    activate(): void {
        if (this.handlers) {
            ControlsShortcuts.active = this;
        }
    }

    detach(): void {
        this.stopSuspensionWatch?.();
        this.stopSuspensionWatch = null;
        if (typeof document !== 'undefined') {
            document.removeEventListener(
                'keydown',
                this.inlineEscapeListener,
                true
            );
            document.removeEventListener('keydown', this.listener);
        }
        this.handlers = null;
        ControlsShortcuts.instances.delete(this);
        if (ControlsShortcuts.active === this) {
            ControlsShortcuts.active = ControlsShortcuts.lastAttachedInstance();
        }
    }

    private handle(event: KeyboardEvent): void {
        const handlers = this.handlers;
        if (!handlers) {
            return;
        }

        // If another mounted controls instance already handled this keypress
        // (it calls preventDefault below), don't double-execute it here.
        if (event.defaultPrevented) {
            return;
        }

        // A player inside an inert region is outside the interaction model
        // entirely — a modal surface above it owns the keyboard. The same
        // applies to a host surface that marks its player container
        // `data-player-shortcuts-suspended` (the programme guide docks the
        // player but keeps the arrows, Space and F for itself). This also
        // covers Escape: the surface above decides what Escape means, not
        // the player it obscures or demotes.
        if (
            handlers
                .hostElement?.()
                ?.closest(PLAYER_SHORTCUTS_SUSPENDED_SELECTOR)
        ) {
            return;
        }

        if (event.key === 'Escape') {
            if (handlers.onEscape() === true) {
                event.preventDefault();
            }
            return;
        }

        if (
            this.shouldIgnore(event) ||
            ControlsShortcuts.resolvePlaybackOwner() !== this
        ) {
            return;
        }

        switch (event.key) {
            case ' ':
            case 'k':
            case 'K':
                if (!handlers.canTogglePaused()) {
                    return;
                }
                event.preventDefault();
                handlers.togglePaused();
                return;
            case 'f':
            case 'F':
                if (!handlers.canToggleFullscreen()) {
                    return;
                }
                event.preventDefault();
                handlers.toggleFullscreen();
                return;
            case 'ArrowLeft':
                if (!handlers.canSeek()) {
                    return;
                }
                event.preventDefault();
                handlers.seekBy(-5);
                return;
            case 'ArrowRight':
                if (!handlers.canSeek()) {
                    return;
                }
                event.preventDefault();
                handlers.seekBy(5);
                return;
            case 'ArrowUp':
                if (!handlers.canAdjustVolume()) {
                    return;
                }
                event.preventDefault();
                handlers.adjustVolume(0.05);
                return;
            case 'ArrowDown':
                if (!handlers.canAdjustVolume()) {
                    return;
                }
                event.preventDefault();
                handlers.adjustVolume(-0.05);
                return;
            case 'm':
            case 'M':
                if (!handlers.canAdjustVolume()) {
                    return;
                }
                event.preventDefault();
                handlers.toggleMute();
                return;
        }
    }

    /**
     * Ignore modified playback keys so app/native shortcuts retain ownership,
     * and ignore events originating from a dialog or interactive control
     * anywhere in the composed path. Escape is handled before this check so
     * it can still close controls popovers while a modifier key is held.
     */
    private shouldIgnore(event: KeyboardEvent): boolean {
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return true;
        }

        return targetsInteractivePlayerControl(event);
    }

    private static resolvePlaybackOwner(): ControlsShortcuts | null {
        if (this.active?.handlers?.isAvailable()) {
            return this.active;
        }

        let fallback: ControlsShortcuts | null = null;
        for (const instance of this.instances) {
            if (instance.handlers?.isAvailable()) {
                fallback = instance;
            }
        }
        this.active = fallback;
        return fallback;
    }

    private static lastAttachedInstance(): ControlsShortcuts | null {
        let last: ControlsShortcuts | null = null;
        for (const instance of this.instances) {
            last = instance;
        }
        return last;
    }
}
