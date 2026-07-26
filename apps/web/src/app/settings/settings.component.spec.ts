import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    EmbeddedMpvSupport,
    PlaylistMeta,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { MockStore } from '@ngrx/store/testing';
import { SettingsComponent } from './settings.component';
import { SettingsSectionScrollDirective } from './settings-section-scroll.directive';
import {
    configureSettingsComponentTestBed,
    createElectronStub,
    createEpgBridgeStub,
    createPlaylistMeta,
    DEFAULT_SETTINGS,
    stubSettingsSideEffects,
} from './settings-test-harness.stub';

interface SettingsSectionScrollDirectiveTestApi {
    getScrollRoot(): HTMLElement | null;
}

/**
 * Page-shell behaviour: chrome, section navigation and the runtime
 * capabilities that decide which sections and players are offered. Form
 * editing and saving live in `settings.component.form.spec.ts`, and the
 * per-section behaviour in the matching `*.facade.spec.ts` files.
 */
describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let router: Router;
    let mockStore: MockStore;
    let epgBridge: Partial<EpgRuntimeBridgeService>;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        epgBridge = createEpgBridgeStub();
        configureSettingsComponentTestBed(epgBridge);
    }));

    beforeEach(() => {
        window.electron = createElectronStub();

        fixture = TestBed.createComponent(SettingsComponent);
        router = TestBed.inject(Router);
        mockStore = TestBed.inject(MockStore);

        component = fixture.componentInstance;
        stubSettingsSideEffects(component);
        fixture.detectChanges();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    function setPlaylists(playlists: PlaylistMeta[]): void {
        mockStore.overrideSelector(selectAllPlaylistsMeta, playlists);
        mockStore.refreshState();
        fixture.detectChanges();
    }

    it('should create and init component', () => {
        expect(component).toBeTruthy();
    });

    it('should render a compact page header outside dialog mode', () => {
        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(
            nativeElement.querySelector('[data-test-id="settings-page-header"]')
        ).not.toBeNull();
        expect(nativeElement.querySelector('.settings-intro')).toBeNull();
    });

    it('should not render the page header in dialog mode', () => {
        fixture.destroy();

        const dialogFixture = TestBed.createComponent(SettingsComponent);
        const dialogComponent = dialogFixture.componentInstance;

        stubSettingsSideEffects(dialogComponent);
        dialogComponent.isDialog = true;
        dialogFixture.detectChanges();

        const nativeElement = dialogFixture.nativeElement as HTMLElement;
        expect(
            nativeElement.querySelector('[data-test-id="settings-page-header"]')
        ).toBeNull();
        expect(
            nativeElement.querySelector('h2[mat-dialog-title]')
        ).not.toBeNull();
    });

    it('should navigate back to home page', () => {
        jest.spyOn(router, 'navigateByUrl');
        component.backToHome();
        expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('enables the global wipe action only once a playlist exists', () => {
        const deleteButton = () =>
            (fixture.nativeElement as HTMLElement).querySelector(
                '.danger-zone__button'
            ) as HTMLButtonElement | null;

        setPlaylists([]);

        expect(component.playlistReset.canRemoveAll()).toBe(false);
        expect(deleteButton()?.disabled).toBe(true);

        setPlaylists([createPlaylistMeta({ _id: 'm3u-1' })]);

        expect(component.playlistReset.canRemoveAll()).toBe(true);
        expect(deleteButton()?.disabled).toBe(false);
    });

    it('should scroll the selected navigation target within the workspace viewport', async () => {
        fixture.destroy();
        jest.useFakeTimers();

        try {
            const scrollFixture = TestBed.createComponent(SettingsComponent);
            const scrollComponent = scrollFixture.componentInstance;
            const settingsContext = TestBed.inject(SettingsContextService);
            const originalGetElementById =
                document.getElementById.bind(document);
            const scrollTo = jest.fn();
            const scrollRoot = {
                scrollTop: 96,
                clientHeight: 885,
                scrollHeight: 2469,
                getBoundingClientRect: () =>
                    ({
                        top: 56,
                    }) as DOMRect,
                scrollTo,
            } as unknown as HTMLElement;

            stubSettingsSideEffects(scrollComponent);
            scrollFixture.detectChanges();
            const scrollDirective = scrollFixture.debugElement
                .query(By.directive(SettingsSectionScrollDirective))
                .injector.get(SettingsSectionScrollDirective);
            jest.spyOn(
                scrollDirective as unknown as SettingsSectionScrollDirectiveTestApi,
                'getScrollRoot'
            ).mockReturnValue(scrollRoot);

            const getElementByIdSpy = jest
                .spyOn(document, 'getElementById')
                .mockImplementation((id: string) => {
                    if (id === 'about') {
                        return {
                            getBoundingClientRect: () =>
                                ({
                                    top: 2050,
                                    height: 159,
                                }) as DOMRect,
                        } as HTMLElement;
                    }

                    return originalGetElementById(id);
                });

            await scrollFixture.whenStable();
            scrollFixture.detectChanges();
            settingsContext.navigateToSection('about');
            scrollFixture.detectChanges();

            expect(getElementByIdSpy).toHaveBeenCalledWith('about');
            expect(scrollTo).toHaveBeenCalledWith({
                behavior: 'smooth',
                top: 1488,
            });
            expect(settingsContext.pendingScrollTarget()).toBe('about');

            jest.advanceTimersByTime(600);

            expect(settingsContext.pendingScrollTarget()).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    describe('Runtime capabilities', () => {
        it('hides the embedded mpv option when the desktop support probe reports unsupported', async () => {
            window.electron = {
                ...window.electron,
                getEmbeddedMpvSupport: jest.fn().mockResolvedValue({
                    supported: false,
                    platform: 'darwin',
                    reason: 'hidden harness',
                }),
            } as unknown as typeof window.electron;

            await component.ngOnInit();
            await fixture.whenStable();

            expect(
                component
                    .players()
                    .some((player) => player.id === VideoPlayer.EmbeddedMpv)
            ).toBe(false);
        });

        it.each(['darwin', 'win32', 'linux'] as const)(
            'shows the embedded mpv option when the %s desktop support probe reports supported',
            async (platform) => {
                window.electron = {
                    ...window.electron,
                    getEmbeddedMpvSupport: jest.fn().mockResolvedValue({
                        supported: true,
                        platform,
                    }),
                } as unknown as typeof window.electron;

                await component.ngOnInit();
                await fixture.whenStable();

                expect(
                    component
                        .players()
                        .some((player) => player.id === VideoPlayer.EmbeddedMpv)
                ).toBe(true);
            }
        );

        it('does not block settings initialization while embedded mpv support is pending', async () => {
            let resolveSupport:
                ((value: EmbeddedMpvSupport) => void) | undefined;
            window.electron = {
                ...window.electron,
                getEmbeddedMpvSupport: jest.fn(
                    () =>
                        new Promise((resolve) => {
                            resolveSupport = resolve;
                        })
                ),
            } as unknown as typeof window.electron;

            await expect(component.ngOnInit()).resolves.toBeUndefined();

            expect(component.settingsForm.value).toEqual(DEFAULT_SETTINGS);
            expect(window.electron.getEmbeddedMpvSupport).toHaveBeenCalled();
            expect(
                component
                    .players()
                    .some((player) => player.id === VideoPlayer.EmbeddedMpv)
            ).toBe(false);

            if (!resolveSupport) {
                throw new Error('Expected embedded MPV support probe to start');
            }

            resolveSupport({
                supported: true,
                platform: 'darwin',
            });
            await fixture.whenStable();

            expect(
                component
                    .players()
                    .some((player) => player.id === VideoPlayer.EmbeddedMpv)
            ).toBe(true);
        });

        it('hides external player path settings when the Electron bridge is incomplete', () => {
            fixture.destroy();
            epgBridge.supportsImport = false;
            window.electron = {
                getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
                platform: 'linux',
                updateSettings: jest.fn().mockResolvedValue(undefined),
            } as unknown as typeof window.electron;

            const partialBridgeFixture =
                TestBed.createComponent(SettingsComponent);
            const partialBridgeComponent =
                partialBridgeFixture.componentInstance;
            stubSettingsSideEffects(partialBridgeComponent);
            partialBridgeFixture.detectChanges();

            expect(partialBridgeComponent.isDesktop).toBe(true);
            expect(partialBridgeComponent.supportsManagedExternalPlayers).toBe(
                false
            );
            expect(
                partialBridgeComponent.supportsExternalPlayerPathSettings
            ).toBe(false);
            expect(partialBridgeComponent.supportsEpg).toBe(false);
            expect(partialBridgeComponent.supportsRemoteControl).toBe(false);
            expect(
                partialBridgeComponent.settingsForm.get('epgUrl')
            ).toBeNull();
            expect(
                partialBridgeComponent.sectionNav.find(
                    (section) => section.id === 'epg'
                )
            ).toBeUndefined();
            expect(
                partialBridgeComponent.sectionNav.find(
                    (section) => section.id === 'remote-control'
                )
            ).toBeUndefined();
            expect(
                partialBridgeComponent
                    .players()
                    .some((player) => player.id === VideoPlayer.MPV)
            ).toBe(false);
            expect(
                partialBridgeComponent
                    .players()
                    .some((player) => player.id === VideoPlayer.VLC)
            ).toBe(false);
        });

        it('keeps external player choices when launch support exists without path settings', () => {
            fixture.destroy();
            window.electron = {
                getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
                openInMpv: jest.fn(),
                openInVlc: jest.fn(),
                platform: 'linux',
                updateSettings: jest.fn().mockResolvedValue(undefined),
            } as unknown as typeof window.electron;

            const launchOnlyBridgeFixture =
                TestBed.createComponent(SettingsComponent);
            const launchOnlyBridgeComponent =
                launchOnlyBridgeFixture.componentInstance;
            stubSettingsSideEffects(launchOnlyBridgeComponent);
            launchOnlyBridgeFixture.detectChanges();

            expect(
                launchOnlyBridgeComponent.supportsManagedExternalPlayers
            ).toBe(true);
            expect(
                launchOnlyBridgeComponent.supportsExternalPlayerPathSettings
            ).toBe(false);
            expect(
                launchOnlyBridgeComponent
                    .players()
                    .some((player) => player.id === VideoPlayer.MPV)
            ).toBe(true);
            expect(
                launchOnlyBridgeComponent
                    .players()
                    .some((player) => player.id === VideoPlayer.VLC)
            ).toBe(true);
        });

        it('opens the playlist folder picker only when the desktop bridge offers one', async () => {
            const selectFolder = jest.fn().mockResolvedValue('/tmp/recordings');
            window.electron = {
                ...window.electron,
                selectEmbeddedMpvRecordingFolder: selectFolder,
            } as unknown as typeof window.electron;

            await component.selectRecordingFolder();

            expect(selectFolder).toHaveBeenCalled();
            expect(component.settingsForm.value.recordingFolder).toBe(
                '/tmp/recordings'
            );
            expect(component.settingsForm.dirty).toBe(true);
        });
    });
});
