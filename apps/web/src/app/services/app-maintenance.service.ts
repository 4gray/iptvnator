import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

/** Maintenance stays reachable even when loading the source inventory fails. */
@Injectable({ providedIn: 'root' })
export class AppMaintenanceService {
    private readonly router = inject(Router);

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
        const about = '/workspace/settings/about';
        if (
            this.router.url === about ||
            (await this.router.navigateByUrl(about))
        ) {
            const status = await window.electron.getAppUpdateStatus();
            if (
                status.status === 'downloading' ||
                status.status === 'downloaded'
            )
                return;
            await window.electron.checkForAppUpdate();
        }
    }
}
