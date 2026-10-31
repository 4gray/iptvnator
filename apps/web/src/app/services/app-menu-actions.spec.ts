import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { ElectronBridgeAppMenuAction } from '@iptvnator/shared/interfaces';
import { startAppMenuActions } from './app-menu-actions';

describe('desktop menu actions', () => {
    const original = window.electron;
    let navigate: jest.Mock;
    let action: (value: ElectronBridgeAppMenuAction) => void | Promise<void>;
    let unsubscribe: jest.Mock;

    beforeEach(() => {
        navigate = jest.fn().mockResolvedValue(true);
        unsubscribe = jest.fn();
        TestBed.configureTestingModule({
            providers: [
                { provide: Router, useValue: { navigateByUrl: navigate } },
            ],
        });
        window.electron = {
            checkForAppUpdate: jest.fn().mockResolvedValue({}),
            getAppUpdateStatus: jest.fn().mockResolvedValue({ status: 'idle' }),
            onAppMenuAction: jest.fn((callback) => {
                action = callback;
                return unsubscribe;
            }),
        } as unknown as typeof original;
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        window.electron = original;
    });

    it('works without a desktop bridge', () => {
        window.electron = undefined!;
        expect(() =>
            TestBed.runInInjectionContext(startAppMenuActions)
        ).not.toThrow();
    });

    it('registers immediately, routes Settings and loads the update handler on demand', async () => {
        TestBed.runInInjectionContext(startAppMenuActions);
        await action('settings');
        await action('check-for-updates');
        expect(navigate.mock.calls).toEqual([
            ['/workspace/settings'],
            ['/workspace/settings/about'],
        ]);
        expect(window.electron.checkForAppUpdate).toHaveBeenCalledTimes(1);
        TestBed.resetTestingModule();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('ignores a command still loading when its owner is destroyed', async () => {
        TestBed.runInInjectionContext(startAppMenuActions);
        const pending = action('check-for-updates');
        TestBed.resetTestingModule();
        await pending;
        expect(navigate).not.toHaveBeenCalled();
        expect(window.electron.checkForAppUpdate).not.toHaveBeenCalled();
    });
});
