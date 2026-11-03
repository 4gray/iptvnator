import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { EpgSourceReconciliationError } from '@iptvnator/services';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsComponent } from './settings.component';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    MatSnackBarStub,
    MockSettingsStore,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

/** Matches the snackbar config used by `SettingsSnackbarService.error`. */
const ERROR_SNACKBAR_CONFIG = expect.objectContaining({
    panelClass: ['settings-snackbar', 'settings-snackbar--error'],
});

/**
 * Settings live in the renderer's IndexedDB, and both halves of the round trip
 * can fail while the UI keeps looking healthy: a failed read shows defaults as
 * if they were saved, and a failed write is applied in memory so it survives
 * until the next restart. These cover the user-visible reporting of both.
 */
describe('SettingsComponent storage failures', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let settingsStore: MockSettingsStore;
    let snackBar: MatSnackBarStub;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        epgBridge = createEpgBridgeStub();
        configureSettingsComponentTestBed(epgBridge);
    }));

    beforeEach(() => {
        window.electron = createElectronStub();

        fixture = TestBed.createComponent(SettingsComponent);
        settingsStore = TestBed.inject(
            SettingsStore
        ) as unknown as MockSettingsStore;
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;

        component = fixture.componentInstance;
        stubSettingsSideEffects(component);
        fixture.detectChanges();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('warns when the persisted settings could not be read', async () => {
        settingsStore.storageFailure.set('load');

        await component.ngOnInit();

        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_LOAD_FAILED',
            'CLOSE',
            ERROR_SNACKBAR_CONFIG
        );
    });

    it('warns and keeps the form dirty when the settings write fails', async () => {
        settingsStore.updateSettings.mockRejectedValue(
            new Error('storage unavailable')
        );
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await fixture.whenStable();

        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_SAVE_FAILED',
            'CLOSE',
            ERROR_SNACKBAR_CONFIG
        );
        // The unsaved-changes bar keys off the dirty state, so the failed
        // write must not mark the form pristine — that is what keeps the
        // retry path on screen.
        expect(component.settingsForm.dirty).toBe(true);
        expect(window.electron.updateSettings).not.toHaveBeenCalled();
        expect(window.electron.setMpvPlayerPath).not.toHaveBeenCalled();
        expect(window.electron.setVlcPlayerPath).not.toHaveBeenCalled();
    });

    it('marks the form pristine only after the settings write succeeded', async () => {
        settingsStore.updateSettings.mockResolvedValue(undefined);
        const save = jest.spyOn(component.form, 'save');
        jest.spyOn(component.epg, 'fetchConfiguredEpg').mockImplementation();
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await save.mock.results[0].value;
        await fixture.whenStable();

        expect(component.settingsForm.pristine).toBe(true);
    });

    it('warns and keeps edits available when the desktop runtime rejects settings', async () => {
        const update = Promise.reject(new Error('Port 8765 is already in use'));
        void update.catch(() => undefined);
        jest.spyOn(window.electron, 'updateSettings').mockReturnValue(update);
        component.settingsForm.markAsDirty();

        component.onSubmit();
        await fixture.whenStable();

        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_RUNTIME_UPDATE_FAILED',
            undefined,
            expect.any(Object)
        );
        expect(snackBar.open).not.toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_SAVE_FAILED',
            expect.anything(),
            expect.anything()
        );
        expect(snackBar.open).not.toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_SAVED',
            undefined,
            expect.any(Object)
        );
        expect(component.settingsForm.dirty).toBe(true);
        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(1);
    });

    it('keeps the user in settings when saved preferences cannot be applied to the desktop runtime', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValue(
            new Error('Port 8765 is already in use')
        );
        component.settingsForm.markAsDirty();
        (TestBed.inject(MatDialog).open as jest.Mock).mockReturnValue({
            afterClosed: () => of('save'),
        });

        await expect(component.confirmLeaveWithUnsavedChanges()).resolves.toBe(
            false
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_RUNTIME_UPDATE_FAILED',
            undefined,
            expect.any(Object)
        );
        expect(component.settingsForm.dirty).toBe(true);
    });

    it('confirms success only after the desktop runtime accepts settings', async () => {
        let acceptUpdate!: () => void;
        const update = new Promise<void>((resolve) => {
            acceptUpdate = resolve;
        });
        jest.spyOn(window.electron, 'updateSettings').mockReturnValue(update);
        const onSaved = jest.fn();

        const saving = component.form.save(onSaved);
        await Promise.resolve();
        const confirmedWhilePending = onSaved.mock.calls.length;
        acceptUpdate();
        await saving;

        expect(confirmedWhilePending).toBe(0);
        expect(onSaved).toHaveBeenCalledTimes(1);
    });

    it('keeps the user in settings when more edits are made during save-and-leave', async () => {
        await fixture.whenStable();
        let finishUpdate!: () => void;
        const pending = new Promise<void>((resolve) => {
            finishUpdate = resolve;
        });
        const updateSettings = jest
            .spyOn(window.electron, 'updateSettings')
            .mockReturnValueOnce(pending);
        component.settingsForm.patchValue({ remoteControlPort: 9988 });
        component.settingsForm.markAsDirty();
        (TestBed.inject(MatDialog).open as jest.Mock).mockReturnValue({
            afterClosed: () => of('save'),
        });

        const leaving = component.confirmLeaveWithUnsavedChanges();
        await Promise.resolve();
        await Promise.resolve();
        expect(updateSettings).toHaveBeenCalled();
        component.settingsForm.patchValue({ remoteControlPort: 9999 });
        component.settingsForm.markAsDirty();
        finishUpdate();

        await expect(leaving).resolves.toBe(false);
        expect(component.settingsForm.dirty).toBe(true);
        expect(component.form.changedPaths()).toEqual(['remoteControlPort']);
    });

    it('retries failed source cleanup on an explicit EPG save and clears dirty state only on success', async () => {
        await fixture.whenStable();
        const save = jest.spyOn(component.form, 'save');
        jest.spyOn(component.epg, 'fetchConfiguredEpg').mockImplementation();
        component.form.setEpgUrls(['removed-source']);
        component.form.removeEpgSource(0);
        component.settingsForm.patchValue({
            remoteControl: true,
            mpvPlayerPath: '/saved/mpv',
            vlcPlayerPath: '/saved/vlc',
        });
        settingsStore.updateSettings
            .mockRejectedValueOnce(new EpgSourceReconciliationError())
            .mockResolvedValue(undefined);
        component.onSubmit();
        await fixture.whenStable();
        expect(component.form.epgUrl.dirty).toBe(true);
        expect(window.electron.updateSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                remoteControl: true,
                mpvPlayerPath: '/saved/mpv',
                vlcPlayerPath: '/saved/vlc',
                epgUrl: [],
            })
        );
        expect(window.electron.setMpvPlayerPath).toHaveBeenCalledWith(
            '/saved/mpv'
        );
        expect(window.electron.setVlcPlayerPath).toHaveBeenCalledWith(
            '/saved/vlc'
        );
        expect(settingsStore.updateSettings).toHaveBeenLastCalledWith(
            expect.objectContaining({ epgUrl: [] }),
            { retryEpgCleanup: true }
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_DATA_CLEAR_FAILED',
            undefined,
            expect.any(Object)
        );
        component.onSubmit();
        await save.mock.results[1].value;
        await fixture.whenStable();
        expect(settingsStore.updateSettings).toHaveBeenCalledTimes(2);
        expect(component.form.epgUrl.pristine).toBe(true);
    });

    it('keeps the user in settings when save-and-leave cannot persist', async () => {
        settingsStore.updateSettings.mockRejectedValue(
            new Error('storage unavailable')
        );
        component.settingsForm.markAsDirty();
        (TestBed.inject(MatDialog).open as jest.Mock).mockReturnValue({
            afterClosed: () => of('save'),
        });

        // Allowing the navigation here would silently drop the edits the
        // dialog just promised to save.
        await expect(component.confirmLeaveWithUnsavedChanges()).resolves.toBe(
            false
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.SETTINGS_SAVE_FAILED',
            'CLOSE',
            ERROR_SNACKBAR_CONFIG
        );
        expect(component.settingsForm.dirty).toBe(true);
    });
});
