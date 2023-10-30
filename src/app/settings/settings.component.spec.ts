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
import { StorageMap } from '@ngx-pwa/local-storage';
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
import { of } from 'rxjs';
import { EPG_FORCE_FETCH } from '../../../shared/ipc-commands';
import { DataService } from '../services/data.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { HeaderComponent } from '../shared/components';
import { SharedModule } from '../shared/shared.module';
import { Language } from './language.enum';
import { SettingsComponent } from './settings.component';
import { VideoPlayer } from './settings.interface';
import { Theme } from './theme.enum';

import { NgxIndexedDBService } from 'ngx-indexed-db';
import { PlaylistsService } from '../services/playlists.service';

class MatSnackBarStub {
    open(): void {}
}

export class MockRouter {
    navigateByUrl(url: string): string {
        return url;
    }
}

const DEFAULT_SETTINGS = {
    player: VideoPlayer.VideoJs,
    epgUrl: [],
    language: Language.ENGLISH,
    showCaptions: false,
    theme: Theme.LightTheme,
    mpvPlayerPath: '',
    vlcPlayerPath: '',
};

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: DataService;
    let router: Router;
    let storage: StorageMap;
    let translate: TranslateService;

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
                { provide: MatSnackBar, useClass: MatSnackBarStub },
                { provide: DataService, useClass: ElectronServiceStub },
                {
                    provide: Router,
                    useClass: MockRouter,
                },
                StorageMap,
                provideMockStore(),
                MockProviders(NgxIndexedDBService, PlaylistsService),
            ],
            imports: [
                HttpClientTestingModule,
                MockModule(FormsModule),
                MockModule(MatSelectModule),
                MockModule(MatIconModule),
                MockModule(MatTooltipModule),
                MockModule(ReactiveFormsModule),
                MockModule(RouterTestingModule),
                MockModule(MatCardModule),
                MockModule(MatListModule),
                MockModule(MatFormFieldModule),
                MockModule(MatCheckboxModule),
                MockModule(MatDividerModule),
                MockModule(TranslateModule),
                MockModule(SharedModule),
            ],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(SettingsComponent);
        electronService = TestBed.inject(DataService);
        storage = TestBed.inject(StorageMap);
        router = TestBed.inject(Router);
        translate = TestBed.inject(TranslateService);

        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create and init component', () => {
        expect(component).toBeTruthy();
    });

    describe('Get and set settings on component init', () => {
        const settings = {
            player: 'test',
            showCaptions: true,
            epgUrl: [],
            mpvPlayerPath: '',
            vlcPlayerPath: '',
        };
        let spyOnStorageGet;

        beforeEach(() => {
            spyOnStorageGet = jest.spyOn(storage, 'get');
        });

        it('should init default settings if previous config was not saved', () => {
            spyOnStorageGet.mockReturnValue(of(null));
            jest.spyOn(component.settingsForm, 'setValue');
            component.ngOnInit();
            expect(storage.get).toHaveBeenCalled();
            expect(component.settingsForm.setValue).toHaveBeenCalledTimes(0);
            expect(component.settingsForm.value).toEqual(DEFAULT_SETTINGS);
        });

        it('should call set value function if custom config exists', () => {
            spyOnStorageGet.mockReturnValue(of(settings));
            jest.spyOn(component.settingsForm, 'setValue');
            component.ngOnInit();
            expect(component.settingsForm.setValue).toHaveBeenCalled();
        });

        it('should get and apply custom settings', () => {
            spyOnStorageGet.mockReturnValue(of(settings));
            component.ngOnInit();
            expect(storage.get).toHaveBeenCalled();
            expect(component.settingsForm.value).toEqual({
                ...DEFAULT_SETTINGS,
                ...settings,
            });
        });
    });

    describe('Version check', () => {
        const latestVersion = '1.0.0';
        const currentVersion = '0.1.0';

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
            component.showVersionInformation(currentVersion);
            fixture.detectChanges();
            expect(translate.instant).toHaveBeenCalled();
        });
    });

    it('should send epg fetch command', () => {
        jest.spyOn(electronService, 'sendIpcEvent');
        const url = 'http://epg-url-here/data.xml';
        component.refreshEpg(url);
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(
            EPG_FORCE_FETCH,
            url
        );
    });

    it('should navigate back to home page', () => {
        jest.spyOn(router, 'navigateByUrl');
        component.backToHome();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('should save settings on submit', () => {
        jest.spyOn(storage, 'set').mockReturnValue(of([] as any));
        component.onSubmit();
        expect(storage.set).toHaveBeenCalled();
    });
});
