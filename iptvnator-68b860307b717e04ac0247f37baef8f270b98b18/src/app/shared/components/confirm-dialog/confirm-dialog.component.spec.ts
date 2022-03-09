import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MockModule, MockPipe, MockProvider } from 'ng-mocks';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import {
    MatDialog,
    MatDialogModule,
    MAT_DIALOG_DATA,
} from '@angular/material/dialog';

describe('ConfirmDialogComponent', () => {
    let component: ConfirmDialogComponent;
    let fixture: ComponentFixture<ConfirmDialogComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [
                    ConfirmDialogComponent,
                    MockPipe(TranslatePipe, (value) => JSON.stringify(value)),
                ],
                providers: [
                    MockProvider(MatDialog),
                    MockProvider(MAT_DIALOG_DATA),
                    MockProvider(TranslateService),
                ],
                imports: [MockModule(MatDialogModule)],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(ConfirmDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
