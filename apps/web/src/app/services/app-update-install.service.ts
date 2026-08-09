import { Injectable } from '@angular/core';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';

/** What an unload guard must offer to survive an updater-driven quit. */
export interface AppQuitUnloadGuardHooks {
    suspendForAppQuit(): void;
    resumeAfterAbortedAppQuit(): void;
}

/**
 * The one place that installs a downloaded update without the
 * unsaved-settings unload guard fighting the quit. Every install entry
 * point — the settings About section and the app-wide update notification
 * panel — must go through it: installing quits the app and closes the
 * window while the settings form may be dirty, and only a root service can
 * reach the settings-scoped unload guard from both.
 *
 * The choreography: suspend every registered guard, invoke the updater,
 * and restore the protection whenever the promised quit provably did not
 * happen — a non-'downloaded' reply, a rejected IPC, or a later
 * error-status push (electron-updater reports install failures that way
 * rather than throwing). `installQuitPending` is armed before the IPC
 * round trip because the ordering between the reply and status pushes is
 * not guaranteed; the 'downloaded' reply never re-arms it, so a failure
 * push that wins the race cannot be undone by the stale reply.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateInstallService {
    private readonly guards = new Set<AppQuitUnloadGuardHooks>();
    private installQuitPending = false;

    constructor() {
        // App-lifetime subscription on purpose: the failure push can arrive
        // after the UI that requested the install is gone. Only an Error
        // push aborts — that is how electron-updater reports an install
        // failure. Benign pushes (e.g. a 'checking' from an update-check
        // clicked while the quit is still winding up) prove nothing about
        // the quit and must not resurrect the beforeunload handler mid-
        // install.
        window.electron?.onAppUpdateStatusChange?.((status) => {
            if (
                this.installQuitPending &&
                status.status === ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error
            ) {
                this.abortInstallQuit();
            }
        });
    }

    /**
     * The settings unload guard registers itself while settings is open.
     * @returns the matching unregister
     */
    registerUnloadGuard(hooks: AppQuitUnloadGuardHooks): () => void {
        this.guards.add(hooks);
        return () => this.guards.delete(hooks);
    }

    /**
     * @returns the updater's reply, or null when the bridge is unavailable
     */
    async installAppUpdate(): Promise<ElectronBridgeAppUpdateStatus | null> {
        if (!window.electron?.installAppUpdate) {
            return null;
        }

        this.guards.forEach((guard) => guard.suspendForAppQuit());
        this.installQuitPending = true;

        try {
            const status = await window.electron.installAppUpdate();

            if (
                status?.status !==
                ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded
            ) {
                this.abortInstallQuit();
            }

            return status;
        } catch (error) {
            this.abortInstallQuit();
            throw error;
        }
    }

    /** The promised quit is not happening: restore the unload protection. */
    private abortInstallQuit(): void {
        this.installQuitPending = false;
        this.guards.forEach((guard) => guard.resumeAfterAbortedAppQuit());
    }
}
