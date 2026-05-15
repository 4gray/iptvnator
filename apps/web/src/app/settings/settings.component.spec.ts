import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import {
    FormsModule,
    ReactiveFormsModule,
    UntypedFormBuilder,
} from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { EpgService } from '@iptvnator/epg/data-access';
import { Store } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import { MockModule, MockProvider } from 'ng-mocks';
import {
    DatabaseService,
    DataService,
    PlaylistBackupService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    EmbeddedMpvSupport,
    Language,
    PlaylistMeta,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsComponent } from './settings.component';

import { signal } from '@angular/core';
import { SettingsContextService } from '@iptvnator/workspace/shell/util';
import {
    PlaylistActions,
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { from, of } from 'rxjs';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';
import { SettingsSectionScrollDirective } from './settings-section-scroll.directive';

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
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    showExternalPlaybackBar: true,
    theme: Theme.SystemTheme,
    mpvPlayerPath: '',
    mpvPlayerArguments: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
    vlcPlayerArguments: '',
    vlcReuseInstance: false,
    remoteControl: false,
    remoteControlPort: 8765,
    epgUrl: [],
    recordingFolder: '',
    coverSize: 'medium',
    preferUploadedEpgOverXtream: false,
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
    getAppVersion = jest.fn().mockReturnValue(from(Promise.resolve('1.0.0')));
    changeTheme = jest.fn();
    isVersionOutdated = jest.fn().mockImplementation(
        (currentVersion: string, latestVersion: string) =>
            currentVersion.localeCompare(latestVersion, undefined, {
                numeric: true,
                sensitivity: 'base',
            }) < 0
    );
}

interface SettingsSectionScrollDirectiveTestApi {
    getScrollRoot(): HTMLElement | null;
}

interface SettingsComponentPrivateTestApi {
    matDialog: MatDialog;
    waitForUiFeedbackFrame(): Promise<void>;
}

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: DataService;
    let router: Router;
    let settingsStore: unknown;
    let translate: TranslateService;
    let dialogService: DialogService;
    let playlistsService: PlaylistsService;
    let playlistBackupService: PlaylistBackupService;
    let store: Store;
    let mockStore: MockStore;
    let databaseService: DatabaseService;
    let snackBar: MatSnackBarStub;
    const originalElectron = window.electron;
    const importDate = '2026-04-21T00:00:00.000Z';

    const createPlaylistMeta = (
        overrides: Partial<PlaylistMeta> = {}
    ): PlaylistMeta => ({
        _id: overrides._id ?? 'playlist-id',
        title: overrides.title ?? 'Playlist',
        count: overrides.count ?? 10,
        importDate: overrides.importDate ?? importDate,
        autoRefresh: overrides.autoRefresh ?? false,
        ...overrides,
    });

    const createDialogRef = (result: boolean): ReturnType<MatDialog['open']> =>
        ({
            afterClosed: () => of(result),
        }) as unknown as ReturnType<MatDialog['open']>;

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
                MockProvider(MatDialog, {
                    open: jest.fn(),
                }),
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                {
                    provide: Router,
                    useClass: MockRouter,
                },
                provideMockStore({
                    selectors: [
                        { selector: selectAllPlaylistsMeta, value: [] },
                        { selector: selectIsEpgAvailable, value: false },
                    ],
                }),
                {
                    provide: NgxIndexedDBService,
                    useValue: {},
                },
                MockProvider(PlaylistsService, {
                    getAllData: jest.fn().mockReturnValue(of([])),
                    removeAll: jest.fn(),
                }),
                MockProvider(DatabaseService, {
                    createOperationId: jest
                        .fn()
                        .mockReturnValue('delete-all-op'),
                    deleteAllPlaylists: jest.fn().mockResolvedValue(true),
                }),
                MockProvider(PlaylistBackupService, {
                    exportBackup: jest.fn().mockResolvedValue({
                        defaultFileName:
                            'iptvnator-playlist-backup-2026-04-21.json',
                        json: '{}',
                        manifest: {
                            kind: 'iptvnator-playlist-backup',
                            version: 1,
                            exportedAt: '2026-04-21T00:00:00.000Z',
                            includeSecrets: true,
                            playlists: [],
                        },
                    }),
                    importBackup: jest.fn().mockResolvedValue({
                        imported: 0,
                        merged: 0,
                        skipped: 0,
                        failed: 0,
                        errors: [],
                    }),
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
            forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
            getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
            getLocalIpAddresses: jest.fn().mockResolvedValue([]),
            platform: 'linux',
            saveFileDialog: jest.fn().mockResolvedValue('/tmp/backup.json'),
            setMpvPlayerPath: jest.fn().mockResolvedValue(undefined),
            setVlcPlayerPath: jest.fn().mockResolvedValue(undefined),
            updateSettings: jest.fn().mockResolvedValue(undefined),
            writeFile: jest.fn().mockResolvedValue({ success: true }),
        } as unknown as typeof window.electron;

        fixture = TestBed.createComponent(SettingsComponent);
        electronService = TestBed.inject(DataService);
        settingsStore = TestBed.inject(SettingsStore);
        router = TestBed.inject(Router);
        translate = TestBed.inject(TranslateService);
        dialogService = TestBed.inject(DialogService);
        playlistsService = TestBed.inject(PlaylistsService);
        playlistBackupService = TestBed.inject(PlaylistBackupService);
        store = TestBed.inject(Store);
        mockStore = TestBed.inject(MockStore);
        databaseService = TestBed.inject(DatabaseService);
        snackBar = TestBed.inject(MatSnackBar) as unknown as MatSnackBarStub;

        component = fixture.componentInstance;
        component.checkAppVersion = jest.fn();
        component.fetchLocalIpAddresses = jest
            .fn()
            .mockResolvedValue(undefined);
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

    function privateApi(
        settingsComponent: SettingsComponent
    ): SettingsComponentPrivateTestApi {
        return settingsComponent as unknown as SettingsComponentPrivateTestApi;
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

            scrollComponent.checkAppVersion = jest.fn();
            scrollComponent.fetchLocalIpAddresses = jest
                .fn()
                .mockResolvedValue(undefined);
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

        it('shows the embedded mpv option when the desktop support probe reports supported', async () => {
            window.electron = {
                ...window.electron,
                getEmbeddedMpvSupport: jest.fn().mockResolvedValue({
                    supported: true,
                    platform: 'darwin',
                }),
            } as unknown as typeof window.electron;

            await component.ngOnInit();
            await fixture.whenStable();

            expect(
                component
                    .players()
                    .some((player) => player.id === VideoPlayer.EmbeddedMpv)
            ).toBe(true);
        });

        it('does not block settings initialization while embedded mpv support is pending', async () => {
            let resolveSupport: (value: EmbeddedMpvSupport) => void;
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

            resolveSupport!({
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

    it('disables the global wipe action when there are no playlists', () => {
        setPlaylists([]);

        const deleteButton = (
            fixture.nativeElement as HTMLElement
        ).querySelector('.danger-zone__button') as HTMLButtonElement | null;

        expect(component.canRemoveAllPlaylists()).toBe(false);
        expect(deleteButton?.disabled).toBe(true);
    });

    it('opens the dedicated delete-all dialog with the current playlist type summary', () => {
        setPlaylists([
            createPlaylistMeta({ _id: 'm3u-1' }),
            createPlaylistMeta({
                _id: 'xtream-1',
                serverUrl: 'http://xtream.example',
            }),
            createPlaylistMeta({
                _id: 'stalker-1',
                macAddress: '00:11:22:33:44:55',
            }),
        ]);

        const openSpy = jest
            .spyOn(privateApi(component).matDialog, 'open')
            .mockReturnValue(createDialogRef(false));

        component.removeAll();

        expect(component.playlistDeleteSummary()).toEqual({
            total: 3,
            m3u: 1,
            xtream: 1,
            stalker: 1,
        });
        expect(openSpy).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({
                data: {
                    summary: {
                        total: 3,
                        m3u: 1,
                        xtream: 1,
                        stalker: 1,
                    },
                },
            })
        );
    });

    it('tracks Electron delete-all progress and dispatches store cleanup after success', async () => {
        setPlaylists([
            createPlaylistMeta({ _id: 'm3u-1' }),
            createPlaylistMeta({
                _id: 'xtream-1',
                serverUrl: 'http://xtream.example',
            }),
        ]);

        const dispatchSpy = jest.spyOn(store, 'dispatch');
        (databaseService.deleteAllPlaylists as jest.Mock).mockClear();
        jest.spyOn(privateApi(component).matDialog, 'open').mockReturnValue(
            createDialogRef(true)
        );
        jest.spyOn(translate, 'instant').mockImplementation(
            (key: string, params?: Record<string, number>) => {
                if (key === 'SETTINGS.REMOVE_ALL_PROGRESS') {
                    return `${params?.current}/${params?.total}`;
                }
                return key;
            }
        );
        jest.spyOn(
            privateApi(component),
            'waitForUiFeedbackFrame'
        ).mockResolvedValue(undefined);

        let resolveDelete: (value: boolean) => void = () => undefined;
        (databaseService.deleteAllPlaylists as jest.Mock).mockImplementation(
            ({
                onEvent,
            }: {
                onEvent?: (event: {
                    operation: string;
                    status: string;
                    current?: number;
                    total?: number;
                }) => void;
            }) => {
                onEvent?.({
                    operation: 'delete-all-playlists',
                    status: 'progress',
                    current: 3,
                    total: 7,
                });

                return new Promise<boolean>((resolve) => {
                    resolveDelete = resolve;
                });
            }
        );

        component.removeAll();
        await Promise.resolve();
        fixture.detectChanges();

        expect(component.isRemovingAllPlaylists()).toBe(true);
        expect(component.removeAllProgressLabel()).toBe('3/7');
        expect(databaseService.deleteAllPlaylists).toHaveBeenCalledWith(
            expect.objectContaining({
                operationId: 'delete-all-op',
                onEvent: expect.any(Function),
            })
        );

        resolveDelete(true);
        await fixture.whenStable();

        expect(component.isRemovingAllPlaylists()).toBe(false);
        expect(component.removeAllProgress()).toBeNull();
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

    it('falls back to PlaylistsService.removeAll outside Electron', async () => {
        fixture.destroy();
        window.electron = undefined as unknown as typeof window.electron;

        const browserFixture = TestBed.createComponent(SettingsComponent);
        const browserComponent = browserFixture.componentInstance;
        browserComponent.checkAppVersion = jest.fn();
        browserComponent.fetchLocalIpAddresses = jest
            .fn()
            .mockResolvedValue(undefined);
        browserFixture.detectChanges();

        mockStore.overrideSelector(selectAllPlaylistsMeta, [
            createPlaylistMeta({ _id: 'browser-m3u' }),
        ]);
        mockStore.refreshState();
        browserFixture.detectChanges();

        jest.spyOn(
            privateApi(browserComponent).matDialog,
            'open'
        ).mockReturnValue(createDialogRef(true));
        jest.spyOn(
            privateApi(browserComponent),
            'waitForUiFeedbackFrame'
        ).mockResolvedValue(undefined);
        (databaseService.deleteAllPlaylists as jest.Mock).mockClear();
        (playlistsService.removeAll as jest.Mock).mockClear();
        (playlistsService.removeAll as jest.Mock).mockReturnValue(
            of(undefined)
        );
        const dispatchSpy = jest.spyOn(store, 'dispatch');

        browserComponent.removeAll();
        await browserFixture.whenStable();

        expect(playlistsService.removeAll).toHaveBeenCalled();
        expect(databaseService.deleteAllPlaylists).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.removeAllPlaylists()
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

    it('should force-fetch EPG for a single URL (bypassing freshness cache)', () => {
        const url = 'http://epg-url-here/data.xml';
        component.refreshEpg(url);
        expect(window.electron.forceFetchEpg).toHaveBeenCalledWith(url);
    });

    it('clears EPG data with a busy state and refreshes all sources on success', async () => {
        let resolveClear: () => void = () => undefined;
        const clearPromise = new Promise<{ success: boolean }>((resolve) => {
            resolveClear = () => resolve({ success: true });
        });
        (window.electron.clearEpgData as jest.Mock).mockReturnValue(
            clearPromise
        );
        (dialogService.openConfirmDialog as jest.Mock).mockImplementation(
            ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
                void onConfirm();
            }
        );
        const refreshSpy = jest.spyOn(component, 'refreshAllEpg');
        jest.spyOn(translate, 'instant').mockImplementation((key) => key);

        component.clearEpgData();

        expect(component.isClearingEpgData()).toBe(true);
        expect(refreshSpy).not.toHaveBeenCalled();

        resolveClear();
        await fixture.whenStable();

        expect(component.isClearingEpgData()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_DATA_CLEARED',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
        expect(refreshSpy).toHaveBeenCalled();
    });

    it('shows an export busy state until the backup file has been written', async () => {
        let resolveExport: (value: {
            defaultFileName: string;
            json: string;
            manifest: {
                kind: string;
                version: number;
                exportedAt: string;
                includeSecrets: boolean;
                playlists: never[];
            };
        }) => void = () => undefined;

        (playlistBackupService.exportBackup as jest.Mock).mockReturnValueOnce(
            new Promise((resolve) => {
                resolveExport = resolve;
            })
        );

        const exportPromise = component.exportData();

        expect(component.isExportingData()).toBe(true);

        resolveExport({
            defaultFileName: 'iptvnator-playlist-backup-2026-04-21.json',
            json: '{}',
            manifest: {
                kind: 'iptvnator-playlist-backup',
                version: 1,
                exportedAt: '2026-04-21T00:00:00.000Z',
                includeSecrets: true,
                playlists: [],
            },
        });

        await exportPromise;

        expect(window.electron.saveFileDialog).toHaveBeenCalledWith(
            'iptvnator-playlist-backup-2026-04-21.json',
            [
                {
                    extensions: ['json'],
                    name: 'JSON',
                },
            ]
        );
        expect(window.electron.writeFile).toHaveBeenCalledWith(
            '/tmp/backup.json',
            '{}'
        );
        expect(component.isExportingData()).toBe(false);
    });

    it('shows a failure snackbar and skips refresh when clearing EPG data rejects', async () => {
        (window.electron.clearEpgData as jest.Mock).mockRejectedValueOnce(
            new Error('boom')
        );
        (dialogService.openConfirmDialog as jest.Mock).mockImplementation(
            ({ onConfirm }: { onConfirm: () => Promise<void> }) => {
                void onConfirm();
            }
        );
        const refreshSpy = jest.spyOn(component, 'refreshAllEpg');
        jest.spyOn(translate, 'instant').mockImplementation((key) => key);
        jest.spyOn(console, 'error').mockImplementation();

        component.clearEpgData();
        await fixture.whenStable();

        expect(component.isClearingEpgData()).toBe(false);
        expect(snackBar.open).toHaveBeenCalledWith(
            'SETTINGS.EPG_DATA_CLEAR_FAILED',
            undefined,
            expect.objectContaining({ panelClass: ['settings-snackbar'] })
        );
        expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('should navigate back to home page', () => {
        jest.spyOn(router, 'navigateByUrl');
        component.backToHome();
        expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('updates the selected theme through the general section and marks the form dirty', () => {
        const darkThemeButton = (
            fixture.nativeElement as HTMLElement
        ).querySelector('[data-test-id="DARK_THEME"]') as HTMLButtonElement;

        darkThemeButton.click();
        fixture.detectChanges();

        expect(component.settingsForm.value.theme).toBe(Theme.DarkTheme);
        expect(component.settingsForm.dirty).toBeTruthy();
    });

    it('updates cover size through the general section output', () => {
        const mockStore = settingsStore as unknown as MockSettingsStore;
        const largeCoverButton = (
            fixture.nativeElement as HTMLElement
        ).querySelector(
            '[data-test-id="cover-size-large"]'
        ) as HTMLButtonElement;

        largeCoverButton.click();
        fixture.detectChanges();

        expect(component.settingsForm.value.coverSize).toBe('large');
        expect(mockStore.updateSettings).toHaveBeenCalledWith({
            coverSize: 'large',
        });
    });

    it('renders workspace startup controls with the expected defaults', () => {
        const nativeElement = fixture.nativeElement as HTMLElement;

        expect(
            nativeElement.querySelector(
                '[data-test-id="toggle-show-dashboard"]'
            )
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

    it('clears external player paths in Electron when saved as empty', async () => {
        const mockStore = settingsStore as unknown as MockSettingsStore;
        mockStore.updateSettings.mockResolvedValue(undefined);
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
        const mockStore = settingsStore as unknown as MockSettingsStore;
        mockStore.updateSettings.mockResolvedValue(undefined);
        const updateSettings = jest.spyOn(window.electron, 'updateSettings');

        component.settingsForm.patchValue({
            mpvPlayerArguments: '--screen=1\n--geometry=1280x720',
            vlcPlayerArguments: '--qt-fullscreen-screennumber=1',
        });

        component.onSubmit();
        await fixture.whenStable();

        expect(mockStore.updateSettings).toHaveBeenCalledWith(
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
});
