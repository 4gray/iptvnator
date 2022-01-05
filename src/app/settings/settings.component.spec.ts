import { MatCheckboxModule } from '@angular/material/checkbox';
import { StorageMap } from '@ngx-pwa/local-storage';
/* eslint-disable @typescript-eslint/unbound-method */
import { DataService } from '../services/data.service';
import { ElectronServiceStub } from '../services/electron.service.stub';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatCardModule } from '@angular/material/card';
import { HeaderComponent } from './../shared/components/header/header.component';
import { TranslateServiceStub } from './../../testing/translate.stub';
import { RouterTestingModule } from '@angular/router/testing';
import { SettingsComponent } from './settings.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { MockModule, MockPipe, MockComponent } from 'ng-mocks';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { VideoPlayer } from './settings.interface';
import { Language } from './language.enum';
import { Theme } from './theme.enum';

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
    epgUrl: '',
    language: Language.ENGLISH,
    showCaptions: false,
    theme: Theme.LightTheme,
};

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: DataService;
    let router: Router;
    let storage: StorageMap;
    let translate: TranslateService;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    SettingsComponent,
                    MockComponent(HeaderComponent),
                    MockPipe(TranslatePipe),
                ],
                providers: [
                    FormBuilder,
                    { provide: MatSnackBar, useClass: MatSnackBarStub },
                    {
                        provide: TranslateService,
                        useClass: TranslateServiceStub,
                    },
                    { provide: DataService, useClass: ElectronServiceStub },
                    {
                        provide: Router,
                        useClass: MockRouter,
                    },
                    StorageMap,
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
                ],
            }).compileComponents();
        })
    );

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
        const settings = { player: 'test', showCaptions: true };
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
        component.fetchEpg();
        expect(electronService.sendIpcEvent).toHaveBeenCalledWith(EPG_FETCH, {
            url: '',
        });
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
