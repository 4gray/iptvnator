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
        jest.spyOn(component.epg, 'fetchConfiguredEpg').mockImplementation();
        component.settingsForm.markAsDirty();

        component.onSubmit();
        // save() resolves a tick after the store write: the callback and
        // the Electron mirror run first, so the pristine flip lands on the
        // next turn of the microtask queue.
        await fixture.whenStable();
        await fixture.whenStable();

        expect(component.settingsForm.pristine).toBe(true);
    });

    it('retries failed source cleanup on an explicit EPG save and clears dirty state only on success', async () => {
        await fixture.whenStable();
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
