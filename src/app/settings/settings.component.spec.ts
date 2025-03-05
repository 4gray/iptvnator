/* eslint-disable @typescript-eslint/await-thenable */
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
import { provideMockStore } from '@ngrx/store/testing';
import {
    TranslateModule,
    TranslatePipe,
    TranslateService,
} from '@ngx-translate/core';
import {
    MockComponent,
    MockModule,
    MockPipe,
    MockProvider,
    MockProviders,
} from 'ng-mocks';
import { DataService } from '../services/data.service';
import { HeaderComponent } from '../shared/components';
import { Language } from './language.enum';
import { SettingsComponent } from './settings.component';
import { VideoPlayer } from './settings.interface';
import { Theme } from './theme.enum';

import { signal } from '@angular/core';
import { NgxIndexedDBService } from 'ngx-indexed-db';
import { of } from 'rxjs';
import { SETTINGS_UPDATE } from '../../../shared/ipc-commands';
import { DialogService } from '../services/dialog.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { EpgService } from '../services/epg.service';
import { PlaylistsService } from '../services/playlists.service';
import { SettingsStore } from '../services/settings-store.service';
import { SettingsService } from '../services/settings.service';

class MatSnackBarStub {
    open() {}
}

export class MockRouter {
    navigateByUrl(url: string): string {
        return url;
    }
}

const DEFAULT_SETTINGS = {
    player: VideoPlayer.VideoJs,
    language: Language.ENGLISH,
    showCaptions: false,
    theme: Theme.LightTheme,
    mpvPlayerPath: '',
    vlcPlayerPath: '',
    remoteControl: false,
    remoteControlPort: 3000,
};

class MockSettingsStore {
    private _settings = signal(DEFAULT_SETTINGS);

    getSettings = () => this._settings;

    loadSettings = jest.fn().mockResolvedValue(undefined);

    updateSettings = jest.fn().mockResolvedValue(undefined);

    // Helper method for tests to modify settings
    _setSettings(newSettings: any) {
        this._settings.set(newSettings);
    }
}

class MockSettingsService {
    getAppVersion = jest.fn().mockReturnValue(of('1.0.0'));
    changeTheme = jest.fn();
}

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: DataService;
    let router: Router;
    let settingsStore: any;
    let translate: TranslateService;
    let epgService: EpgService;

    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            declarations: [
                SettingsComponent,
                MockComponent(HeaderComponent),
                MockPipe(TranslatePipe),
            ],
            providers: [
                UntypedFormBuilder,
                MockProvider(TranslateService),
                { provide: SettingsStore, useClass: MockSettingsStore },
                MockProvider(EpgService),
                MockProvider(DialogService),
                { provide: SettingsService, useClass: MockSettingsService },
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                {
                    provide: Router,
                    useClass: MockRouter,
                },
                provideMockStore(),
                MockProviders(NgxIndexedDBService, PlaylistsService),
            ],
            imports: [
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
                MockModule(TranslateModule),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(SettingsComponent);
        electronService = TestBed.inject(DataService);
        settingsStore = TestBed.inject(SettingsStore);
        router = TestBed.inject(Router);
        translate = TestBed.inject(TranslateService);
        epgService = TestBed.inject(EpgService);

        component = fixture.componentInstance;
        component.setSettings = jest.fn();
        fixture.detectChanges();
    });

    it('should create and init component', () => {
        expect(component).toBeTruthy();
    });

    describe('Get and set settings on component init', () => {
        const settings = {
            player: VideoPlayer.VideoJs,
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

            component.ngOnInit();

            // Force change detection
            fixture.detectChanges();
            await fixture.whenStable();

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
            fixture.detectChanges();
            expect(translate.instant).toHaveBeenCalledWith(
                'SETTINGS.NEW_VERSION_AVAILABLE'
            );
            expect(component.updateMessage).toBe(
                'New version available: 1.0.0'
            );
        });
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

    it('should save settings on submit', async () => {
        const mockStore = settingsStore as unknown as MockSettingsStore;
        mockStore.updateSettings.mockResolvedValue(undefined);

        jest.spyOn(electronService, 'sendIpcEvent');
        await component.onSubmit();

        expect(mockStore.updateSettings).toHaveBeenCalledWith(
            component.settingsForm.value
        );
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            SETTINGS_UPDATE,
            component.settingsForm.value
        );
    });
});
