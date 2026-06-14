import { inject, Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

@Injectable()
export class SettingsSnackbarService {
    private readonly snackBar = inject(MatSnackBar);

    open(message: string, config: MatSnackBarConfig = {}): void {
        this.snackBar.open(message, undefined, {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
            panelClass: ['settings-snackbar'],
            ...config,
        });
    }
}
