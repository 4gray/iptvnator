import { DestroyRef, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

/** Maintenance stays reachable even when loading the source inventory fails. */
@Injectable({ providedIn: 'root' })
export class AppMaintenanceService {
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);

    start(): void {
        const unsubscribe = window.electron?.onAppMenuAction?.((action) => {
            if (action === 'settings') void this.openSettings();
            if (action === 'check-for-updates') void this.checkForUpdates();
        });
        if (unsubscribe) this.destroyRef.onDestroy(unsubscribe);
    }

    get canCheckForUpdates(): boolean {
        return (
            typeof window.electron?.checkForAppUpdate === 'function' &&
            typeof window.electron?.getAppUpdateStatus === 'function'
        );
    }

    openSettings(): Promise<boolean> {
        return this.router.navigateByUrl('/workspace/settings');
    }

    async checkForUpdates(): Promise<void> {
        if (!this.canCheckForUpdates) return;
        // About already renders every updater state, including errors and
        // "no updates". Navigate through the router to retain dirty-form guards.
        if (await this.router.navigateByUrl('/workspace/settings/about')) {
            await window.electron.checkForAppUpdate();
        }
    }
}
