import { inject, Injectable } from '@angular/core';
import { SettingsStorageFailure } from '@iptvnator/services';
import { NotificationService } from '@iptvnator/services/notifications';

/** Settings toasts: the shared notifications, lifted above the save bar. */
@Injectable()
export class SettingsSnackbarService {
    private readonly notifications = inject(NotificationService);

    success(key: string): void {
        this.notifications.success(key, undefined, { aboveSaveBar: true });
    }

    /** A dismissible error with Close; it stays for the default duration. */
    error(key: string): void {
        this.notifications.error(key, undefined, { aboveSaveBar: true });
    }

    tmdbKeySaved(): void {
        this.success('SETTINGS.TMDB_TRANSFER.SAVED');
    }

    runtimeUpdateFailure(messageKey: string): void {
        this.error(messageKey);
    }

    /**
     * Reports a failed settings read/write. Both mean the same thing to the
     * user — what is on screen will not survive a restart — so they get a
     * dismissible warning instead of the silent fallback to defaults.
     */
    storageFailure(failure: SettingsStorageFailure): void {
        this.error(
            failure === 'save'
                ? 'SETTINGS.SETTINGS_SAVE_FAILED'
                : 'SETTINGS.SETTINGS_LOAD_FAILED'
        );
    }
}
