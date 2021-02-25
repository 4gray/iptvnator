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

class MatSnackBarStub {
    open(): void {}
}

describe('SettingsComponent', () => {
    let component: SettingsComponent;
    let fixture: ComponentFixture<SettingsComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    SettingsComponent,
                    MockComponent(HeaderComponent),
                    MockPipe(TranslatePipe),
                ],
                providers: [
                    { provide: MatSnackBar, useClass: MatSnackBarStub },
                    {
                        provide: TranslateService,
                        useClass: TranslateServiceStub,
                    },
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
        component = fixture.componentInstance;
    });

    it('should create and init component', () => {
        expect(component).toBeTruthy();
    });
});
