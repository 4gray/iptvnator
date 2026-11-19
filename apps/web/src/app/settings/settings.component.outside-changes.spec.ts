import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
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

    it('keeps a guide committed by backup in the baseline when the first Save fails', async () => {
        let failWrite!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(async (patch) => {
            settingsStore._setSettings(patch);
            await new Promise<void>((resolve) => (failWrite = resolve));
            throw new Error('storage unavailable');
        });
        component.form.setEpgUrls(STAGED_GUIDE);
        const saving = component.form.save(() => undefined);
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (done) => {
                settingsStore._setSettings({
                    epgUrl: [SAVED_GUIDE, STAGED_GUIDE],
                });
                done();
            }
        );
        component.importData();
        failWrite();
        await expect(saving).rejects.toThrow('storage unavailable');
        component.form.removeEpgSource(1);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([SAVED_GUIDE]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('keeps an uncommitted import out of an unrelated Save acknowledgement', async () => {
        let acknowledge!: () => void;
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            new Promise<void>((resolve) => (acknowledge = resolve))
        );
        component.settingsForm.controls.showCaptions.setValue(true);
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();
        settingsStore._setSettings({ epgUrl: [SAVED_GUIDE, RESTORED_GUIDE] });
        jest.spyOn(settingsStore, 'getCommittedEpgUrls').mockReturnValueOnce([
            SAVED_GUIDE,
        ]);
        acknowledge();
        await saving;
        settingsStore._setSettings({ epgUrl: [SAVED_GUIDE] });
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE]);
        expect(component.settingsForm.pristine).toBe(true);

        component.form.setEpgUrls(STAGED_GUIDE);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
    });

    it('keeps a restored source removal after a rebased retry fails', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        let failWrite!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(async (patch) => {
            settingsStore._setSettings(patch);
            await new Promise<void>((resolve) => (failWrite = resolve));
            throw new Error('storage unavailable');
        });
        const retry = component.form.save(() => undefined);
        importBackupAddingGuide(RESTORED_GUIDE);
        component.form.removeEpgSource(
            component.form.epgUrls.indexOf(RESTORED_GUIDE)
        );
        failWrite();
        await expect(retry).rejects.toThrow('storage unavailable');
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('keeps a persisted removal when a playlist-only import finishes during the next write', async () => {
        let acknowledgeFirst!: () => void;
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            new Promise<void>((resolve) => (acknowledgeFirst = resolve))
        );
        component.form.removeEpgSource(0);
        const first = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();
        let persistSecond!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(
            async (patch, _options, onPersisted) => {
                settingsStore._setSettings(patch);
                await new Promise<void>((resolve) => (persistSecond = resolve));
                onPersisted?.();
            }
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        const second = component.form.save(() =>
            component.form.applySavedSettings()
        );
        jest.spyOn(component.backup, 'importData').mockImplementation((done) =>
            done()
        );
        component.importData();
        persistSecond();
        await second;
        acknowledgeFirst();
        await first;
        expect(component.form.epgUrls).toEqual([STAGED_GUIDE]);
        expect(component.form.changedPaths()).toEqual([]);
    });

    it('leaves the parental lock mirror to the dedicated settings writer', async () => {
        let finishCleanup!: () => void;
        settingsStore.applyNextUpdateThen(
            () => new Promise<void>((resolve) => (finishCleanup = resolve))
        );
        component.settingsForm.controls.showCaptions.setValue(true);
        const saving = component.form.save(() => undefined);
        const applied = settingsStore.getSettings();
        jest.spyOn(settingsStore, 'getSettings').mockImplementation(() => ({
            ...applied,
            parentalLockEnabled: false,
        }));
        finishCleanup();
        await saving;
        expect(window.electron.updateSettings).toHaveBeenCalledWith(
            expect.objectContaining({ showCaptions: true })
        );
        expect(window.electron.updateSettings).not.toHaveBeenCalledWith(
            expect.objectContaining({ parentalLockEnabled: expect.anything() })
        );
    });

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

    it.each(['before', 'after'])(
        'keeps a newer key after a storage failure (other tab saves %s rejection)',
        async (otherTabTiming) => {
            const newKey = 'synthetic-key-from-other-tab';
            const { apiKey } = component.settingsForm.controls.tmdb.controls;
            const originalKey = apiKey.value;
            let rejectWrite!: (error: Error) => void;
            settingsStore.updateSettings.mockReturnValueOnce(
                new Promise<void>((_, reject) => (rejectWrite = reject))
            );
            apiKey.setValue('synthetic-draft-key');
            const saving = component.form.save(() => undefined);
            apiKey.setValue(originalKey);

            function saveFromOtherTab(): void {
                settingsStore._setSettings({
                    tmdb: { enabled: false, apiKey: newKey },
                });
                settingsStore.savedTmdbApiKey.set(newKey);
                fixture.detectChanges();
            }

            if (otherTabTiming === 'before') saveFromOtherTab();
            rejectWrite(new Error('storage unavailable'));
            await expect(saving).rejects.toThrow('storage unavailable');
            if (otherTabTiming === 'after') saveFromOtherTab();

            expect(apiKey.value).toBe(newKey);
            component.settingsForm.controls.showCaptions.setValue(true);
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.getSettings().tmdb.apiKey).toBe(newKey);
        }
    );

    it.each([false, true])(
        'rebases a newer key after a desktop failure (key edited since Save: %s)',
        async (editedAgain) => {
            const { apiKey } = component.settingsForm.controls.tmdb.controls;
            const originalKey = apiKey.value;
            const submittedKey = 'synthetic-submitted-key';
            const newKey = 'synthetic-key-from-other-tab';
            apiKey.setValue(submittedKey);
            jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
                new Error('runtime unavailable')
            );
            await expect(
                component.form.save(() => undefined)
            ).rejects.toThrow();
            settingsStore.savedTmdbApiKey.set(submittedKey);
            fixture.detectChanges();

            if (editedAgain) apiKey.setValue(originalKey);
            settingsStore._setSettings({
                tmdb: { enabled: false, apiKey: newKey },
            });
            settingsStore.savedTmdbApiKey.set(newKey);
            fixture.detectChanges();

            const expectedKey = editedAgain ? originalKey : newKey;
            expect(apiKey.value).toBe(expectedKey);
            component.settingsForm.controls.showCaptions.setValue(true);
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.getSettings().tmdb.apiKey).toBe(expectedKey);
        }
    );

    it.each([undefined, 'synthetic-confirmed-key'])(
        'keeps a rejected key draft through a playlist-only backup (confirmed key: %j)',
        async (confirmedKey) => {
            const { apiKey } = component.settingsForm.controls.tmdb.controls;
            settingsStore.savedTmdbApiKey.set(confirmedKey);
            fixture.detectChanges();
            const attemptedKey = 'synthetic-draft-key';
            apiKey.setValue(attemptedKey);
            settingsStore.updateSettings.mockImplementationOnce(async () => {
                settingsStore._setSettings({
                    tmdb: { enabled: false, apiKey: attemptedKey },
                });
                settingsStore.storageFailure.set('save');
                throw new Error('storage unavailable');
            });
            await expect(component.form.save(() => undefined)).rejects.toThrow(
                'storage unavailable'
            );

            jest.spyOn(component.backup, 'importData').mockImplementation(
                (imported) => imported()
            );
            component.importData();

            expect(component.form.changedPaths()).toContain('tmdb.apiKey');
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.updateSettings).toHaveBeenLastCalledWith(
                { tmdb: { apiKey: attemptedKey } },
                { retryEpgCleanup: false },
                expect.any(Function)
            );
        }
    );

    it('keeps a key draft when stored settings omit the key', async () => {
        settingsStore._setSettings({ tmdb: { enabled: true } });
        component.form.hydrateFromStore();
        const { apiKey } = component.settingsForm.controls.tmdb.controls;
        apiKey.setValue('synthetic-draft-key');
        component.settingsForm.markAsDirty();
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (imported) => imported()
        );
        component.importData();

        expect(component.form.changedPaths()).toContain('tmdb.apiKey');
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().tmdb.apiKey).toBe(
            'synthetic-draft-key'
        );
    });

    it('acknowledges a whitespace-only key edit without writing the key', async () => {
        const key = 'synthetic-existing-key';
        settingsStore._setSettings({ tmdb: { enabled: false, apiKey: key } });
        component.form.hydrateFromStore();
        const { apiKey } = component.settingsForm.controls.tmdb.controls;
        apiKey.setValue(` ${key} `);
        component.settingsForm.markAsDirty();

        await component.form.save(() => component.form.applySavedSettings());

        expect(apiKey.value).toBe(key);
        expect(component.form.changedPaths()).toEqual([]);
        expect(component.settingsForm.pristine).toBe(true);
        expect(settingsStore.updateSettings).toHaveBeenCalledWith(
            { tmdb: {} },
            { retryEpgCleanup: false }
        );
    });

    it('keeps a newly saved key after an unrelated retry with a trimmed-out key edit', async () => {
        const originalKey = 'synthetic-key-a';
        const newKey = 'synthetic-key-b';
        const { apiKey } = component.settingsForm.controls.tmdb.controls;
        settingsStore._setSettings({
            tmdb: { enabled: false, apiKey: originalKey },
        });
        component.form.hydrateFromStore();
        apiKey.setValue(` ${originalKey} `);
        component.settingsForm.markAsDirty();
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        await expect(component.form.save(() => undefined)).rejects.toThrow();

        apiKey.setValue(originalKey);
        settingsStore._setSettings({
            tmdb: { enabled: false, apiKey: newKey },
        });
        settingsStore.savedTmdbApiKey.set(newKey);
        fixture.detectChanges();
        await component.form.save(() => component.form.applySavedSettings());

        expect(apiKey.value).toBe(newKey);
        expect(settingsStore.getSettings().tmdb.apiKey).toBe(newKey);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('keeps a key re-entered after another tab saved a replacement', async () => {
        const original = 'synthetic-original-key';
        const replacement = 'synthetic-replacement-key';
        const { apiKey } = component.settingsForm.controls.tmdb.controls;
        settingsStore._setSettings({
            tmdb: { enabled: false, apiKey: original },
        });
        component.form.hydrateFromStore();
        const submitted = ` ${original} `;
        apiKey.setValue(submitted);
        let finish!: () => void;
        settingsStore.applyNextUpdateThen(
            () => new Promise<void>((resolve) => (finish = resolve))
        );
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );

        settingsStore._setSettings({
            tmdb: { enabled: false, apiKey: replacement },
        });
        settingsStore.savedTmdbApiKey.set(replacement);
        fixture.detectChanges();
        expect(apiKey.value).toBe(replacement);
        apiKey.setValue(submitted);
        finish();
        await saving;

        expect(apiKey.value).toBe(submitted);
        expect(component.form.changedPaths()).toContain('tmdb.apiKey');
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().tmdb.apiKey).toBe(original);
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

    it.each([SAVED_GUIDE, 'https://EXAMPLE.test/saved.xml'])(
        'clears the EPG draft when a backup saves the same sources with %s',
        (savedGuide) => {
            component.form.setEpgUrls(STAGED_GUIDE);
            component.settingsForm.markAsDirty();
            jest.spyOn(component.backup, 'importData').mockImplementation(
                (onImported) => {
                    settingsStore._setSettings({
                        epgUrl: [STAGED_GUIDE, savedGuide],
                    });
                    onImported();
                }
            );

            component.importData();

            expect(component.form.epgUrls).toEqual([STAGED_GUIDE, savedGuide]);
            expect(component.form.changedPaths()).toEqual([]);
            expect(component.settingsForm.pristine).toBe(true);
        }
    );

    it('keeps a staged edit to the literal EPG URL path during backup import', async () => {
        const distinctPath = `${SAVED_GUIDE}/`;
        component.form.removeEpgSource(0);
        component.form.setEpgUrls(distinctPath);

        importBackupAddingGuide(RESTORED_GUIDE);
        expect(component.form.epgUrls).toEqual([distinctPath, RESTORED_GUIDE]);
        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.getSettings().epgUrl).toEqual([
            distinctPath,
            RESTORED_GUIDE,
        ]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('adopts restored EPG order after a pending Save is acknowledged', async () => {
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

        jest.spyOn(component.backup, 'importData').mockImplementation(
            (onImported) => {
                settingsStore._setSettings({
                    epgUrl: [RESTORED_GUIDE, SAVED_GUIDE, STAGED_GUIDE],
                });
                onImported();
            }
        );
        component.importData();
        finishUpdate();
        await saving;

        expect(component.form.epgUrls).toEqual([
            RESTORED_GUIDE,
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it.each(['before', 'after', 'no backup'])(
        'keeps EPG order edits pending Save (restore %s the reorder)',
        async (restoreTiming) => {
            importBackupAddingGuide(STAGED_GUIDE);
            let finishUpdate!: () => void;
            const pending = new Promise<void>((resolve) => {
                finishUpdate = resolve;
            });
            jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
                pending
            );
            component.settingsForm.controls.showCaptions.setValue(true);
            const saving = component.form.save(() =>
                component.form.applySavedSettings()
            );
            await Promise.resolve();

            if (restoreTiming === 'before')
                importBackupAddingGuide(RESTORED_GUIDE);
            component.form.removeEpgSource(0);
            component.form.setEpgUrls(SAVED_GUIDE);
            if (restoreTiming === 'after')
                importBackupAddingGuide(RESTORED_GUIDE);
            const reordered = [STAGED_GUIDE, SAVED_GUIDE];
            if (restoreTiming === 'before')
                reordered.splice(1, 0, RESTORED_GUIDE);
            if (restoreTiming === 'after') reordered.push(RESTORED_GUIDE);
            finishUpdate();
            await saving;

            expect(component.form.epgUrls).toEqual(reordered);
            expect(component.form.changedPaths()).toEqual(['epgUrl']);
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.getSettings().epgUrl).toEqual(reordered);
        }
    );

    it('keeps an unfinished EPG row through Save when no picker is open', async () => {
        component.form.addEpgSource();
        const row = component.form.epgUrl.at(1);
        component.settingsForm.controls.showCaptions.setValue(true);

        await component.form.save(() => component.form.applySavedSettings());

        expect(component.form.epgUrl.at(1) === row).toBe(true);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it('keeps the restored EPG order when the picker is canceled', async () => {
        let acknowledge!: () => void;
        let cancel!: () => void;
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            new Promise<void>((resolve) => (acknowledge = resolve))
        );
        jest.spyOn(
            TestBed.inject(EpgRuntimeBridgeService),
            'pickEpgFile'
        ).mockReturnValueOnce(
            new Promise<null>((resolve) => (cancel = () => resolve(null)))
        );
        component.settingsForm.controls.showCaptions.setValue(true);
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();

        const browsing = component.epg.browse(0);
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (imported) => {
                settingsStore._setSettings({
                    epgUrl: [RESTORED_GUIDE, SAVED_GUIDE],
                });
                imported();
            }
        );
        component.importData();
        acknowledge();
        await saving;
        cancel();
        await browsing;

        expect(component.form.epgUrls).toEqual([RESTORED_GUIDE, SAVED_GUIDE]);
        expect(component.form.changedPaths()).toEqual([]);
        expect(component.settingsForm.pristine).toBe(true);
    });

    it.each(['before', 'after', 'existing'])(
        'keeps the EPG file picker target when the row was present %s Save',
        async (rowTiming) => {
            let acknowledge!: () => void;
            let chooseFile!: (path: string) => void;
            jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
                new Promise<void>((resolve) => (acknowledge = resolve))
            );
            jest.spyOn(
                TestBed.inject(EpgRuntimeBridgeService),
                'pickEpgFile'
            ).mockReturnValueOnce(
                new Promise<string>((resolve) => (chooseFile = resolve))
            );
            if (rowTiming === 'before') component.form.addEpgSource();
            component.settingsForm.controls.showCaptions.setValue(true);
            const saving = component.form.save(() =>
                component.form.applySavedSettings()
            );
            await Promise.resolve();

            if (rowTiming === 'after') component.form.addEpgSource();
            if (rowTiming === 'existing') {
                settingsStore._setSettings({
                    epgUrl: [SAVED_GUIDE, RESTORED_GUIDE],
                });
            }
            const browsing = component.epg.browse(
                rowTiming === 'existing' ? 0 : 1
            );
            acknowledge();
            await saving;
            chooseFile('/example/selected.xml');
            await browsing;

            const expected =
                rowTiming === 'existing'
                    ? ['/example/selected.xml', RESTORED_GUIDE]
                    : [SAVED_GUIDE, '/example/selected.xml'];
            expect(component.form.epgUrls).toEqual(expected);
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.getSettings().epgUrl).toEqual(expected);
        }
    );

    it.each([false, true])(
        'uses the persisted EPG order when a backup prepends a source (edited again: %s)',
        async (editedAgain) => {
            importBackupAddingGuide(STAGED_GUIDE);
            component.form.removeEpgSource(0);
            component.form.setEpgUrls(SAVED_GUIDE);
            let acknowledge!: () => void;
            jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
                new Promise<void>((resolve) => (acknowledge = resolve))
            );
            const saving = component.form.save(() =>
                component.form.applySavedSettings()
            );
            await Promise.resolve();
            expect(settingsStore.getSettings().epgUrl).toEqual([
                STAGED_GUIDE,
                SAVED_GUIDE,
            ]);
            if (editedAgain) {
                component.form.removeEpgSource(0);
                component.form.setEpgUrls(STAGED_GUIDE);
            }
            const restored = [RESTORED_GUIDE, STAGED_GUIDE, SAVED_GUIDE];
            jest.spyOn(component.backup, 'importData').mockImplementation(
                (imported) => {
                    settingsStore._setSettings({ epgUrl: restored });
                    imported();
                }
            );
            component.importData();
            acknowledge();
            await saving;

            expect(component.form.changedPaths()).toEqual(
                editedAgain ? ['epgUrl'] : []
            );
            expect(component.form.epgUrls).toEqual(
                editedAgain
                    ? [SAVED_GUIDE, STAGED_GUIDE, RESTORED_GUIDE]
                    : restored
            );
        }
    );

    it('keeps the order of new sources rearranged during Save and then restored', async () => {
        const extraGuide = 'https://example.test/second-draft.xml';
        component.form.setEpgUrls([STAGED_GUIDE, extraGuide]);
        let finishUpdate!: () => void;
        jest.spyOn(window.electron, 'updateSettings').mockReturnValueOnce(
            new Promise<void>((resolve) => (finishUpdate = resolve))
        );
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        await Promise.resolve();

        component.form.removeEpgSource(1);
        component.form.setEpgUrls(STAGED_GUIDE);
        importBackupAddingGuide(RESTORED_GUIDE);
        const reordered = [
            SAVED_GUIDE,
            extraGuide,
            STAGED_GUIDE,
            RESTORED_GUIDE,
        ];
        expect(component.form.epgUrls).toEqual(reordered);
        finishUpdate();
        await saving;
        expect(component.form.changedPaths()).toEqual(['epgUrl']);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual(reordered);
    });

    it.each(['EPG cleanup', 'Electron acknowledgement'])(
        'preserves a source restored after its removal was persisted during %s',
        async (pendingStage) => {
            let finish!: () => void;
            const pending = new Promise<void>((resolve) => {
                finish = resolve;
            });
            if (pendingStage === 'EPG cleanup') {
                settingsStore.applyNextUpdateThen(() => pending);
            } else {
                jest.spyOn(
                    window.electron,
                    'updateSettings'
                ).mockReturnValueOnce(pending);
            }

            component.form.removeEpgSource(0);
            const saving = component.form.save(() =>
                component.form.applySavedSettings()
            );
            await Promise.resolve();
            expect(settingsStore.getSettings().epgUrl).toEqual([]);

            importBackupAddingGuide(SAVED_GUIDE);
            finish();
            await saving;

            expect(component.form.epgUrls).toEqual([SAVED_GUIDE]);
            expect(component.settingsForm.pristine).toBe(true);
            component.settingsForm.controls.showCaptions.setValue(true);
            component.settingsForm.markAsDirty();
            await component.form.save(() =>
                component.form.applySavedSettings()
            );
            expect(settingsStore.getSettings().epgUrl).toEqual([SAVED_GUIDE]);
        }
    );

    it('keeps an EPG addition staged after a playlist-only import and a rolled-back write', async () => {
        jest.spyOn(settingsStore, 'getCommittedEpgUrls').mockReturnValueOnce([
            SAVED_GUIDE,
        ]);
        let failWrite!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(async (patch) => {
            settingsStore._setSettings({ epgUrl: patch['epgUrl'] as string[] });
            await new Promise<void>((resolve) => (failWrite = resolve));
            settingsStore._setSettings({ epgUrl: [SAVED_GUIDE] });
            throw new Error('storage unavailable');
        });
        component.form.setEpgUrls(STAGED_GUIDE);
        const saving = component.form.save(() => undefined);
        jest.spyOn(component.backup, 'importData').mockImplementation((done) =>
            done()
        );
        component.importData();
        failWrite();
        await expect(saving).rejects.toThrow('storage unavailable');

        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, STAGED_GUIDE]);
        expect(component.form.changedPaths()).toContain('epgUrl');
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
    });

    it('keeps an EPG removal staged after a playlist-only import and a rolled-back write', async () => {
        jest.spyOn(settingsStore, 'getCommittedEpgUrls').mockReturnValueOnce([
            SAVED_GUIDE,
        ]);
        let failWrite!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(async () => {
            settingsStore._setSettings({ epgUrl: [] });
            await new Promise<void>((resolve) => (failWrite = resolve));
            settingsStore._setSettings({ epgUrl: [SAVED_GUIDE] });
            throw new Error('storage unavailable');
        });
        component.form.removeEpgSource(0);
        const saving = component.form.save(() => undefined);
        jest.spyOn(component.backup, 'importData').mockImplementation((done) =>
            done()
        );
        component.importData();
        failWrite();
        await expect(saving).rejects.toThrow('storage unavailable');

        expect(component.form.changedPaths()).toContain('epgUrl');
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([]);
    });

    it('keeps removal of a saved source after a playlist-only import and a failed retry', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);

        component.form.removeEpgSource(1);
        let failWrite!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(async (patch) => {
            settingsStore._setSettings(patch);
            await new Promise<void>((resolve) => (failWrite = resolve));
            settingsStore._setSettings({ epgUrl: [SAVED_GUIDE, STAGED_GUIDE] });
            throw new Error('storage unavailable');
        });
        const saving = component.form.save(() => undefined);
        jest.spyOn(component.backup, 'importData').mockImplementation((done) =>
            done()
        );
        component.importData();
        failWrite();
        await expect(saving).rejects.toThrow('storage unavailable');

        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([SAVED_GUIDE]);
    });

    it('keeps a restored source removal when the earlier EPG write commits', async () => {
        let completeImport!: () => void;
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (imported) => {
                settingsStore._setSettings({
                    epgUrl: [RESTORED_GUIDE, SAVED_GUIDE],
                });
                completeImport = imported;
            }
        );
        component.importData();
        let persist!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(
            async (patch, _options, onPersisted) => {
                settingsStore._setSettings(patch);
                await new Promise<void>((resolve) => (persist = resolve));
                onPersisted?.();
            }
        );
        component.form.setEpgUrls(STAGED_GUIDE);
        const saving = component.form.save(() =>
            component.form.applySavedSettings()
        );
        completeImport();
        expect(component.form.epgUrls).toContain(RESTORED_GUIDE);
        component.form.removeEpgSource(
            component.form.epgUrls.indexOf(RESTORED_GUIDE)
        );
        persist();
        await saving;

        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, STAGED_GUIDE]);
        expect(component.form.changedPaths()).toEqual(['epgUrl']);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
    });

    it('keeps a second EPG removal when a restore finishes during Save retry', async () => {
        jest.spyOn(window.electron, 'updateSettings').mockRejectedValueOnce(
            new Error('runtime unavailable')
        );
        component.form.removeEpgSource(0);
        await expect(component.form.save(() => undefined)).rejects.toThrow();
        expect(settingsStore.getSettings().epgUrl).toEqual([]);

        let completeImport!: () => void;
        jest.spyOn(component.backup, 'importData').mockImplementation(
            (imported) => {
                settingsStore._setSettings({ epgUrl: [SAVED_GUIDE] });
                completeImport = imported;
            }
        );
        component.importData();

        let persist!: () => void;
        settingsStore.updateSettings.mockImplementationOnce(
            async (patch, _options, onPersisted) => {
                settingsStore._setSettings(patch);
                await new Promise<void>((resolve) => (persist = resolve));
                onPersisted?.();
            }
        );
        const retry = component.form.save(() =>
            component.form.applySavedSettings()
        );
        completeImport();
        expect(component.form.epgUrls).toEqual([SAVED_GUIDE]);
        component.form.removeEpgSource(0);
        persist();
        await retry;

        expect(component.form.epgUrls).toEqual([]);
        expect(component.form.changedPaths()).toEqual(['epgUrl']);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([]);
    });

    it('keeps a removal of a source restored while Save is pending', async () => {
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

        importBackupAddingGuide(RESTORED_GUIDE);
        component.form.removeEpgSource(2);
        finishUpdate();
        await saving;

        expect(component.form.epgUrls).toEqual([SAVED_GUIDE, STAGED_GUIDE]);
        expect(component.form.changedPaths()).toEqual(['epgUrl']);
        expect(component.settingsForm.dirty).toBe(true);
        await component.form.save(() => component.form.applySavedSettings());
        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
        ]);
    });

    it('keeps staged and restored EPG request paths that differ by a slash', async () => {
        const restored = `${STAGED_GUIDE}/`;
        component.form.setEpgUrls(STAGED_GUIDE);
        component.settingsForm.markAsDirty();

        importBackupAddingGuide(restored);
        await component.form.save(() => component.form.applySavedSettings());

        expect(settingsStore.getSettings().epgUrl).toEqual([
            SAVED_GUIDE,
            STAGED_GUIDE,
            restored,
        ]);
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
