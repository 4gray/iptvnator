import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
import { HttpClientTestingModule } from '@angular/common/http/testing';
import {
    ActivatedRoute,
    convertToParamMap,
    ParamMap,
    Router,
} from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import {
    selectAllPlaylistsMeta,
    selectIsEpgAvailable,
} from '@iptvnator/m3u-state';
import {
    DatabaseService,
    DataService,
    PlaylistBackupService,
    PlaylistsService,
} from '@iptvnator/services';
import {
    ELECTRON_BRIDGE_APP_UPDATE_STATUSES,
    ElectronBridgeAppUpdateStatus,
    Language,
    PlaylistMeta,
    StartupBehavior,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { DialogService } from '@iptvnator/ui/components';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule, MockProvider } from 'ng-mocks';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { BehaviorSubject, from, of } from 'rxjs';
import { ElectronServiceStub } from '../../services/electron.service.stub';
import { SettingsStorageFailure } from '@iptvnator/services';
import { SettingsStore } from '../../services/settings-store.service';
import { SettingsService } from '../../services/settings.service';
import { SettingsComponent } from '../settings.component';

/**
 * Shared fixtures for the settings specs.
 *
 * Both halves of the name matter: the `.stub.ts` suffix keeps the file out of
 * the Angular app build (`tsconfig.app.json` excludes it), and the
 * `test-stubs/` directory keeps it out of coverage — `collectCoverageFrom`,
 * `tools/coverage/run-tier-a-coverage.mjs` and the integrity checker all
 * exclude that path, so this harness never lands in the coverage ratchet as
 * production source.
 */

export const DEFAULT_DASHBOARD_RAILS = {
    hero: true,
    continueWatching: true,
    liveFavorites: true,
    recentlyWatchedLive: true,
    favoriteMoviesAndSeries: true,
    recentSources: true,
    xtreamRecentlyAdded: true,
    tmdbTrending: true,
    tmdbRecommendations: true,
};

export const DEFAULT_SETTINGS = {
    player: VideoPlayer.VideoJs,
    webPlayerSharedControls: true,
    playerAmbientMode: false,
    playerUpNextRail: true,
    fullscreenChannelPanel: true,
    vodAutoFailover: false,
    m3uVodDetails: true,
    streamFormat: StreamFormat.AutoStreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    showExternalPlaybackBar: true,
    stripCountryPrefix: false,
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
    embeddedMpvFrameCopy: false,
    coverSize: 'medium',
    dashboardRails: DEFAULT_DASHBOARD_RAILS,
    preferUploadedEpgOverXtream: false,
    epgViewMode: 'timeline',
    tmdb: { enabled: false, apiKey: '' },
};

export const DEFAULT_APP_UPDATE_STATUS: ElectronBridgeAppUpdateStatus = {
    currentVersion: '0.22.0',
    manualDownloadUrl: 'https://github.com/4gray/iptvnator/releases/latest',
    status: ELECTRON_BRIDGE_APP_UPDATE_STATUSES.Idle,
    supportedSelfUpdate: true,
};

export class MatSnackBarStub {
    open = jest.fn();
}

export class MockRouter {
    navigate = jest.fn().mockResolvedValue(true);

    navigateByUrl(url: string): string {
        return url;
    }
}

/**
 * Stands in for the `:section` route param the settings page renders from.
 * Specs switch section pages with `setSettingsSection` below.
 */
export class MockActivatedRoute {
    private readonly params = new BehaviorSubject<ParamMap>(
        convertToParamMap({ section: 'general' })
    );

    readonly paramMap = this.params.asObservable();

    setSection(section: string): void {
        this.params.next(convertToParamMap({ section }));
    }
}

/** Routes the rendered settings page to the given section page. */
export function setSettingsSection(section: string): void {
    (
        TestBed.inject(ActivatedRoute) as unknown as MockActivatedRoute
    ).setSection(section);
}

export class MockSettingsStore {
    private _settings = signal(DEFAULT_SETTINGS);

    getSettings = () => this._settings();

    getTrustOptions = () => ({
        trustedPrivateNetworkEpgUrls:
            (
                this._settings() as typeof DEFAULT_SETTINGS & {
                    trustedPrivateNetworkEpgUrls?: string[];
                }
            ).trustedPrivateNetworkEpgUrls ?? [],
        trustedInsecureTlsHosts:
            (
                this._settings() as typeof DEFAULT_SETTINGS & {
                    trustedInsecureTlsHosts?: string[];
                }
            ).trustedInsecureTlsHosts ?? [],
    });

    loadSettings = jest.fn().mockResolvedValue(undefined);

    updateSettings = jest.fn().mockResolvedValue(undefined);

    storageFailure = signal<SettingsStorageFailure | null>(null);

    // Helper method for tests to modify settings
    _setSettings(newSettings: Partial<typeof DEFAULT_SETTINGS>) {
        this._settings.set({
            ...this._settings(),
            ...newSettings,
        });
    }
}

export class MockSettingsService {
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

export function createEpgBridgeStub(): Partial<EpgRuntimeBridgeService> {
    return {
        clearEpgData: jest.fn().mockResolvedValue({ success: true }),
        clearEpgDataForSource: jest.fn().mockResolvedValue({ success: true }),
        forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
        supportsDataManagement: true,
        supportsImport: true,
    };
}

/** The full desktop bridge the settings page expects to be present */
export function createElectronStub(): typeof window.electron {
    return {
        checkEpgFreshness: jest.fn().mockResolvedValue({
            freshUrls: [],
            staleUrls: [],
        }),
        clearEpgData: jest.fn().mockResolvedValue({ success: true }),
        clearEpgDataForSource: jest.fn().mockResolvedValue({ success: true }),
        fetchEpg: jest.fn().mockResolvedValue({ success: true }),
        forceFetchEpg: jest.fn().mockResolvedValue({ success: true }),
        getAppVersion: jest.fn().mockResolvedValue('1.0.0'),
        getAppUpdateStatus: jest
            .fn()
            .mockResolvedValue(DEFAULT_APP_UPDATE_STATUS),
        getChannelPrograms: jest.fn().mockResolvedValue([]),
        getEpgChannelsByRange: jest.fn().mockResolvedValue([]),
        getLocalIpAddresses: jest.fn().mockResolvedValue([]),
        checkForAppUpdate: jest
            .fn()
            .mockResolvedValue(DEFAULT_APP_UPDATE_STATUS),
        downloadAppUpdate: jest
            .fn()
            .mockResolvedValue(DEFAULT_APP_UPDATE_STATUS),
        installAppUpdate: jest
            .fn()
            .mockResolvedValue(DEFAULT_APP_UPDATE_STATUS),
        onAppUpdateStatusChange: jest.fn(() => jest.fn()),
        onWindowCloseRequested: jest.fn(() => jest.fn()),
        setWindowCloseGuard: jest.fn().mockResolvedValue(undefined),
        confirmWindowClose: jest.fn().mockResolvedValue(undefined),
        cancelWindowClose: jest.fn().mockResolvedValue(undefined),
        openInMpv: jest.fn(),
        openInVlc: jest.fn(),
        platform: 'linux',
        searchEpgPrograms: jest.fn().mockResolvedValue([]),
        saveFileDialog: jest.fn().mockResolvedValue('/tmp/backup.json'),
        setMpvPlayerPath: jest.fn().mockResolvedValue(undefined),
        setVlcPlayerPath: jest.fn().mockResolvedValue(undefined),
        updateSettings: jest.fn().mockResolvedValue(undefined),
        writeFile: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as typeof window.electron;
}

export const PLAYLIST_IMPORT_DATE = '2026-04-21T00:00:00.000Z';

export function createPlaylistMeta(
    overrides: Partial<PlaylistMeta> = {}
): PlaylistMeta {
    return {
        _id: overrides._id ?? 'playlist-id',
        title: overrides.title ?? 'Playlist',
        count: overrides.count ?? 10,
        importDate: overrides.importDate ?? PLAYLIST_IMPORT_DATE,
        autoRefresh: overrides.autoRefresh ?? false,
        ...overrides,
    };
}

export function createDialogRef(
    result: boolean
): ReturnType<MatDialog['open']> {
    return {
        afterClosed: () => of(result),
    } as unknown as ReturnType<MatDialog['open']>;
}

export const BACKUP_EXPORT_RESULT = {
    defaultFileName: 'iptvnator-playlist-backup-2026-04-21.json',
    json: '{}',
    manifest: {
        kind: 'iptvnator-playlist-backup',
        version: 1,
        exportedAt: PLAYLIST_IMPORT_DATE,
        includeSecrets: true,
        playlists: [],
    },
};

/** Providers every settings spec needs, whether or not it renders the page */
export function settingsTestProviders(
    epgBridge: Partial<EpgRuntimeBridgeService>
) {
    return [
        UntypedFormBuilder,
        { provide: SettingsStore, useClass: MockSettingsStore },
        MockProvider(EpgService, { fetchEpg: jest.fn() }),
        { provide: EpgRuntimeBridgeService, useValue: epgBridge },
        MockProvider(DialogService, { openConfirmDialog: jest.fn() }),
        MockProvider(MatDialog, { open: jest.fn() }),
        { provide: SettingsService, useClass: MockSettingsService },
        { provide: MatSnackBar, useClass: MatSnackBarStub },
        { provide: DataService, useClass: ElectronServiceStub },
        { provide: Router, useClass: MockRouter },
        { provide: ActivatedRoute, useClass: MockActivatedRoute },
        provideMockStore({
            selectors: [
                { selector: selectAllPlaylistsMeta, value: [] },
                { selector: selectIsEpgAvailable, value: false },
            ],
        }),
        { provide: NgxIndexedDBService, useValue: {} },
        MockProvider(PlaylistsService, {
            getAllData: jest.fn().mockReturnValue(of([])),
            removeAll: jest.fn(),
        }),
        MockProvider(DatabaseService, {
            createOperationId: jest.fn().mockReturnValue('delete-all-op'),
            deleteAllPlaylists: jest.fn().mockResolvedValue(true),
        }),
        MockProvider(PlaylistBackupService, {
            exportBackup: jest.fn().mockResolvedValue(BACKUP_EXPORT_RESULT),
            importBackup: jest.fn().mockResolvedValue({
                imported: 0,
                merged: 0,
                skipped: 0,
                failed: 0,
                errors: [],
            }),
        }),
    ];
}

/** TestBed setup for specs that render the whole settings page */
export function configureSettingsComponentTestBed(
    epgBridge: Partial<EpgRuntimeBridgeService>
): void {
    TestBed.configureTestingModule({
        providers: settingsTestProviders(epgBridge),
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
}

/**
 * `ngOnInit` kicks off a version check and a LAN address lookup; both are
 * stubbed on the owning facades so tests stay deterministic.
 */
export function stubSettingsSideEffects(
    settingsComponent: SettingsComponent
): void {
    jest.spyOn(
        settingsComponent.appUpdate,
        'checkAppVersion'
    ).mockImplementation();
    jest.spyOn(
        settingsComponent.remoteControl,
        'fetchLocalIpAddresses'
    ).mockResolvedValue(undefined);
}
