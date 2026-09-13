import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import {
    PARENTAL_LOCK_PROMPT,
    ParentalLockPrompt,
    ParentalLockPromptRequest,
} from '@iptvnator/services';
import { ParentalLockPinDialogComponent } from '@iptvnator/ui/components';

/**
 * Application implementation of the parental lock prompt: the shared PIN
 * dialog from `@iptvnator/ui/components`, which the data-access lock
 * service cannot import itself.
 */
@Injectable({ providedIn: 'root' })
export class AppParentalLockPromptService implements ParentalLockPrompt {
    private readonly dialog = inject(MatDialog);

    async requestPin(
        request: ParentalLockPromptRequest
    ): Promise<string | null> {
        const dialogRef = ParentalLockPinDialogComponent.open(this.dialog, {
            mode: request.mode,
            verify: request.verify,
            titleKey: request.titleKey,
            descriptionKey: request.descriptionKey,
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
