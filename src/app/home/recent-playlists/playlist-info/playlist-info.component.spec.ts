import { ElectronServiceStub } from './../../home.component.spec';
import { ElectronService } from './../../../services/electron.service';
import { TranslatePipe } from '@ngx-translate/core';
import { MockModule, MockPipe } from 'ng-mocks';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { PlaylistInfoComponent } from './playlist-info.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                imports: [
                    MockModule(FormsModule),
                    MockModule(MatDialogModule),
                    MockModule(MatFormFieldModule),
                    ReactiveFormsModule,
                ],
                declarations: [PlaylistInfoComponent, MockPipe(TranslatePipe)],
                providers: [
                    { provide: MAT_DIALOG_DATA, useValue: {} },
                    { provide: ElectronService, useClass: ElectronServiceStub },
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(PlaylistInfoComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
