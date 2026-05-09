import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { Actions } from '@ngrx/effects';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService } from '@ngx-translate/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';
import { MockProvider } from 'ng-mocks';
import { EMPTY, of } from 'rxjs';
import { DataService } from 'services';
import {
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from 'shared-interfaces';
import { PlaylistActions } from 'm3u-state';
import { AppComponent } from './app.component';
import { ElectronServiceStub } from './services/electron.service.stub';
import { SettingsService } from './services/settings.service';

jest.spyOn(global.console, 'error').mockImplementation(() => {
    // suppress console.error output during tests
});

class MockSettingsService {
    getValueFromLocalStorage = jest.fn().mockReturnValue(of(undefined));
    changeTheme = jest.fn();
}

const DEFAULT_SETTINGS: Settings = {
    player: VideoPlayer.VideoJs,
    epgUrl: [],
    streamFormat: StreamFormat.M3u8StreamFormat,
    openStreamOnDoubleClick: false,
    language: Language.ENGLISH,
    showCaptions: false,
    showDashboard: true,
    startupBehavior: StartupBehavior.FirstView,
    showExternalPlaybackBar: true,
    theme: Theme.SystemTheme,
    mpvPlayerPath: '',
    mpvReuseInstance: false,
    vlcPlayerPath: '',
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
    let snackBar: MatSnackBar;
    let store: MockStore;
    let translateService: TranslateService;
    const originalElectron = window.electron;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [AppComponent],
            providers: [
                provideMockStore(),
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
                MockProvider(EpgService, {
                    fetchEpg: jest.fn(),
                }),
                MockProvider(Router, {
                    navigateByUrl: jest.fn(),
                }),
                MockProvider(MatSnackBar, {
                    open: jest.fn(),
                }),
                MockProvider(TranslateService, {
                    instant: jest.fn((key: string) => key),
                    setDefaultLang: jest.fn(),
                    use: jest.fn(),
                }),
                {
                    provide: WORKSPACE_SHELL_ACTIONS,
                    useValue: {
                        openAddPlaylistDialog: jest.fn(),
                        openGlobalRecent: jest.fn(),
                        openGlobalSearch: jest.fn(),
                        openAccountInfo: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(AppComponent, {
                set: {
                    template: '',
                },
            })
            .compileComponents();
    }));

    beforeEach(() => {
        window.electron = {
            checkEpgFreshness: jest.fn().mockResolvedValue({
                freshUrls: [],
                staleUrls: [],
            }),
        } as unknown as typeof window.electron;

        fixture = TestBed.createComponent(AppComponent);
        epgService = TestBed.inject(EpgService);
        router = TestBed.inject(Router);
        settingsService = TestBed.inject(
            SettingsService
        ) as unknown as MockSettingsService;
        snackBar = TestBed.inject(MatSnackBar);
        store = TestBed.inject(MockStore);
        translateService = TestBed.inject(TranslateService);
        component = fixture.componentInstance;
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('should create the component', () => {
        expect(component).toBeTruthy();
    });

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

    it('should apply saved settings and fetch stale epg data only', async () => {
        const settings: Settings = {
            ...DEFAULT_SETTINGS,
            epgUrl: ['https://example.com/epg.xml'],
            language: Language.SPANISH,
            theme: Theme.DarkTheme,
        };
        const checkEpgFreshness = jest.fn().mockResolvedValue({
            freshUrls: [],
            staleUrls: settings.epgUrl,
        });

        window.electron = {
            ...window.electron,
            checkEpgFreshness,
        } as unknown as typeof window.electron;
        settingsService.getValueFromLocalStorage.mockReturnValue(of(settings));
        jest.spyOn(settingsService, 'changeTheme');
        jest.spyOn(translateService, 'use');

        component.initSettings();
        await fixture.whenStable();

        expect(translateService.use).toHaveBeenCalledWith(Language.SPANISH);
        expect(settingsService.changeTheme).toHaveBeenCalledWith(
            Theme.DarkTheme
        );
        expect(checkEpgFreshness).toHaveBeenCalledWith(settings.epgUrl, 12);
        expect(epgService.fetchEpg).toHaveBeenCalledWith(settings.epgUrl);
        expect(snackBar.open).not.toHaveBeenCalled();
    });
});
