export interface ControlsShortcutHandlers {
    isAvailable: () => boolean;
    canTogglePaused: () => boolean;
    canSeek: () => boolean;
    canAdjustVolume: () => boolean;
    canToggleFullscreen: () => boolean;
    onEscape: () => void;
    togglePaused: () => void;
    toggleFullscreen: () => void;
    seekBy: (deltaSeconds: number) => void;
    adjustVolume: (delta: number) => void;
    toggleMute: () => void;
}

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
    '[role="link"]',
    '[role="listbox"]',
    '[role^="menuitem"]',
    '[role="option"]',
    '[role="radio"]',
    '[role="slider"]',
    '[role="switch"]',
    '[role="textbox"]',
].join(',');

export class ControlsShortcuts {
    private static readonly instances = new Set<ControlsShortcuts>();
    private static active: ControlsShortcuts | null = null;

    private handlers: ControlsShortcutHandlers | null = null;
    private readonly listener = (event: KeyboardEvent) => this.handle(event);

    attach(handlers: ControlsShortcutHandlers): void {
        this.handlers = handlers;
        ControlsShortcuts.instances.add(this);
        ControlsShortcuts.active ??= this;
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.listener);
        }
    }

    activate(): void {
        if (this.handlers) {
            ControlsShortcuts.active = this;
        }
    }

    detach(): void {
        if (typeof document !== 'undefined') {
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

        if (event.key === 'Escape') {
            handlers.onEscape();
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
     * and ignore events originating from an interactive control anywhere in
     * the composed path. Escape is handled before this check so it can still
     * close controls popovers while a modifier key is held.
     */
    private shouldIgnore(event: KeyboardEvent): boolean {
        if (event.metaKey || event.ctrlKey || event.altKey) {
            return true;
        }

        const path =
            typeof event.composedPath === 'function'
                ? event.composedPath()
                : [];
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
