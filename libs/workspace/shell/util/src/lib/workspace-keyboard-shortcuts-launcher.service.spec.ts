import { TestBed } from '@angular/core/testing';
import { WorkspaceKeyboardShortcutsLauncherService } from './workspace-keyboard-shortcuts-launcher.service';

describe('WorkspaceKeyboardShortcutsLauncherService', () => {
    let launcher: WorkspaceKeyboardShortcutsLauncherService;

    beforeEach(() => {
        launcher = TestBed.inject(WorkspaceKeyboardShortcutsLauncherService);
    });

    it('is unavailable and inert without a shell', () => {
        expect(launcher.available()).toBe(false);
        expect(() => launcher.open()).not.toThrow();
    });

    it('opens through the registered shell until it unregisters', () => {
        const open = jest.fn();
        const unregister = launcher.register(open);

        launcher.open();
        expect(open).toHaveBeenCalledTimes(1);
        expect(launcher.available()).toBe(true);

        unregister();
        launcher.open();
        expect(open).toHaveBeenCalledTimes(1);
        expect(launcher.available()).toBe(false);
    });

    it('keeps a newer shell registered when an older one leaves', () => {
        const unregisterOld = launcher.register(jest.fn());
        const current = jest.fn();
        launcher.register(current);

        unregisterOld();
        launcher.open();

        expect(current).toHaveBeenCalledTimes(1);
    });
});
