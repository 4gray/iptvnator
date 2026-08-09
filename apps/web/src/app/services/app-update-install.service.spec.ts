import { TestBed } from '@angular/core/testing';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
} from '@iptvnator/shared/interfaces';
import {
    AppQuitUnloadGuardHooks,
    AppUpdateInstallService,
} from './app-update-install.service';

const BASE_STATUS: ElectronBridgeAppUpdateStatus = {
    currentVersion: '0.23.0',
    status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
    supportedSelfUpdate: true,
};

/**
 * The install choreography shared by every entry point (settings About
 * section, global update notification panel): suspend the unsaved-settings
 * unload guard for the updater-driven quit, and restore it on every path
 * that proves the quit is not happening.
 */
describe('AppUpdateInstallService', () => {
    const originalElectron = window.electron;

    let pushStatus: (status: ElectronBridgeAppUpdateStatus) => void;
    let electronStub: {
        installAppUpdate: jest.Mock;
        onAppUpdateStatusChange: jest.Mock;
    };
    let guard: AppQuitUnloadGuardHooks & {
        suspendForAppQuit: jest.Mock;
        resumeAfterAbortedAppQuit: jest.Mock;
    };

    beforeEach(() => {
        pushStatus = () => undefined;
        electronStub = {
            installAppUpdate: jest.fn().mockResolvedValue(BASE_STATUS),
            onAppUpdateStatusChange: jest.fn(
                (callback: (status: ElectronBridgeAppUpdateStatus) => void) => {
                    pushStatus = callback;
                    return jest.fn();
                }
            ),
        };
        window.electron = electronStub as unknown as typeof window.electron;
        guard = {
            resumeAfterAbortedAppQuit: jest.fn(),
            suspendForAppQuit: jest.fn(),
        };

        TestBed.configureTestingModule({});
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    function createService(): AppUpdateInstallService {
        return TestBed.inject(AppUpdateInstallService);
    }

    it('returns null and touches no guard without the desktop bridge', async () => {
        const service = createService();
        service.registerUnloadGuard(guard);
        window.electron = undefined;

        expect(await service.installAppUpdate()).toBeNull();
        expect(guard.suspendForAppQuit).not.toHaveBeenCalled();
    });

    it('keeps the guard down while a real install quits the app', async () => {
        electronStub.installAppUpdate.mockResolvedValue({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
        });
        const service = createService();
        service.registerUnloadGuard(guard);

        await service.installAppUpdate();

        expect(guard.suspendForAppQuit).toHaveBeenCalledTimes(1);
        expect(guard.resumeAfterAbortedAppQuit).not.toHaveBeenCalled();
    });

    it('restores the guard when nothing was installed', async () => {
        const service = createService();
        service.registerUnloadGuard(guard);

        // BASE_STATUS reply stays Idle: nothing installable, no quit.
        await service.installAppUpdate();

        expect(guard.suspendForAppQuit).toHaveBeenCalledTimes(1);
        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);
    });

    it('restores the guard when the install IPC rejects', async () => {
        const failure = new Error('ipc failed');
        electronStub.installAppUpdate.mockRejectedValue(failure);
        const service = createService();
        service.registerUnloadGuard(guard);

        await expect(service.installAppUpdate()).rejects.toThrow(failure);

        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);
    });

    it('restores the guard when an error push follows a quitting install', async () => {
        // electron-updater reports install failures as a later 'error'
        // status push, not as a rejection of the install IPC.
        electronStub.installAppUpdate.mockResolvedValue({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
        });
        const service = createService();
        service.registerUnloadGuard(guard);
        await service.installAppUpdate();

        pushStatus({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error,
        });

        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);

        // One-shot: later unrelated pushes must not resume again.
        pushStatus(BASE_STATUS);
        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);
    });

    it('survives an error push that beats the install reply', async () => {
        // IPC ordering between the invoke reply and status pushes is not
        // guaranteed; a stale 'downloaded' reply must not re-suspend the
        // protection the failure already restored.
        let resolveInstall: (
            status: ElectronBridgeAppUpdateStatus
        ) => void = () => undefined;
        electronStub.installAppUpdate.mockImplementation(
            () =>
                new Promise<ElectronBridgeAppUpdateStatus>((resolve) => {
                    resolveInstall = resolve;
                })
        );
        const service = createService();
        service.registerUnloadGuard(guard);

        const install = service.installAppUpdate();
        pushStatus({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error,
        });
        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);

        resolveInstall({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Downloaded,
        });
        await install;

        expect(guard.suspendForAppQuit).toHaveBeenCalledTimes(1);
        pushStatus({
            ...BASE_STATUS,
            status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Error,
        });
        expect(guard.resumeAfterAbortedAppQuit).toHaveBeenCalledTimes(1);
    });

    it('stops reaching a guard after it unregisters', async () => {
        const service = createService();
        const unregister = service.registerUnloadGuard(guard);

        unregister();
        await service.installAppUpdate();

        expect(guard.suspendForAppQuit).not.toHaveBeenCalled();
        expect(guard.resumeAfterAbortedAppQuit).not.toHaveBeenCalled();
    });
});
