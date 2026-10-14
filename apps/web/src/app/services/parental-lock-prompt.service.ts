import { inject, Injectable, Provider } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPrompt,
    ParentalLockPromptRequest,
} from '@iptvnator/services';
import { LazyMatDialog } from '@iptvnator/ui/components/lazy-dialog';

/**
 * Application implementation of the parental lock prompt: the shared PIN
 * dialog from `@iptvnator/ui/components`, which the data-access lock
 * service cannot import itself. The dialog, and Material's dialog service
 * with it, is loaded on first use (the service is constructed at startup,
 * the dialog is not needed until a PIN is asked for).
 */
@Injectable({ providedIn: 'root' })
export class AppParentalLockPromptService implements ParentalLockPrompt {
    private readonly lazyDialog = inject(LazyMatDialog);

    /** The dynamic import; a field so specs can substitute it. */
    loadPinDialog = () => import('./parental-lock-pin-dialog.lazy');

    async requestPin(
        request: ParentalLockPromptRequest
    ): Promise<string | null> {
        let module: Awaited<ReturnType<typeof this.loadPinDialog>>;
        let dialog: Awaited<ReturnType<LazyMatDialog['resolve']>>;
        try {
            [dialog, module] = await Promise.all([
                this.lazyDialog.resolve(),
                this.loadPinDialog(),
            ]);
        } catch (error) {
            // A failed chunk load reads as a cancelled prompt: the gate it
            // guards stays closed.
            console.error(
                'The parental lock PIN dialog could not be loaded.',
                error
            );
            return null;
        }
        const dialogRef = module.ParentalLockPinDialogComponent.open(dialog, {
            mode: request.mode,
            verify: request.verify,
            throttle: request.throttle,
            titleKey: request.titleKey,
            descriptionKey: request.descriptionKey,
            submitKey: request.submitKey,
        });
        const pin = await firstValueFrom(dialogRef.afterClosed());
        return typeof pin === 'string' ? pin : null;
    }
}

export function provideParentalLockPrompt(): Provider[] {
    return [
        AppParentalLockPromptService,
        {
            provide: PARENTAL_LOCK_PROMPT,
            useExisting: AppParentalLockPromptService,
        },
    ];
}
