import { computed, inject, Injectable, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ParentalLockService } from '@iptvnator/services';
import {
    PARENTAL_LOCK_RELOCK_MINUTES_OPTIONS,
    ParentalLockRelockMinutes,
} from '@iptvnator/shared/interfaces';
import { SettingsSnackbarService } from './settings-snackbar.service';

/**
 * Settings → Parental lock. Every control here applies immediately: the
 * enable toggle and the PIN actions gate on the PIN dialog, so staging them
 * in the shared dirty form (Save/Discard) would make no sense — a
 * "discarded" PIN would already have been typed.
 */
@Injectable()
export class SettingsParentalLockFacade {
    private readonly parentalLock = inject(ParentalLockService);
    private readonly snackbar = inject(SettingsSnackbarService);
    private readonly translate = inject(TranslateService);

    readonly enabled = this.parentalLock.enabled;
    readonly unlocked = this.parentalLock.unlocked;
    readonly hasPin = this.parentalLock.hasPin;
    readonly relockMinutes = this.parentalLock.relockMinutes;
    readonly relockOptions = PARENTAL_LOCK_RELOCK_MINUTES_OPTIONS;
    readonly busy = signal(false);
    readonly canLockNow = computed(() => this.enabled() && this.unlocked());

    constructor() {
        void this.parentalLock.initialize();
    }

    async toggleEnabled(enabled: boolean): Promise<void> {
        await this.run(async () => {
            if (enabled) {
                if (await this.parentalLock.setupPin()) {
                    this.notify('SETTINGS.PARENTAL_LOCK.ENABLED_TOAST');
                }
                return;
            }
            if (await this.parentalLock.disable()) {
                this.notify('SETTINGS.PARENTAL_LOCK.DISABLED_TOAST');
            }
        });
    }

    async changePin(): Promise<void> {
        await this.run(async () => {
            if (await this.parentalLock.changePin()) {
                this.notify('SETTINGS.PARENTAL_LOCK.PIN_CHANGED_TOAST');
            }
        });
    }

    async setRelockMinutes(minutes: ParentalLockRelockMinutes): Promise<void> {
        await this.run(() => this.parentalLock.setRelockMinutes(minutes));
    }

    lockNow(): void {
        this.parentalLock.lock();
        this.notify('SETTINGS.PARENTAL_LOCK.LOCKED_TOAST');
    }

    async unlock(): Promise<void> {
        await this.run(async () => {
            await this.parentalLock.requestUnlock();
        });
    }

    private notify(key: string): void {
        this.snackbar.open(this.translate.instant(key));
    }

    private async run(action: () => Promise<unknown>): Promise<void> {
        if (this.busy()) {
            return;
        }
        this.busy.set(true);
        try {
            await action();
        } finally {
            this.busy.set(false);
        }
    }
}
