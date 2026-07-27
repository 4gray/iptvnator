import { inject, Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { SettingsStorageFailure } from '@iptvnator/services';
import { TranslateService } from '@ngx-translate/core';

@Injectable()
export class SettingsSnackbarService {
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);

    open(message: string, config: MatSnackBarConfig = {}): void {
        this.snackBar.open(message, undefined, {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['settings-snackbar'],
            ...config,
        });
    }

    /**
     * Failures need more reading time than the 2s confirmation toast, and a
     * dismiss action so the message can stay up until it is acknowledged.
     */
    error(message: string, dismissLabel: string): void {
        this.snackBar.open(message, dismissLabel, {
            duration: 10000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['settings-snackbar', 'settings-snackbar--error'],
        });
    }

    /**
     * Reports a failed settings read/write. Both mean the same thing to the
     * user — what is on screen will not survive a restart — so they get a
     * dismissible warning instead of the silent fallback to defaults.
     */
    storageFailure(failure: SettingsStorageFailure): void {
        this.error(
            this.translate.instant(
                failure === 'save'
                    ? 'SETTINGS.SETTINGS_SAVE_FAILED'
                    : 'SETTINGS.SETTINGS_LOAD_FAILED'
            ),
            this.translate.instant('CLOSE')
        );
    }
}
