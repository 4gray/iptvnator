import { StorageMap } from '@ngx-pwa/local-storage';
import { FormBuilder } from '@angular/forms';
/* eslint-disable @typescript-eslint/unbound-method */
import { ElectronService } from './../services/electron.service';
import { ElectronServiceStub } from './../home/home.component.spec';
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
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { EPG_FETCH } from '../../../shared/ipc-commands';
import { Router } from '@angular/router';

class MatSnackBarStub {
    open(): void {}
}

export class MockRouter {
    navigateByUrl(url: string): string {
        return url;
    }
}

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;
    let electronService: ElectronService;
    let storage: StorageMap;
    let router: Router;

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
                    { provide: ElectronService, useClass: ElectronServiceStub },
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
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(SettingsComponent);
        electronService = TestBed.inject(ElectronService);
        storage = TestBed.inject(StorageMap);
        router = TestBed.inject(Router);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create and init component', () => {
        expect(component).toBeTruthy();
    });

    it('should send epg fetch command', () => {
        spyOn(electronService.ipcRenderer, 'send');
        component.fetchEpg();
        expect(electronService.ipcRenderer.send).toHaveBeenCalledWith(
            EPG_FETCH,
            { url: '' }
        );
    });

    it('should navigate back to home page', () => {
        spyOn(router, 'navigateByUrl');
        component.backToHome();
        expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });
});
