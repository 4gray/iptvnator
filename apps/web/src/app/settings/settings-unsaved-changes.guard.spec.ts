import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import {
    SettingsLeaveConfirmation,
    settingsUnsavedChangesGuard,
} from './settings-unsaved-changes.guard';

describe('settingsUnsavedChangesGuard', () => {
    const runGuard = (
        nextUrl: string,
        component: SettingsLeaveConfirmation
    ): Promise<boolean> | boolean =>
        settingsUnsavedChangesGuard(
            component,
            {} as ActivatedRouteSnapshot,
            { url: '/workspace/settings/general' } as RouterStateSnapshot,
            { url: nextUrl } as RouterStateSnapshot
        ) as Promise<boolean> | boolean;

    const componentSpy = (answer: boolean): SettingsLeaveConfirmation => ({
        confirmLeaveWithUnsavedChanges: jest.fn().mockResolvedValue(answer),
    });

    it.each([
        '/workspace/settings/playback',
        '/workspace/settings/general?focus=theme',
        '/workspace/settings',
    ])('lets section-internal navigation to %s pass silently', (url) => {
        const component = componentSpy(false);

        expect(runGuard(url, component)).toBe(true);
        expect(component.confirmLeaveWithUnsavedChanges).not.toHaveBeenCalled();
    });

    it('asks the component when actually leaving the settings area', async () => {
        const component = componentSpy(false);

        await expect(runGuard('/workspace/dashboard', component)).resolves.toBe(
            false
        );
        expect(component.confirmLeaveWithUnsavedChanges).toHaveBeenCalledTimes(
            1
        );
    });

    it('propagates an allowed leave', async () => {
        await expect(
            runGuard('/workspace/playlists/abc/all', componentSpy(true))
        ).resolves.toBe(true);
    });

    it('does not treat a lookalike prefix as inside the settings area', async () => {
        const component = componentSpy(true);

        await runGuard('/workspace/settingsish', component);

        expect(component.confirmLeaveWithUnsavedChanges).toHaveBeenCalled();
    });
});
