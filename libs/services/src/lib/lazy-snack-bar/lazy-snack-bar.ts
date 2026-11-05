import { EnvironmentInjector, inject, Injectable } from '@angular/core';
import type {
    MatSnackBar,
    MatSnackBarConfig,
    MatSnackBarRef,
    TextOnlySnackBar,
} from '@angular/material/snack-bar';

type SnackBarModule = typeof import('@angular/material/snack-bar');

/**
 * Resolves the root `MatSnackBar` on first use. `@angular/material/snack-bar`
 * statically imports Material's button, the icon button chunk and the CDK
 * overlay, so one static import from a service created with the app puts
 * all of them on the initial path although a toast shows only after an
 * event. Services and components that exist at startup open their toasts
 * through this helper; a component in a lazy chunk can inject `MatSnackBar`
 * directly.
 */
@Injectable({ providedIn: 'root' })
export class LazySnackBar {
    private readonly injector = inject(EnvironmentInjector);
    private snackBar: Promise<MatSnackBar> | null = null;

    /** The dynamic import; a field so specs can substitute it. */
    loadSnackBarModule: () => Promise<SnackBarModule> = () =>
        import('@angular/material/snack-bar');

    resolve(): Promise<MatSnackBar> {
        this.snackBar ??= this.loadSnackBarModule().then((module) =>
            this.injector.get(module.MatSnackBar)
        );
        // A failed chunk load must not poison later attempts.
        this.snackBar.catch(() => (this.snackBar = null));
        return this.snackBar;
    }

    /**
     * Opens a text snack-bar with `MatSnackBar.open`'s arguments once the
     * chunk is loaded. The promise settles with the snack-bar's ref, or with
     * `null` after a failed chunk load, which is logged; the message is not,
     * as it can carry a playlist URL.
     */
    async open(
        message: string,
        action?: string,
        config?: MatSnackBarConfig
    ): Promise<MatSnackBarRef<TextOnlySnackBar> | null> {
        let snackBar: MatSnackBar;
        try {
            snackBar = await this.resolve();
        } catch (error) {
            console.error('Could not open the snack-bar:', error);
            return null;
        }
        return snackBar.open(message, action, config);
    }
}
