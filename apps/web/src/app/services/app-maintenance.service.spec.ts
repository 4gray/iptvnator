import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { ElectronBridgeAppMenuAction } from '@iptvnator/shared/interfaces';
import { AppMaintenanceService } from './app-maintenance.service';

describe('AppMaintenanceService', () => {
    const original = window.electron;
    let navigate: jest.Mock;
    beforeEach(() => {
        navigate = jest.fn().mockResolvedValue(true);
        TestBed.configureTestingModule({
            providers: [
                { provide: Router, useValue: { navigateByUrl: navigate } },
            ],
        });
    });
    afterEach(() => {
        TestBed.resetTestingModule();
        window.electron = original;
    });

    it('keeps settings available in a browser or partial bridge', async () => {
        window.electron = undefined!;
        const service = TestBed.inject(AppMaintenanceService);
        service.start();
        expect(service.canCheckForUpdates).toBe(false);
        await service.openSettings();
        await service.checkForUpdates();
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('/workspace/settings');
    });

    it('does not offer updates through an incomplete bridge', () => {
        window.electron = { checkForAppUpdate: jest.fn() } as unknown as typeof original;
        expect(TestBed.inject(AppMaintenanceService).canCheckForUpdates).toBe(false);
    });

    it('routes a manual check to About so all updater outcomes are visible', async () => {
        const check = jest.fn().mockResolvedValue({ status: 'not-available' });
        window.electron = {
            checkForAppUpdate: check,
            getAppUpdateStatus: jest.fn(),
        } as unknown as typeof original;
        await TestBed.inject(AppMaintenanceService).checkForUpdates();
        expect(navigate).toHaveBeenCalledWith('/workspace/settings/about');
        expect(check).toHaveBeenCalledTimes(1);
    });

    it('respects a cancelled navigation and does not check behind an unsaved form', async () => {
        navigate.mockResolvedValue(false);
        const check = jest.fn();
        window.electron = {
            checkForAppUpdate: check,
            getAppUpdateStatus: jest.fn(),
        } as unknown as typeof original;
        await TestBed.inject(AppMaintenanceService).checkForUpdates();
        expect(check).not.toHaveBeenCalled();
    });

    it('uses the same handlers for native menu commands and unsubscribes', async () => {
        let action!: (value: ElectronBridgeAppMenuAction) => void;
        const unsubscribe = jest.fn();
        window.electron = {
            checkForAppUpdate: jest.fn().mockResolvedValue({}),
            getAppUpdateStatus: jest.fn(),
            onAppMenuAction: jest.fn((callback) => {
                action = callback;
                return unsubscribe;
            }),
        } as unknown as typeof original;
        TestBed.inject(AppMaintenanceService).start();
        action('settings');
        action('check-for-updates');
        await Promise.resolve();
        expect(navigate.mock.calls).toEqual([
            ['/workspace/settings'],
            ['/workspace/settings/about'],
        ]);
        TestBed.resetTestingModule();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
