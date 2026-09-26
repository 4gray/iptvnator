import { inject, Injectable, InjectionToken } from '@angular/core';

/**
 * Arms the startup gate. Only the application shell provides `true`; any
 * other injector (unit tests, embedded hosts) sees an open gate, so deferred
 * work runs immediately there, exactly as before the gate existed.
 */
export const STARTUP_WORK_DEFERRAL = new InjectionToken<boolean>(
    'STARTUP_WORK_DEFERRAL'
);

/**
 * Opens the gate even if the first content never renders (a failed source
 * read, a route error), so deferred background work is late, never lost.
 */
export const STARTUP_DEFERRAL_SAFETY_TIMEOUT_MS = 5000;

/**
 * Holds startup work that the first rendered screen does not need until
 * that screen has rendered (performance journey J1). The gate opens one task
 * after the render in which the startup status completed, so work released
 * by it can never be issued in the same task as the first card.
 */
@Injectable({ providedIn: 'root' })
export class StartupDeferralService {
    private readonly enabled =
        inject(STARTUP_WORK_DEFERRAL, { optional: true }) === true &&
        !isStartupDeferralDisabled();
    private open = false;
    private openGate!: () => void;
    private readonly gate = new Promise<void>((resolve) => {
        this.openGate = resolve;
    });

    constructor() {
        if (!this.enabled) {
            this.release();
            return;
        }
        setTimeout(() => this.release(), STARTUP_DEFERRAL_SAFETY_TIMEOUT_MS);
    }

    /** Resolves once the first routed content has rendered. */
    whenFirstContentRendered(): Promise<void> {
        return this.gate;
    }

    /** Called after the render in which the startup status completed. */
    markFirstContentRendered(): void {
        if (!this.open) {
            setTimeout(() => this.release(), 0);
        }
    }

    private release(): void {
        if (this.open) return;
        this.open = true;
        this.openGate();
    }
}

/** `IPTVNATOR_DISABLE_STARTUP_DEFERRAL=1`, read by the Electron preload. */
function isStartupDeferralDisabled(): boolean {
    return (
        typeof window !== 'undefined' &&
        window.electron?.startupDeferralDisabled === true
    );
}
