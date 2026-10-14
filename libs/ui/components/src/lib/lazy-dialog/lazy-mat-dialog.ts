import { EnvironmentInjector, inject, Injectable } from '@angular/core';
import type { MatDialog } from '@angular/material/dialog';

type DialogModule = typeof import('@angular/material/dialog');

/**
 * Resolves the root `MatDialog` on first use. `@angular/material/dialog`
 * and `@angular/cdk/dialog` share one bundler chunk, and one static import
 * from a service created with the app puts both on the initial path although
 * a dialog opens only after a user action. Services that exist at startup
 * resolve the dialog through this helper; a component in a lazy chunk can
 * inject `MatDialog` directly.
 */
@Injectable({ providedIn: 'root' })
export class LazyMatDialog {
    private readonly injector = inject(EnvironmentInjector);
    private dialog: Promise<MatDialog> | null = null;

    /** The dynamic import; a field so specs can substitute it. */
    loadDialogModule: () => Promise<DialogModule> = () =>
        import('@angular/material/dialog');

    resolve(): Promise<MatDialog> {
        this.dialog ??= this.loadDialogModule().then((module) =>
            this.injector.get(module.MatDialog)
        );
        // A failed chunk load must not poison later attempts.
        this.dialog.catch(() => (this.dialog = null));
        return this.dialog;
    }
}
