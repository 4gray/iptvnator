import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import {
    Language,
    StartupBehavior,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { TranslateService } from '@ngx-translate/core';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsComponent } from './settings.component';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    DEFAULT_DASHBOARD_RAILS,
    DEFAULT_SETTINGS,
    MatSnackBarStub,
    MockSettingsStore,
    setSettingsSection,
    stubSettingsSideEffects,
} from './test-stubs/settings-test-harness.stub';

/**
 * Everything the rendered settings form does: hydration from the store, the
 * section outputs that write straight through, and the submit path.
 */
describe('SettingsComponent form', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let settingsStore: MockSettingsStore;
    let translate: TranslateService;
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
        translate = TestBed.inject(TranslateService);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;

        component = fixture.componentInstance;
        stubSettingsSideEffects(component);
        fixture.detectChanges();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('stages the desktop portal pause setting until Save', async () => {
        const checkbox = (fixture.nativeElement as HTMLElement).querySelector(
            '[data-test-id="portal-connectivity-toggle"] input'
        ) as HTMLInputElement;
        expect(checkbox).not.toBeNull();
        expect(checkbox.checked).toBe(true);
        checkbox.click();
        fixture.detectChanges();
        expect(
            component.settingsForm.get('portalConnectivityGuard')?.value
        ).toBe(false);
        expect(window.electron.updateSettings).not.toHaveBeenCalled();
        component.form.hydrateFromStore();
        fixture.detectChanges();
        expect(checkbox.checked).toBe(true);
        checkbox.click();
        await component.form.save(() => undefined);
        expect(window.electron.updateSettings).toHaveBeenCalledWith(
            expect.objectContaining({ portalConnectivityGuard: false })
        );
    });

    it('hides the portal pause setting when the desktop bridge is unavailable', () => {
        fixture.destroy();
        window.electron = undefined;
        fixture = TestBed.createComponent(SettingsComponent);
        fixture.detectChanges();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[data-test-id="portal-connectivity-setting"]'
            )
        ).toBeNull();
    });

    describe('Get and set settings on component init', () => {
        const settings = {
            language: Language.GERMAN,
            player: VideoPlayer.Html5Player,
            theme: Theme.DarkTheme,
        };

        it('should init default settings if previous config was not saved', async () => {
            await component.ngOnInit();

            expect(component.settingsForm.value).toEqual(DEFAULT_SETTINGS);
        });

        it('should get and apply custom settings', () => {
            settingsStore._setSettings({
                ...DEFAULT_SETTINGS,
                ...settings,
            });

            component.form.hydrateFromStore();

            expect(component.settingsForm.value).toEqual({
                ...DEFAULT_SETTINGS,
                ...settings,
            });
        });

        it('hydrates a shared web controls opt-out from the settings store', () => {
            settingsStore._setSettings({
                webPlayerSharedControls: false,
            });

            component.form.hydrateFromStore();

            expect(
                component.settingsForm.get('webPlayerSharedControls')?.value
            ).toBe(false);
        });
    });

    describe('Section outputs', () => {
        it('updates the selected theme through the general section and marks the form dirty', () => {
            const darkThemeButton = (
                fixture.nativeElement as HTMLElement
            ).querySelector('[data-test-id="DARK_THEME"]') as HTMLButtonElement;

            darkThemeButton.click();
            fixture.detectChanges();

            expect(component.settingsForm.value.theme).toBe(Theme.DarkTheme);
            expect(component.settingsForm.dirty).toBeTruthy();
        });

        it('stages cover size without writing to the store until Save', () => {
            const largeCoverButton = (
                fixture.nativeElement as HTMLElement
            ).querySelector(
                '[data-test-id="cover-size-large"]'
            ) as HTMLButtonElement;

            largeCoverButton.click();
            fixture.detectChanges();

            expect(component.settingsForm.value.coverSize).toBe('large');
            expect(component.settingsForm.dirty).toBe(true);
            // An eager write here would make Discard unable to revert it
            expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        });

        it('stages the EPG view mode without writing to the store until Save', () => {
            setSettingsSection('epg');
            fixture.detectChanges();

            const listButton = (
                fixture.nativeElement as HTMLElement
            ).querySelector(
                '[data-test-id="epg-view-mode-list"]'
            ) as HTMLButtonElement;

            listButton.click();
            fixture.detectChanges();

            expect(component.settingsForm.value.epgViewMode).toBe('list');
            expect(component.settingsForm.dirty).toBe(true);
            expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        });
    });

    describe('Dashboard controls', () => {
        it('renders dashboard controls with the expected defaults', () => {
            setSettingsSection('dashboard');
            fixture.detectChanges();

            const nativeElement = fixture.nativeElement as HTMLElement;

            expect(
                nativeElement.querySelector(
                    '[data-test-id="toggle-show-dashboard"]'
                )
            ).not.toBeNull();
            expect(
                nativeElement.querySelector(
                    '[data-test-id="toggle-dashboard-hero"]'
                )
            ).not.toBeNull();
            expect(
                nativeElement.querySelector(
                    '[data-test-id="toggle-dashboard-rail-live-favorites"]'
                )
            ).not.toBeNull();
            expect(
                nativeElement.querySelector(
                    '[data-test-id="toggle-dashboard-rail-recently-watched-live"]'
                )
            ).not.toBeNull();
            expect(
                nativeElement.querySelector(
                    '[data-test-id="toggle-dashboard-rail-favorite-movies-and-series"]'
                )
            ).not.toBeNull();
            expect(component.settingsForm.value.showDashboard).toBe(true);
            expect(component.settingsForm.value.dashboardRails).toEqual(
                DEFAULT_DASHBOARD_RAILS
            );
            expect(component.settingsForm.value.startupBehavior).toBe(
                StartupBehavior.FirstView
            );
            expect(component.settingsForm.value.startupWindowMode).toBe(
                'normal'
            );
        });

        it('disables dashboard surface controls when the dashboard is off', async () => {
            const showDashboard = component.settingsForm.get('showDashboard');
            const dashboardRails = component.settingsForm.get('dashboardRails');

            showDashboard?.setValue(false);
            await fixture.whenStable();

            expect(dashboardRails?.disabled).toBe(true);
            expect(
                component.settingsForm.get('dashboardRails.hero')?.disabled
            ).toBe(true);
            expect(
                component.settingsForm.get('dashboardRails.continueWatching')
                    ?.disabled
            ).toBe(true);

            showDashboard?.setValue(true);
            await fixture.whenStable();

            expect(dashboardRails?.enabled).toBe(true);
            expect(
                component.settingsForm.get('dashboardRails.hero')?.enabled
            ).toBe(true);
        });
    });

    describe('Unsaved-changes bar', () => {
        const unsavedBar = () =>
            (fixture.nativeElement as HTMLElement).querySelector(
                '[data-test-id="settings-unsaved-bar"]'
            );

        it('stays hidden while the form is pristine', () => {
            expect(unsavedBar()).toBeNull();
        });

        it('appears once an edit lands and survives a section switch', () => {
            component.settingsForm.get('theme')?.setValue(Theme.DarkTheme);
            component.settingsForm.markAsDirty();
            fixture.detectChanges();

            expect(unsavedBar()).not.toBeNull();

            // The form lives on the page component, not the section pages —
            // moving to another section must not swallow the pending edit.
            setSettingsSection('about');
            fixture.detectChanges();

            expect(unsavedBar()).not.toBeNull();
            expect(component.settingsForm.dirty).toBe(true);
        });

        it('hides again after a successful save', async () => {
            settingsStore.updateSettings.mockResolvedValue(undefined);
            component.settingsForm.get('theme')?.setValue(Theme.DarkTheme);
            component.settingsForm.markAsDirty();
            fixture.detectChanges();

            component.onSubmit();
            await fixture.whenStable();
            fixture.detectChanges();

            expect(component.settingsForm.pristine).toBe(true);
            expect(unsavedBar()).toBeNull();
        });

        it('discard reverts a staged cover size (regression: eager persist made it stick)', () => {
            const largeCoverButton = (
                fixture.nativeElement as HTMLElement
            ).querySelector(
                '[data-test-id="cover-size-large"]'
            ) as HTMLButtonElement;
            largeCoverButton.click();
            fixture.detectChanges();
            expect(component.settingsForm.value.coverSize).toBe('large');

            component.discardChanges();

            expect(component.settingsForm.value.coverSize).toBe('medium');
            expect(component.settingsForm.pristine).toBe(true);
            expect(settingsStore.updateSettings).not.toHaveBeenCalled();
        });

        it('discard reverts to the stored values and hides the bar', () => {
            const storedTheme = component.settingsForm.value.theme;
            component.settingsForm.get('theme')?.setValue(Theme.DarkTheme);
            component.settingsForm.markAsDirty();
            fixture.detectChanges();

            component.discardChanges();
            fixture.detectChanges();

            expect(component.settingsForm.value.theme).toBe(storedTheme);
            expect(component.settingsForm.pristine).toBe(true);
            expect(unsavedBar()).toBeNull();
        });
    });

    describe('Saving', () => {
        it('shows the save confirmation snackbar at the bottom center with the settings offset class', () => {
            jest.spyOn(translate, 'instant').mockReturnValue('Settings saved');

            component.applyChangedSettings();

            expect(snackBar.open).toHaveBeenCalledWith(
                'Settings saved',
                undefined,
                {
                    duration: 2000,
                    horizontalPosition: 'center',
                    panelClass: ['settings-snackbar'],
                    verticalPosition: 'bottom',
                }
            );
        });

        it('should save settings on submit', async () => {
            settingsStore.updateSettings.mockResolvedValue(undefined);
            const updateSettings = jest.spyOn(
                window.electron,
                'updateSettings'
            );

            component.onSubmit();
            await fixture.whenStable();

            expect(settingsStore.updateSettings).toHaveBeenCalledWith({
                ...component.settingsForm.value,
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
            });
            expect(updateSettings).toHaveBeenCalledWith({
                ...component.settingsForm.value,
                trustedPrivateNetworkEpgUrls: [],
                trustedInsecureTlsHosts: [],
            });
        });

        it('saves a shared web controls opt-out on submit', async () => {
            settingsStore.updateSettings.mockResolvedValue(undefined);
            component.settingsForm
                .get('webPlayerSharedControls')
                ?.setValue(false);

            component.onSubmit();
            await fixture.whenStable();

            expect(settingsStore.updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    webPlayerSharedControls: false,
                })
            );
        });

        it('clears external player paths in Electron when saved as empty', async () => {
            settingsStore.updateSettings.mockResolvedValue(undefined);
            const setMpvPlayerPath = jest.spyOn(
                window.electron,
                'setMpvPlayerPath'
            );
            const setVlcPlayerPath = jest.spyOn(
                window.electron,
                'setVlcPlayerPath'
            );

            component.settingsForm.patchValue({
                mpvPlayerPath: '',
                vlcPlayerPath: '',
            });

            component.onSubmit();
            await fixture.whenStable();

            expect(setMpvPlayerPath).toHaveBeenCalledWith('');
            expect(setVlcPlayerPath).toHaveBeenCalledWith('');
        });

        it('saves external player command-line arguments with the settings payload', async () => {
            settingsStore.updateSettings.mockResolvedValue(undefined);
            const updateSettings = jest.spyOn(
                window.electron,
                'updateSettings'
            );

            component.settingsForm.patchValue({
                mpvPlayerArguments: '--screen=1\n--geometry=1280x720',
                vlcPlayerArguments: '--qt-fullscreen-screennumber=1',
            });

            component.onSubmit();
            await fixture.whenStable();

            expect(settingsStore.updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    mpvPlayerArguments: '--screen=1\n--geometry=1280x720',
                    vlcPlayerArguments: '--qt-fullscreen-screennumber=1',
                })
            );
            expect(updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    mpvPlayerArguments: '--screen=1\n--geometry=1280x720',
                    vlcPlayerArguments: '--qt-fullscreen-screennumber=1',
                })
            );
        });

        it('preserves saved EPG settings when saving from the web settings form', async () => {
            fixture.destroy();
            window.electron = undefined as unknown as typeof window.electron;

            settingsStore._setSettings({
                epgUrl: ['https://example.com/guide.xml'],
                preferUploadedEpgOverXtream: true,
            });
            settingsStore.updateSettings.mockResolvedValue(undefined);

            const webFixture = TestBed.createComponent(SettingsComponent);
            const webComponent = webFixture.componentInstance;
            stubSettingsSideEffects(webComponent);
            webFixture.detectChanges();
            await webFixture.whenStable();

            webComponent.settingsForm.patchValue({ theme: Theme.DarkTheme });
            webComponent.onSubmit();
            await webFixture.whenStable();

            expect(settingsStore.updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    epgUrl: ['https://example.com/guide.xml'],
                    preferUploadedEpgOverXtream: true,
                    theme: Theme.DarkTheme,
                })
            );

            webFixture.destroy();
        });
    });
});
