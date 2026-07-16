export interface ControlsShortcutHandlers {
    isAvailable: () => boolean;
    onEscape: () => void;
    togglePaused: () => void;
    toggleFullscreen: () => void;
    seekBy: (deltaSeconds: number) => void;
    adjustVolume: (delta: number) => void;
    toggleMute: () => void;
}

export class ControlsShortcuts {
    private handlers: ControlsShortcutHandlers | null = null;
    private readonly listener = (event: KeyboardEvent) => this.handle(event);

    attach(handlers: ControlsShortcutHandlers): void {
        this.handlers = handlers;
        if (typeof document !== 'undefined') {
            document.addEventListener('keydown', this.listener);
        }
    }

    detach(): void {
        if (typeof document !== 'undefined') {
            document.removeEventListener('keydown', this.listener);
        }
        this.handlers = null;
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

        if (this.shouldIgnore(event) || !handlers.isAvailable()) {
            return;
        }

        switch (event.key) {
            case ' ':
            case 'k':
            case 'K':
                event.preventDefault();
                handlers.togglePaused();
                return;
            case 'f':
            case 'F':
                event.preventDefault();
                handlers.toggleFullscreen();
                return;
            case 'ArrowLeft':
                event.preventDefault();
                handlers.seekBy(-5);
                return;
            case 'ArrowRight':
                event.preventDefault();
                handlers.seekBy(5);
                return;
            case 'ArrowUp':
                event.preventDefault();
                handlers.adjustVolume(0.05);
                return;
            case 'ArrowDown':
                event.preventDefault();
                handlers.adjustVolume(-0.05);
                return;
            case 'm':
            case 'M':
                event.preventDefault();
                handlers.toggleMute();
                return;
        }
    }

    /**
     * Ignore modified playback keys so app/native shortcuts retain ownership,
     * and ignore events originating from a text-entry control anywhere in the
     * composed path. Escape is handled before this check so it can still close
     * controls popovers while a modifier key is held.
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
            const tag = element.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                return true;
            }
            return element.isContentEditable === true;
        });
    }
}
