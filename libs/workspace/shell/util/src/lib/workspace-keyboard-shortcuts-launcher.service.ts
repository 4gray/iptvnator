import { computed, Injectable, signal } from '@angular/core';

/**
 * Opens the keyboard shortcuts dialog from outside the workspace shell's
 * element injector. The dialog belongs to the shell (it registers here while
 * it is alive), but entry points such as the Settings page live in the app
 * and must not import the shell feature to reach it.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceKeyboardShortcutsLauncherService {
    private readonly opener = signal<(() => void) | null>(null);

    /** Whether a shell is alive to show the dialog. */
    readonly available = computed(() => this.opener() !== null);

    /**
     * Registers the dialog opener; returns the matching unregister call, which
     * only clears its own registration.
     */
    register(open: () => void): () => void {
        this.opener.set(open);
        return () => {
            if (this.opener() === open) {
                this.opener.set(null);
            }
        };
    }

    open(): void {
        this.opener()?.();
    }
}
