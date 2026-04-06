import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import {
    FormsModule,
    ReactiveFormsModule,
    UntypedFormBuilder,
} from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { Store } from '@ngrx/store';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import {
    MockModule,
    MockProvider,
} from 'ng-mocks';
import { DialogService } from 'components';
import { DataService, PlaylistsService } from 'services';
import {
    Language,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from 'shared-interfaces';
import { SettingsComponent } from './settings.component';

import { signal } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { from, of, Subject } from 'rxjs';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import { PlaylistActions } from 'm3u-state';

class MatSnackBarStub {
    open = jest.fn();
}

export class MockRouter {
    navigateByUrl(url: string): string {
        return url;
    }
}

const DEFAULT_SETTINGS = {
    player: VideoPlayer.VideoJs,
    streamFormat: StreamFormat.M3u8StreamFormat,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    showExternalPlaybackBar: true,
    theme: Theme.SystemTheme,
    mpvPlayerPath: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
    remoteControl: false,
    remoteControlPort: 8765,
    epgUrl: [],
};

class MockSettingsStore {
    private _settings = signal(DEFAULT_SETTINGS);

    getSettings = () => this._settings();

    loadSettings = jest.fn().mockResolvedValue(undefined);

    updateSettings = jest.fn().mockResolvedValue(undefined);

    // Helper method for tests to modify settings
    _setSettings(newSettings: Partial<typeof DEFAULT_SETTINGS>) {
        this._settings.set({
            ...this._settings(),
            ...newSettings,
        });
    }
}

class MockSettingsService {
    getAppVersion = jest
        .fn()
        .mockReturnValue(from(Promise.resolve('1.0.0')));
    changeTheme = jest.fn();
    isVersionOutdated = jest
        .fn()
        .mockImplementation((currentVersion: string, latestVersion: string) =>
            currentVersion.localeCompare(latestVersion, undefined, {
                numeric: true,
                sensitivity: 'base',
            }) < 0
        );
}

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: DataService;
    let router: Router;
    let settingsStore: unknown;
    let translate: TranslateService;
    let epgService: EpgService;
    let dialogService: DialogService;
    let playlistsService: PlaylistsService;
    let store: Store;
    let snackBar: MatSnackBarStub;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            providers: [
                UntypedFormBuilder,
                { provide: SettingsStore, useClass: MockSettingsStore },
                MockProvider(EpgService, {
                    fetchEpg: jest.fn(),
                }),
                MockProvider(DialogService, {
                    openConfirmDialog: jest.fn(),
                }),
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                {
                    provide: Router,
                    useClass: MockRouter,
                },
                provideMockStore(),
                {
                    provide: NgxIndexedDBService,
                    useValue: {},
                },
                MockProvider(PlaylistsService, {
                    getAllData: jest.fn().mockReturnValue(of([])),
                    removeAll: jest.fn(),
                }),
            ],
            imports: [
                SettingsComponent,
                HttpClientTestingModule,
                FormsModule,
                MockModule(MatSelectModule),
                MockModule(MatIconModule),
                MockModule(MatTooltipModule),
                ReactiveFormsModule,
                MockModule(RouterTestingModule),
                MockModule(MatCardModule),
                MockModule(MatListModule),
                MockModule(MatFormFieldModule),
                MockModule(MatCheckboxModule),
                MockModule(MatDividerModule),
                TranslateModule.forRoot(),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        window.electron = {
            checkEpgFreshness: jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: [],
            }),
            clearEpgData: jest.fn().mockResolvedValue({ success: true }),
            getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
            getLocalIpAddresses: jest.fn().mockResolvedValue([]),
            platform: 'linux',
            setMpvPlayerPath: jest.fn().mockResolvedValue(undefined),
            setVlcPlayerPath: jest.fn().mockResolvedValue(undefined),
            updateSettings: jest.fn().mockResolvedValue(undefined),
        } as unknown as typeof window.electron;

        fixture = TestBed.createComponent(SettingsComponent);
        electronService = TestBed.inject(DataService);
        settingsStore = TestBed.inject(SettingsStore);
        router = TestBed.inject(Router);
        translate = TestBed.inject(TranslateService);
        epgService = TestBed.inject(EpgService);
        dialogService = TestBed.inject(DialogService);
        playlistsService = TestBed.inject(PlaylistsService);
        store = TestBed.inject(Store);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;

        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

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

        dialogComponent.checkAppVersion = jest.fn();
        dialogComponent.fetchLocalIpAddresses = jest
            .fn()
            .mockResolvedValue(undefined);
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

    it('should scroll the selected navigation target within the workspace viewport', async () => {
        fixture.destroy();
        jest.useFakeTimers();

        try {
            const scrollFixture = TestBed.createComponent(SettingsComponent);
            const scrollComponent = scrollFixture.componentInstance;
            const settingsContext = TestBed.inject(SettingsContextService);
            const originalGetElementById = document.getElementById.bind(
                document
            );
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

            scrollComponent.checkAppVersion = jest.fn();
            scrollComponent.fetchLocalIpAddresses = jest
                .fn()
                .mockResolvedValue(undefined);
            jest.spyOn(scrollComponent as any, 'getScrollRoot').mockReturnValue(
                scrollRoot
            );
            scrollFixture.detectChanges();

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

    describe('Get and set settings on component init', () => {
        const settings = {
            language: Language.GERMAN,
            player: VideoPlayer.Html5Player,
            theme: Theme.DarkTheme,
        };

        it('should init default settings if previous config was not saved', async () => {
            await component.ngOnInit();
            //expect(settingsStore.loadSettings).toHaveBeenCalled();
            expect(component.settingsForm.value).toEqual(DEFAULT_SETTINGS);
        });

        it('should get and apply custom settings', async () => {
            const mockStore = settingsStore as unknown as MockSettingsStore;
            mockStore._setSettings({
                ...DEFAULT_SETTINGS,
                ...settings,
            });

            component.setSettings();

            //expect(settingsStore.loadSettings).toHaveBeenCalled();
            expect(component.settingsForm.value).toEqual({
                ...DEFAULT_SETTINGS,
                ...settings,
            });
        });
    });

    describe('Version check', () => {
        const latestVersion = '1.0.0';
        const currentVersion = '0.1.0';

        beforeEach(() => {
            const settingsService = TestBed.inject(SettingsService);
            (settingsService.getAppVersion as jest.Mock).mockReturnValue(
                of(latestVersion)
            );

            // Add translation mock
            jest.spyOn(translate, 'instant').mockImplementation((key) => {
                if (key === 'SETTINGS.NEW_VERSION_AVAILABLE') {
                    return 'New version available';
                }
                if (key === 'SETTINGS.LATEST_VERSION') {
                    return 'Latest version installed';
                }
                return key;
            });
        });

        it('should return true if version is outdated', () => {
            jest.spyOn(electronService, 'getAppVersion').mockReturnValue(
                currentVersion
            );
            const isOutdated =
                component.isCurrentVersionOutdated(latestVersion);
            expect(isOutdated).toBeTruthy();
        });

        it('should update notification message if version is outdated', () => {
            jest.spyOn(translate, 'instant');
            jest.spyOn(electronService, 'getAppVersion').mockReturnValue(
                currentVersion
            );
            component.showVersionInformation(latestVersion);
            expect(translate.instant).toHaveBeenCalledWith(
                'SETTINGS.NEW_VERSION_AVAILABLE'
            );
            expect(component.updateMessage).toBe(
                'New version available: 1.0.0'
            );
        });
    });

    it('removes all playlists with a busy state and dispatches store cleanup after success', async () => {
        const removal$ = new Subject<void>();
        const dispatchSpy = jest.spyOn(store, 'dispatch');

        (dialogService.openConfirmDialog as jest.Mock).mockImplementation(
            ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
                void onConfirm();
            }
        );
        (playlistsService.removeAll as jest.Mock).mockReturnValue(
            removal$.asObservable()
        );
        jest.spyOn(translate, 'instant').mockImplementation((key) => key);

        component.removeAll();

        expect(component.isRemovingAllPlaylists()).toBe(true);
        expect(playlistsService.removeAll).toHaveBeenCalled();

        removal$.next();
        removal$.complete();
        await fixture.whenStable();

        expect(component.isRemovingAllPlaylists()).toBe(false);
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.removeAllPlaylists()
        );
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.PLAYLISTS_REMOVED',
            undefined,
            {
                duration: 2000,
                horizontalPosition: 'center',
                panelClass: ['settings-snackbar'],
                verticalPosition: 'bottom',
            }
        );
    });

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

    it('should send epg refresh command', () => {
        jest.spyOn(epgService, 'fetchEpg');
        const url = 'http://epg-url-here/data.xml';
        component.refreshEpg(url);
        expect(epgService.fetchEpg).toHaveBeenCalledWith([url]);
    });

    it('should navigate back to home page', () => {
        jest.spyOn(router, 'navigateByUrl');
        component.backToHome();
        expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('should update the selected theme and mark the form dirty', () => {
        component.selectTheme(Theme.DarkTheme);

        expect(component.settingsForm.value.theme).toBe(Theme.DarkTheme);
        expect(component.settingsForm.dirty).toBeTruthy();
    });

    it('renders workspace startup controls with the expected defaults', () => {
        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(
            nativeElement.querySelector('[data-test-id="toggle-show-dashboard"]')
        ).not.toBeNull();
        expect(component.settingsForm.value.showDashboard).toBe(true);
        expect(component.settingsForm.value.startupBehavior).toBe(
            StartupBehavior.FirstView
        );
    });

    it('should save settings on submit', async () => {
        const mockStore = settingsStore as unknown as MockSettingsStore;
        mockStore.updateSettings.mockResolvedValue(undefined);
        const updateSettings = jest.spyOn(window.electron, 'updateSettings');

        component.onSubmit();
        await fixture.whenStable();

        expect(mockStore.updateSettings).toHaveBeenCalledWith(
            component.settingsForm.value
        );
        expect(updateSettings).toHaveBeenCalledWith(
            component.settingsForm.value
        );
    });
});
