import { inject, Injectable, OnDestroy } from '@angular/core';
import { AppUpdateInstallService } from '../services/app-update-install.service';
import { SettingsForm } from './settings-form.utils';

export interface SettingsUnloadGuardHost {
    /** The shared settings form whose dirty state arms every protection. */
    form: SettingsForm;
    /**
     * The same save/discard/stay flow the router guard runs. Resolves true
     * when leaving is safe — saved or discarded; a failed save resolves
     * false and must cancel the close.
     */
    confirmClose: () => Promise<boolean>;
}

/**
 * Protects unsaved settings edits on the exits the router never sees:
 * closing the window, quitting the app, and reloading the page.
 *
 * Three cooperating layers:
 *
 * - A `beforeunload` handler that engages while the form is dirty. In a
 *   browser (PWA) it triggers the native leave-page prompt — custom UI is
 *   not possible there. In Electron it silently cancels the unload (reloads
 *   only — see below) and follows up with the app's own save/discard/stay
 *   dialog.
 * - In Electron, a main-process close guard (`setWindowCloseGuard`) armed
 *   for the WHOLE settings mount, not per dirty transition — arming on the
 *   first edit would race the very close it protects against, since the
 *   IPC is asynchronous. It intercepts window close / app quit *before*
 *   `beforeunload` fires and pushes the decision back here; a pristine
 *   form auto-confirms without showing anything.
 * - `confirmWindowClose` completes an intercepted close once the user
 *   saved or discarded; staying — or a save that failed — never confirms,
 *   so the window stays open with the edits intact.
 *
 * Provided by `SettingsComponent`, so its `ngOnDestroy` runs when the user
 * leaves the settings area and every hook is released.
 */
@Injectable()
export class SettingsUnloadGuardService implements OnDestroy {
    private readonly installService = inject(AppUpdateInstallService);
    private host: SettingsUnloadGuardHost | null = null;
    private unsubscribeCloseRequests: (() => void) | null = null;
    private unregisterFromInstallService: (() => void) | null = null;
    private confirmationPending = false;
    /**
     * Intent of the confirmation currently on screen. A close request
     * arriving while a reload confirmation is open escalates this to
     * 'close' — the dialog is the same, only the continuation differs, and
     * the user's most recent ask must be the one that completes.
     * An install decision owns competing close/reload requests until settled.
     */
    private activeIntent: 'close' | 'reload' | 'install' | null = null;
    /** True while a Stay's cancelWindowClose acknowledgment is in flight. */
    private cancelling = false;
    /** A close requested during that window, re-asked once the cancel lands. */
    private queuedCloseRequest = false;
    /**
     * Id of the latest intercepted request, cited in cancellations so a
     * cancel arriving after a newer interception cannot wipe its intent.
     */
    private latestCloseRequestId: number | undefined;
    /** Last guard state mirrored to the main process. */
    private guardArmed = false;
    /** True while an updater-driven app quit must pass unchallenged. */
    private suspended = false;

    /** Indirection because `window.location.reload` cannot be stubbed. */
    reloadPage: () => void = () => window.location.reload();

    activate(host: SettingsUnloadGuardHost): void {
        this.dispose();
        this.host = host;

        window.addEventListener('beforeunload', this.beforeUnloadHandler);

        this.unsubscribeCloseRequests =
            window.electron?.onWindowCloseRequested?.((requestId) => {
                this.latestCloseRequestId = requestId;
                if (this.suspended) {
                    this.queuedCloseRequest = true;
                    return;
                }
                void this.handleCloseRequest('close');
            }) ?? null;

        // Whatever surface installs an app update — the settings About
        // section or the app-wide notification panel — must be able to
        // stand this guard down before the updater closes the window.
        this.unregisterFromInstallService =
            this.installService.registerUnloadGuard({
                confirmAppQuit: () => this.handleCloseRequest('install'),
                resumeAfterAbortedAppQuit: () =>
                    this.resumeAfterAbortedAppQuit(),
                suspendForAppQuit: () => this.suspendForAppQuit(),
            });

        // Armed before the user can possibly stage an edit; a close with a
        // pristine form auto-confirms through the dialog-less path, so the
        // only visible effect of mount-long arming is race-free protection.
        this.syncCloseGuard(true);
    }

    ngOnDestroy(): void {
        this.dispose();
    }

    /**
     * Suspends DOM protection for installing a downloaded update. The
     * updater closes the window while the form may still be dirty; a
     * `beforeunload` cancellation at the DOM layer would strand the install
     * (and even morph it into a reload). Main stays armed until install IPC
     * atomically replaces pending closes with the updater's close bypass.
     */
    suspendForAppQuit(): void {
        if (!this.host || this.suspended) {
            return;
        }

        this.suspended = true;
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }

    /** Restores the protection when the requested quit did not happen. */
    resumeAfterAbortedAppQuit(): void {
        if (!this.host || !this.suspended) {
            return;
        }

        this.suspended = false;
        window.addEventListener('beforeunload', this.beforeUnloadHandler);
        if (this.queuedCloseRequest) {
            this.queuedCloseRequest = false;
            void this.handleCloseRequest('close');
        }
    }

    private dispose(): void {
        window.removeEventListener('beforeunload', this.beforeUnloadHandler);
        this.unsubscribeCloseRequests?.();
        this.unsubscribeCloseRequests = null;
        this.unregisterFromInstallService?.();
        this.unregisterFromInstallService = null;
        this.suspended = false;
        this.queuedCloseRequest = false;
        this.syncCloseGuard(false);
        this.host = null;
    }

    private readonly beforeUnloadHandler = (event: BeforeUnloadEvent): void => {
        if (!this.host?.form.dirty) {
            return;
        }

        event.preventDefault();
        // Chromium's legacy trigger for the native prompt; harmless in
        // Electron, where cancellation comes from preventDefault().
        event.returnValue = '';

        if (window.electron) {
            // Electron cancelled the unload without any prompt. Window close
            // never lands here while the guard is armed (the main process
            // intercepts it first), and an updater-driven quit suspends this
            // handler entirely — so this can only be a reload: ask, then
            // re-trigger it.
            setTimeout(() => {
                void this.handleCloseRequest('reload');
            });
        }
    };

    private async handleCloseRequest(
        intent: 'close' | 'reload' | 'install'
    ): Promise<boolean> {
        const host = this.host;

        if (!host) {
            return intent === 'install';
        }

        if (this.confirmationPending) {
            if (this.activeIntent === 'install' && !this.cancelling)
                return false;
            if (intent === 'close') {
                if (this.cancelling) {
                    // The dialog already resolved and Stay's cancellation is
                    // still in flight. This is a fresh user action — queue
                    // it and re-ask once the cancel has landed, so the new
                    // dialog can never answer against the stale intent the
                    // cancel is about to clear.
                    this.queuedCloseRequest = true;
                } else {
                    // A close outranks a reload, never the other way
                    // around: the open dialog stays, but Save/Discard must
                    // complete the close the user just asked for, not the
                    // earlier reload.
                    this.activeIntent = 'close';
                }
            }
            return false;
        }

        this.confirmationPending = true;
        this.activeIntent = intent;
        let reAskClose = false;

        try {
            const proceed = await host.confirmClose();
            // Re-read after the dialog: a cross-intent request may have
            // escalated it while the user was deciding.
            const finalIntent = this.activeIntent ?? intent;

            if (finalIntent === 'install' && proceed) return true;

            if (!proceed) {
                if (
                    finalIntent === 'close' ||
                    (finalIntent === 'install' &&
                        this.latestCloseRequestId !== undefined)
                ) {
                    // Staying must clear the intent the main process
                    // remembered, or a later close attempt would replay a
                    // stale quit — and the clearing must be AWAITED, or a
                    // close racing this cancellation could still consume
                    // the stale intent.
                    this.cancelling = true;

                    try {
                        await window.electron?.cancelWindowClose?.(
                            this.latestCloseRequestId
                        );
                    } finally {
                        this.cancelling = false;
                    }

                    reAskClose = this.queuedCloseRequest;
                    this.queuedCloseRequest = false;
                }
            } else if (finalIntent === 'close') {
                await window.electron?.confirmWindowClose?.();
            } else {
                this.reloadPage();
            }
        } finally {
            this.confirmationPending = false;
            this.activeIntent = null;
        }

        if (reAskClose) {
            void this.handleCloseRequest('close');
        }
        return false;
    }

    private syncCloseGuard(active: boolean): void {
        if (this.guardArmed === active) {
            return;
        }

        this.guardArmed = active;
        void window.electron?.setWindowCloseGuard?.(active);
    }
}
