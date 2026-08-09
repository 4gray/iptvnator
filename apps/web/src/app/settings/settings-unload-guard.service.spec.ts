import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { AppUpdateInstallService } from '../services/app-update-install.service';
import { SettingsForm } from './settings-form.utils';
import {
    SettingsUnloadGuardHost,
    SettingsUnloadGuardService,
} from './settings-unload-guard.service';

/**
 * Regression coverage for the non-router exits from settings: window close /
 * app quit (Electron main-process interception) and page reload
 * (`beforeunload`). The router-navigation path is covered by
 * `settings-unsaved-changes.guard.spec.ts`.
 */
describe('SettingsUnloadGuardService', () => {
    let service: SettingsUnloadGuardService;
    let form: SettingsForm;
    let host: SettingsUnloadGuardHost & { confirmClose: jest.Mock };
    const originalElectron = window.electron;

    let closeRequestCallback: (() => void) | null;
    let unsubscribeCloseRequests: jest.Mock;
    let electronStub: {
        setWindowCloseGuard: jest.Mock;
        confirmWindowClose: jest.Mock;
        cancelWindowClose: jest.Mock;
        onWindowCloseRequested: jest.Mock;
    };

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [SettingsUnloadGuardService],
        });

        service = TestBed.inject(SettingsUnloadGuardService);
        // The service only touches `events`, `dirty` and the pristine
        // markers, so a minimal group stands in for the real settings form.
        form = new FormBuilder().group({
            theme: [''],
        }) as unknown as SettingsForm;
        host = {
            confirmClose: jest.fn().mockResolvedValue(true),
            form,
        };

        closeRequestCallback = null;
        unsubscribeCloseRequests = jest.fn();
        electronStub = {
            setWindowCloseGuard: jest.fn().mockResolvedValue(undefined),
            confirmWindowClose: jest.fn().mockResolvedValue(undefined),
            cancelWindowClose: jest.fn().mockResolvedValue(undefined),
            installAppUpdate: jest.fn().mockResolvedValue({
                currentVersion: '0.23.0',
                status: 'idle',
                supportedSelfUpdate: true,
            }),
            onWindowCloseRequested: jest.fn((callback: () => void) => {
                closeRequestCallback = callback;
                return unsubscribeCloseRequests;
            }),
        };
    });

    afterEach(() => {
        service.ngOnDestroy();
        window.electron = originalElectron;
    });

    function activateInElectron(): void {
        window.electron = electronStub as unknown as typeof window.electron;
        service.activate(host);
    }

    function activateInPwa(): void {
        window.electron = undefined;
        service.activate(host);
    }

    function dispatchBeforeUnload(): Event {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event;
    }

    async function flushAsyncWork(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    describe('beforeunload (PWA)', () => {
        it('blocks the unload while the form is dirty', () => {
            activateInPwa();
            form.markAsDirty();

            const event = dispatchBeforeUnload();

            expect(event.defaultPrevented).toBe(true);
        });

        it('lets a pristine form unload silently', () => {
            activateInPwa();

            const event = dispatchBeforeUnload();

            expect(event.defaultPrevented).toBe(false);
        });

        it('stops blocking after destroy', () => {
            activateInPwa();
            form.markAsDirty();
            service.ngOnDestroy();

            const event = dispatchBeforeUnload();

            expect(event.defaultPrevented).toBe(false);
        });
    });

    describe('close guard mirroring (Electron)', () => {
        it('arms the main-process guard for the whole settings mount', () => {
            // Mount-long, not per dirty transition: arming on the first
            // edit would race the very close it protects against, since
            // the IPC is asynchronous. A pristine close auto-confirms.
            activateInElectron();

            expect(electronStub.setWindowCloseGuard).toHaveBeenCalledWith(
                true
            );
        });

        it('disarms the guard on destroy and unsubscribes the push', () => {
            activateInElectron();

            service.ngOnDestroy();

            expect(electronStub.setWindowCloseGuard).toHaveBeenLastCalledWith(
                false
            );
            expect(unsubscribeCloseRequests).toHaveBeenCalled();
        });
    });

    describe('updater-driven app quit (Electron)', () => {
        it('suspends both protection layers for the quit', () => {
            activateInElectron();
            form.markAsDirty();

            service.suspendForAppQuit();

            // The main-process mirror is disarmed...
            expect(electronStub.setWindowCloseGuard).toHaveBeenLastCalledWith(
                false
            );
            // ...and the DOM layer no longer cancels the unload, so the
            // updater's window close passes without turning into a reload.
            const event = dispatchBeforeUnload();
            expect(event.defaultPrevented).toBe(false);
        });

        it('restores the protection when the quit did not happen', () => {
            activateInElectron();
            form.markAsDirty();
            service.suspendForAppQuit();

            service.resumeAfterAbortedAppQuit();

            expect(electronStub.setWindowCloseGuard).toHaveBeenLastCalledWith(
                true
            );
            const event = dispatchBeforeUnload();
            expect(event.defaultPrevented).toBe(true);
        });

        it('stands down for any install entry point via the install service', async () => {
            // The global update panel installs through the same root
            // service; while settings is mounted, that must reach this
            // guard. An Idle reply (nothing installable) suspends and
            // restores in one round trip.
            const installService = TestBed.inject(AppUpdateInstallService);
            activateInElectron();
            form.markAsDirty();

            await installService.installAppUpdate();

            expect(electronStub.setWindowCloseGuard).toHaveBeenLastCalledWith(
                true
            );
            const event = dispatchBeforeUnload();
            expect(event.defaultPrevented).toBe(true);
        });

        it('unregisters from the install service on destroy', async () => {
            const installService = TestBed.inject(AppUpdateInstallService);
            activateInElectron();
            service.ngOnDestroy();
            const callsAfterDestroy =
                electronStub.setWindowCloseGuard.mock.calls.length;

            await installService.installAppUpdate();

            expect(electronStub.setWindowCloseGuard.mock.calls.length).toBe(
                callsAfterDestroy
            );
        });
    });

    describe('intercepted window close (Electron)', () => {
        it('confirms the close once the user saves or discards', async () => {
            activateInElectron();
            form.markAsDirty();

            closeRequestCallback?.();
            await flushAsyncWork();

            expect(host.confirmClose).toHaveBeenCalledTimes(1);
            expect(electronStub.confirmWindowClose).toHaveBeenCalledTimes(1);
        });

        it('keeps the window open when the user stays or the save fails', async () => {
            host.confirmClose.mockResolvedValue(false);
            activateInElectron();
            form.markAsDirty();

            closeRequestCallback?.();
            await flushAsyncWork();

            expect(electronStub.confirmWindowClose).not.toHaveBeenCalled();
            // Staying abandons the request in the main process too, so the
            // remembered close-vs-quit intent cannot leak into a later
            // attempt.
            expect(electronStub.cancelWindowClose).toHaveBeenCalledTimes(1);
        });

        it('escalates an open reload confirmation into the requested close', async () => {
            let resolveConfirm: ((value: boolean) => void) | null = null;
            host.confirmClose.mockImplementation(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveConfirm = resolve;
                    })
            );
            const reloadPage = jest.fn();
            activateInElectron();
            service.reloadPage = reloadPage;
            form.markAsDirty();

            // Reload confirmation opens first...
            dispatchBeforeUnload();
            await flushAsyncWork();
            expect(host.confirmClose).toHaveBeenCalledTimes(1);

            // ...then the user closes the window while it is on screen.
            closeRequestCallback?.();
            resolveConfirm?.(true);
            await flushAsyncWork();

            // Save/Discard completes the close — not the stale reload.
            expect(electronStub.confirmWindowClose).toHaveBeenCalledTimes(1);
            expect(reloadPage).not.toHaveBeenCalled();
        });

        it('cancels the escalated close when the user stays', async () => {
            let resolveConfirm: ((value: boolean) => void) | null = null;
            host.confirmClose.mockImplementation(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveConfirm = resolve;
                    })
            );
            activateInElectron();
            form.markAsDirty();

            dispatchBeforeUnload();
            await flushAsyncWork();
            closeRequestCallback?.();
            resolveConfirm?.(false);
            await flushAsyncWork();

            // The main process remembered a close; staying must clear it.
            expect(electronStub.cancelWindowClose).toHaveBeenCalledTimes(1);
            expect(electronStub.confirmWindowClose).not.toHaveBeenCalled();
        });

        it('ignores repeated close requests while a dialog is open', async () => {
            let resolveConfirm: ((value: boolean) => void) | null = null;
            host.confirmClose.mockImplementation(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveConfirm = resolve;
                    })
            );
            activateInElectron();
            form.markAsDirty();

            closeRequestCallback?.();
            closeRequestCallback?.();
            await flushAsyncWork();

            expect(host.confirmClose).toHaveBeenCalledTimes(1);

            resolveConfirm?.(true);
            await flushAsyncWork();

            expect(electronStub.confirmWindowClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('intercepted reload (Electron)', () => {
        it('re-triggers the reload after the user saves or discards', async () => {
            const reloadPage = jest.fn();
            activateInElectron();
            service.reloadPage = reloadPage;
            form.markAsDirty();

            const event = dispatchBeforeUnload();
            await flushAsyncWork();

            expect(event.defaultPrevented).toBe(true);
            expect(host.confirmClose).toHaveBeenCalledTimes(1);
            expect(reloadPage).toHaveBeenCalledTimes(1);
            // A reload decision must never complete a window close.
            expect(electronStub.confirmWindowClose).not.toHaveBeenCalled();
        });

        it('cancels the reload when the user stays', async () => {
            const reloadPage = jest.fn();
            host.confirmClose.mockResolvedValue(false);
            activateInElectron();
            service.reloadPage = reloadPage;
            form.markAsDirty();

            dispatchBeforeUnload();
            await flushAsyncWork();

            expect(reloadPage).not.toHaveBeenCalled();
            // A reload was never remembered by the main process, so there
            // is nothing to cancel there.
            expect(electronStub.cancelWindowClose).not.toHaveBeenCalled();
        });
    });
});
