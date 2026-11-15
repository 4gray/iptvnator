import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { EpgSourceReconciliationError } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsComponent } from './settings.component';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    DEFAULT_DASHBOARD_RAILS,
    MockSettingsStore,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

const SAVED_GUIDE = 'https://example.test/saved.xml';
const RESTORED_GUIDE = 'https://example.test/restored.xml';
const STAGED_GUIDE = 'https://example.test/staged.xml';

/**
 * Settings written elsewhere while the settings page is open — the command
 * palette's player switch or any other store writer, a restored backup's
 * EPG sources — must survive the page's Save, and a restore must
 * not throw away the edits staged on the page.
 */
describe('SettingsComponent with settings changed outside the form', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let settingsStore: MockSettingsStore;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        configureSettingsComponentTestBed(createEpgBridgeStub());
    }));

    beforeEach(async () => {
        window.electron = createElectronStub();
        settingsStore = TestBed.inject(
            SettingsStore
        ) as unknown as MockSettingsStore;
        settingsStore._setSettings({ epgUrl: [SAVED_GUIDE] });
        fixture = TestBed.createComponent(SettingsComponent);
        component = fixture.componentInstance;
        stubSettingsSideEffects(component);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    /** Stands in for a backup restore that merged EPG sources into the store. */
    function importBackupAddingGuide(url: string): void {
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (onImported) => {
                settingsStore._setSettings({
                    epgUrl: [...settingsStore.getSettings().epgUrl, url],
                });
                onImported();
            }
        );
        component.importData();
    }

    it('keeps settings changed elsewhere when saving an unrelated edit', async () => {
        const form = component.settingsForm;
        form.controls.showCaptions.setValue(true);
        form.markAsDirty();
        settingsStore._setSettings({
            player: VideoPlayer.Html5Player,
            vodAutoFailover: true,
        });

        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.updateSettings).toHaveBeenCalledWith(
            { showCaptions: true },
            { retryEpgCleanup: false }
        );
        expect(settingsStore.getSettings()).toEqual(
            expect.objectContaining({
                player: VideoPlayer.Html5Player,
                vodAutoFailover: true,
                showCaptions: true,
            })
        );
        expect(window.electron.updateSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                player: VideoPlayer.Html5Player,
                vodAutoFailover: true,
                showCaptions: true,
            })
        );
        // The page now shows the outside values as saved, not as edits.
        expect(form.controls.player.value).toBe(VideoPlayer.Html5Player);
        expect(form.controls.vodAutoFailover.value).toBe(true);
        expect(component.form.changedPaths()).toEqual([]);
        expect(form.pristine).toBe(true);
    });

    it('writes a changed dashboard rail over the rails as stored now', async () => {
        const form = component.settingsForm;
        form.controls.dashboardRails.controls.hero.setValue(false);
        form.markAsDirty();
        settingsStore._setSettings({
            dashboardRails: { ...DEFAULT_DASHBOARD_RAILS, tmdbTrending: false },
        });

        await component.form.save(() => undefined);

        expect(settingsStore.getSettings().dashboardRails).toEqual({
            ...DEFAULT_DASHBOARD_RAILS,
            hero: false,
            tmdbTrending: false,
        });
    });

    it('lets a staged edit win over an outside change to the same setting', async () => {
        const form = component.settingsForm;
        form.controls.player.setValue(VideoPlayer.ArtPlayer);
        form.markAsDirty();
        settingsStore._setSettings({ player: VideoPlayer.Html5Player });

        await component.form.save(() => undefined);

        // The user's own choice wins for the control they changed.
        expect(settingsStore.getSettings().player).toBe(VideoPlayer.ArtPlayer);
        expect(component.form.changedPaths()).toEqual([]);
    });

    it('keeps staged edits through a backup import and saves them afterwards', async () => {
        const form = component.settingsForm;
        form.controls.showCaptions.setValue(true);
        form.markAsDirty();

        importBackupAddingGuide(RESTORED_GUIDE);

        expect(form.controls.showCaptions.value).toBe(true);
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, RESTORED_GUIDE]);
        expect(component.form.changedPaths()).toEqual(['showCaptions']);
        expect(form.dirty).toBe(true);

        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.updateSettings).toHaveBeenLastCalledWith(
            { showCaptions: true },
            { retryEpgCleanup: false }
        );
        expect(settingsStore.getSettings()).toEqual(
            expect.objectContaining({
                showCaptions: true,
                epgUrl: [SAVED_GUIDE, RESTORED_GUIDE],
            })
        );
        expect(form.pristine).toBe(true);
    });

    it('leaves no unsaved state behind when an import meets a form without edits', () => {
        const form = component.settingsForm;
        // Toggled and back: dirty, but nothing differs from the saved values.
        form.controls.showCaptions.setValue(true);
        form.controls.showCaptions.setValue(false);
        form.markAsDirty();

        importBackupAddingGuide(RESTORED_GUIDE);

        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, RESTORED_GUIDE]);
        expect(component.form.changedPaths()).toEqual([]);
        expect(form.pristine).toBe(true);
    });

    it('keeps a failed cleanup available for retry after importing a backup', async () => {
        component.form.setEpgUrls(STAGED_GUIDE);
        component.form.removeEpgSource(1);
        settingsStore.updateSettings.mockRejectedValueOnce(
            new EpgSourceReconciliationError()
        );
        await expect(component.form.save(() => undefined)).rejects.toThrow(
            EpgSourceReconciliationError
        );
        expect(component.form.changedPaths()).toEqual([]);

        importBackupAddingGuide(RESTORED_GUIDE);

        expect(component.settingsForm.dirty).toBe(true);
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, RESTORED_GUIDE]);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.updateSettings).toHaveBeenLastCalledWith(
            {},
            { retryEpgCleanup: true }
        );
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('saves a staged source list with a source added elsewhere meanwhile', async () => {
        const form = component.settingsForm;
        component.form.removeEpgSource(0);
        component.form.setEpgUrls(STAGED_GUIDE);
        // Another writer adds a global source while the draft waits.
        settingsStore._setSettings({
            epgUrl: [SAVED_GUIDE, RESTORED_GUIDE],
        });

        await component.form.save(() => component.form.applySavedSettings());

        // The removed source stays removed; the outside one is kept.
        expect(settingsStore.getSettings().epgUrl).toEqual([
            STAGED_GUIDE,
            RESTORED_GUIDE,
        ]);
        expect(component.form.epgUrls).toEqual([STAGED_GUIDE, RESTORED_GUIDE]);
        expect(component.form.changedPaths()).toEqual([]);
        expect(form.pristine).toBe(true);
    });

    it('keeps an outside EPG source across a retry after the desktop update fails', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();
        settingsStore._setSettings({ epgUrl: [SAVED_GUIDE, RESTORED_GUIDE] });

        await expect(component.form.save(() => undefined)).rejects.toThrow();
        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
            RESTORED_GUIDE,
        ]);
        expect(component.form.epgUrls).toEqual(
            settingsStore.getSettings().epgUrl
        );
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('accepts newly stored sources when the staged source list did not change during save', async () => {
        let finishUpdate!: () => void;
        const pending = new Promise<void>((resolve) => {
            finishUpdate = resolve;
        });
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            pending
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();

        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();
        settingsStore._setSettings({
            epgUrl: [SAVED_GUIDE, STAGED_GUIDE, RESTORED_GUIDE],
        });
        finishUpdate();
        await saving;

        expect(component.form.epgUrls).toEqual(
            settingsStore.getSettings().epgUrl
        );
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('takes a restored URL that matches a rolled-back draft addition', async () => {
        settingsStore.updateSettings.mockRejectedValueOnce(
            new Error('storage unavailable')
        );
        component.form.setEpgUrls(RESTORED_GUIDE);
        component.settingsForm.markAsDirty();
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        expect(settingsStore.getSettings().epgUrl).toEqual([SAVED_GUIDE]);

        component.form.removeEpgSource(1);
        importBackupAddingGuide(RESTORED_GUIDE);
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, RESTORED_GUIDE]);

        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            RESTORED_GUIDE,
        ]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('lets a source added by a half-failed save be removed on retry', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();
        // The store write lands; applying it to the desktop runtime fails.
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);

        component.form.removeEpgSource(1);
        await component.form.save(() => undefined);

        expect(settingsStore.getSettings().epgUrl).toEqual([SAVED_GUIDE]);
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE]);
    });

    it('writes a TMDB key typed back after a half-failed save', async () => {
        const tmdb = component.settingsForm.controls.tmdb.controls;
        const savedKey = tmdb.apiKey.value;
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        tmdb.apiKey.setValue('synthetic-key-b');
        component.settingsForm.markAsDirty();
        // The store write lands; applying it to the desktop runtime fails.
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        expect(settingsStore.getSettings().tmdb.apiKey).toBe('synthetic-key-b');

        tmdb.apiKey.setValue(savedKey);
        await component.form.save(() => undefined);

        expect(settingsStore.getSettings().tmdb.apiKey).toBe(savedKey);
        expect(tmdb.apiKey.value).toBe(savedKey);
    });

    it('keeps a key typed back while the desktop is acknowledging a save', async () => {
        const { apiKey } = component.settingsForm.controls.tmdb.controls;
        const savedKey = apiKey.value;
        let finishUpdate!: () => void;
        const pending = new Promise<void>((resolve) => {
            finishUpdate = resolve;
        });
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            pending
        );
        apiKey.setValue('synthetic-key-b');
        component.settingsForm.markAsDirty();
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();

        apiKey.setValue(savedKey);
        settingsStore.savedTmdbApiKey.set('synthetic-key-b');
        fixture.detectChanges();
        const keyWhilePending = apiKey.value;
        finishUpdate();
        await saving;

        expect(keyWhilePending).toBe(savedKey);
        expect(apiKey.value).toBe(savedKey);
        expect(component.form.changedPaths()).toEqual(['tmdb.apiKey']);
    });

    it('keeps an unacknowledged setting staged through a backup import', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        const form = component.settingsForm;
        form.controls.showCaptions.setValue(true);
        form.markAsDirty();
        await expect(component.form.save(() => undefined)).rejects.toThrow();

        importBackupAddingGuide(RESTORED_GUIDE);

        expect(component.form.changedPaths()).toEqual(['showCaptions']);
        expect(form.dirty).toBe(true);
        await component.form.save(() => component.form.applySavedSettings());
        expect(form.pristine).toBe(true);
    });

    it('does not rewrite a half-failed save after Discard', async () => {
        const form = component.settingsForm;
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        form.controls.player.setValue(VideoPlayer.ArtPlayer);
        form.markAsDirty();
        await expect(component.form.save(() => undefined)).rejects.toThrow();

        component.discardChanges();
        settingsStore._setSettings({ player: VideoPlayer.Html5Player });
        form.controls.showCaptions.setValue(true);
        form.markAsDirty();
        await component.form.save(() => undefined);

        expect(settingsStore.updateSettings).toHaveBeenLastCalledWith(
            { showCaptions: true },
            { retryEpgCleanup: false }
        );
        expect(settingsStore.getSettings().player).toBe(
            VideoPlayer.Html5Player
        );
    });

    it('clears the EPG draft when a backup saves the same sources in a different order', () => {
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (onImported) => {
                settingsStore._setSettings({
                    epgUrl: [STAGED_GUIDE, SAVED_GUIDE],
                });
                onImported();
            }
        );

        component.importData();

        expect(component.form.epgUrls).toEqual([STAGED_GUIDE, SAVED_GUIDE]);
        expect(component.form.changedPaths()).toEqual([]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('keeps restored local guides distinct when only their path case differs', async () => {
        const staged = '/example/Guide.xml';
        const restored = '/example/guide.xml';
        component.form.setEpgUrls(staged);
        component.settingsForm.markAsDirty();

        importBackupAddingGuide(restored);
        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            staged,
            restored,
        ]);
    });

    it('merges restored EPG sources into a staged source list', async () => {
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();

        importBackupAddingGuide(RESTORED_GUIDE);

        expect(component.form.epgUrls).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
            RESTORED_GUIDE,
        ]);
        expect(component.form.changedPaths()).toEqual(['epgUrl']);

        await component.form.save(() => undefined);

        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
            RESTORED_GUIDE,
        ]);
    });
});
