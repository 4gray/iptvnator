import {
    Component,
    EventEmitter,
    input,
    NO_ERRORS_SCHEMA,
} from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { LazySnackBar } from '@iptvnator/services/lazy-snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import {
    DefaultLangChangeEvent,
    LangChangeEvent,
    TranslateService,
} from '@ngx-translate/core';
import {
    EpgRuntimeBridgeService,
    EpgService,
} from '@iptvnator/epg/data-access';
import {
    WorkspaceShellContextDrawerService,
    WORKSPACE_SHELL_ACTIONS,
} from '@iptvnator/workspace/shell/util';
import { MockProvider } from 'ng-mocks';
import { EMPTY, of } from 'rxjs';
import {
    DataService,
    EpgSourceSettingsService,
    ParentalLockService,
    SettingsStore,
    RuntimeCapabilitiesService,
} from '@iptvnator/services';
import { ParentalLockEnforcementService } from './services/parental-lock-enforcement.service';
import {
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { AppComponent } from './app.component';
import { AppDateLocaleService } from './app-date-locales';
import { ElectronServiceStub } from './services/electron.service.stub';
import { SettingsService } from './services/settings.service';

/** Writable double for the bridge's read-only capability getters. */
type EpgBridgeStub = {
    -readonly [K in keyof EpgRuntimeBridgeService]?: EpgRuntimeBridgeService[K];
};

jest.spyOn(global.console, 'error').mockImplementation(() => {
    // suppress console.error output during tests
});

class MockSettingsService {
    getValueFromLocalStorage = jest.fn().mockReturnValue(of(undefined));
    changeTheme = jest.fn();
}

@Component({ selector: 'app-startup-status', template: '' })
class StartupStatusStub {
    readonly routeReady = input(false);
    readonly complete = () => true;
}

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    epgUrl: [],
    streamFormat: StreamFormat.AutoStreamFormat,
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
    downloadFolder: '',
    recordingFolder: '',
};

describe('AppComponent', () => {
    let component: AppComponent;
    let fixture: ComponentFixture<AppComponent>;
    let epgService: EpgService;
    let router: Router;
    let settingsService: MockSettingsService;
    let snackBar: LazySnackBar;
    let store: MockStore;
    let translateService: TranslateService;
    let runtimeCapabilities: Partial<RuntimeCapabilitiesService>;
    let epgBridge: EpgBridgeStub;

    beforeEach(waitForAsync(() => {
        runtimeCapabilities = {
            isElectron: true,
        };
        epgBridge = {
            checkFreshness: jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: [],
            }),
            supportsImport: true,
            supportsSourceFreshness: true,
        };

        TestBed.configureTestingModule({
            imports: [AppComponent],
            providers: [
                provideMockStore(),
                // The parental lock boots from AppComponent; its collaborators
                // (Xtream/Stalker stores, SQLite bridge) are out of scope here.
                MockProvider(ParentalLockService, {
                    initialize: jest.fn().mockResolvedValue(undefined),
                }),
                MockProvider(ParentalLockEnforcementService, {
                    start: jest.fn(),
                }),
                {
                    provide: Actions,
                    useValue: new Actions(EMPTY),
                },
                {
                    provide: DataService,
                    useClass: ElectronServiceStub,
                },
                {
                    provide: SettingsService,
                    useClass: MockSettingsService,
                },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtimeCapabilities as RuntimeCapabilitiesService,
                },
                MockProvider(EpgService, {
                    fetchEpg: jest.fn(),
                }),
                {
                    provide: EpgRuntimeBridgeService,
                    useValue: epgBridge,
                },
                MockProvider(Router, {
                    navigateByUrl: jest.fn(),
                }),
                {
                    // Root-provided in production; stubbed because the spec's
                    // Router mock has no `events` stream for the real service.
                    provide: WorkspaceShellContextDrawerService,
                    useValue: { isOpen: () => false },
                },
                MockProvider(LazySnackBar, {
                    open: jest.fn().mockResolvedValue(null),
                }),
                MockProvider(TranslateService, {
                    instant: jest.fn((key: string) => key),
                    setDefaultLang: jest.fn(),
                    getDefaultLang: jest.fn(() => 'en'),
                    use: jest.fn(),
                    onLangChange: new EventEmitter<LangChangeEvent>(),
                    onDefaultLangChange:
                        new EventEmitter<DefaultLangChangeEvent>(),
                }),
                // The real service imports locale chunks; the language switch
                // is gated on it, so it must resolve deterministically here.
                MockProvider(AppDateLocaleService, {
                    use: jest.fn().mockResolvedValue(undefined),
                }),
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: {
                        openAddPlaylistDialog: jest.fn(),
                        openGlobalRecent: jest.fn(),
                        openGlobalSearch: jest.fn(),
                        openAccountInfo: jest.fn(),
                        openStalkerAccountInfo: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(AppComponent, {
                set: {
                    imports: [StartupStatusStub],
                    schemas: [NO_ERRORS_SCHEMA],
                },
            })
            .compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(AppComponent);
        epgService = TestBed.inject(EpgService);
        router = TestBed.inject(Router);
        settingsService = TestBed.inject(
            SettingsService
        ) as unknown as MockSettingsService;
        snackBar = TestBed.inject(LazySnackBar);
        store = TestBed.inject(MockStore);
        translateService = TestBed.inject(TranslateService);
        component = fixture.componentInstance;
    });

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

    it.each([
        { isElectron: true, sibling: 'nextElementSibling' as const },
        { isElectron: false, sibling: 'previousElementSibling' as const },
    ])(
        'keeps the server status outside the app viewport ($isElectron)',
        ({ isElectron, sibling }) => {
            Object.assign(runtimeCapabilities, { isElectron });
            fixture.detectChanges();

            const root = fixture.nativeElement as HTMLElement;
            const viewport = root.querySelector('.app-viewport');
            const statuses = root.querySelectorAll('app-source-sync-status');
            expect(statuses).toHaveLength(1);
            expect(viewport?.[sibling]).toBe(statuses[0]);
        }
    );

    it('should init component', () => {
        const storeDispatchSpy = jest.spyOn(store, 'dispatch');
        jest.spyOn(translateService, 'setDefaultLang');
        jest.spyOn(component, 'initSettings');

        component.ngOnInit();
        expect(storeDispatchSpy).toHaveBeenCalledWith(
            PlaylistActions.loadPlaylists()
        );
        expect(translateService.setDefaultLang).toHaveBeenCalledWith(
            Language.ENGLISH
        );
        expect(component.initSettings).toHaveBeenCalledTimes(1);
    });

    it('should navigate to the provided route', () => {
        const route = '/add-playlists';
        jest.spyOn(router, 'navigateByUrl');

        component.navigateToRoute(route);

        expect(router.navigateByUrl).toHaveBeenCalledWith(route);
    });

    it('should apply system theme when no settings are stored', () => {
        jest.spyOn(settingsService, 'changeTheme');

        component.initSettings();

        expect(settingsService.getValueFromLocalStorage).toHaveBeenCalledWith(
            STORE_KEY.Settings
        );
        expect(settingsService.changeTheme).toHaveBeenCalledWith(
            Theme.SystemTheme
        );
    });

    const guideUrl = 'https://example.test/epg.xml';

    it.each([
        { saved: [guideUrl], format: 'an array' },
        { saved: [null, guideUrl], format: 'an array with a null entry' },
        { saved: guideUrl, format: 'a legacy string' },
    ])(
        'applies saved settings and refreshes EPG stored as $format',
        async ({ saved }) => {
            const urls = [guideUrl];
            const settings = {
                ...DEFAULT_SETTINGS,
                epgUrl: saved,
                language: Language.SPANISH,
                theme: Theme.DarkTheme,
            };
            jest.spyOn(TestBed.inject(SettingsStore), 'epgUrl').mockReturnValue(
                urls
            );
            epgBridge.checkFreshness = jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: urls,
            });
            settingsService.getValueFromLocalStorage.mockReturnValue(
                of(settings)
            );
            jest.spyOn(settingsService, 'changeTheme');
            const dateLocales = TestBed.inject(AppDateLocaleService);

            component.initSettings();
            await fixture.whenStable();

            expect(dateLocales.use).toHaveBeenCalledWith(Language.SPANISH);
            expect(settingsService.changeTheme).toHaveBeenCalledWith(
                Theme.DarkTheme
            );
            expect(epgBridge.checkFreshness).toHaveBeenCalledWith(urls, 12);
            expect(epgService.fetchEpg).toHaveBeenCalledWith(urls);
            expect(snackBar.open).not.toHaveBeenCalled();
        }
    );

    it('normalizes legacy Portuguese before applying the startup language', () => {
        const settings: Settings = {
            ...DEFAULT_SETTINGS,
            language: 'pt' as Language,
        };
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));

        component.initSettings();

        expect(TestBed.inject(AppDateLocaleService).use).toHaveBeenCalledWith(
            Language.PORTUGUESE_BRAZIL
        );
    });

    it('does not reimport a deleted source from a late startup freshness response', async () => {
        const settingsStore = TestBed.inject(SettingsStore);
        await settingsStore.loadSettings();
        const urls = [guideUrl];
        jest.spyOn(settingsStore, 'epgUrl').mockReturnValue(urls);
        settingsService.getValueFromLocalStorage.mockReturnValue(
            of({ ...DEFAULT_SETTINGS, epgUrl: urls })
        );
        let finishFreshness!: (value: {
            freshUrls: string[];
            staleUrls: string[];
        }) => void;
        epgBridge.checkFreshness = jest.fn(
            () =>
                new Promise((resolve) => {
                    finishFreshness = resolve;
                })
        );
        component.initSettings();
        await Promise.resolve();
        expect(epgBridge.checkFreshness).toHaveBeenCalledWith(urls, 12);
        const sources = TestBed.inject(EpgSourceSettingsService);
        sources.revision.update((value) => value + 1);
        sources.changed$.next();
        finishFreshness({
            freshUrls: [],
            staleUrls: urls,
        });
        await fixture.whenStable();
        expect(epgService.fetchEpg).not.toHaveBeenCalledWith(urls);
    });

    it('does not fetch EPG settings when the EPG bridge cannot import EPG', async () => {
        const settings: Settings = {
            ...DEFAULT_SETTINGS,
            epgUrl: ['https://example.com/epg.xml'],
        };
        epgBridge.supportsImport = false;
        jest.spyOn(TestBed.inject(SettingsStore), 'epgUrl').mockReturnValue(
            settings.epgUrl
        );
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));

        component.initSettings();
        await fixture.whenStable();

        expect(epgBridge.checkFreshness).not.toHaveBeenCalled();
        expect(epgService.fetchEpg).not.toHaveBeenCalled();
    });
});
