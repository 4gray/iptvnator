import { DestroyRef, inject, Injector } from '@angular/core';
import { Router } from '@angular/router';

/** Attach immediately; update handling is only loaded when requested. */
export function startAppMenuActions(): void {
    const router = inject(Router);
    const injector = inject(Injector);
    const lifetime = inject(DestroyRef);
    const unsubscribe = window.electron?.onAppMenuAction?.(async (action) => {
        if (lifetime.destroyed) return;
        if (action === 'settings') {
            await router.navigateByUrl('/workspace/settings');
        } else {
            const { AppMaintenanceService } =
                await import('./app-maintenance.service');
            if (!lifetime.destroyed) {
                await injector.get(AppMaintenanceService).checkForUpdates();
            }
        }
    });
    if (unsubscribe) lifetime.onDestroy(unsubscribe);
}
