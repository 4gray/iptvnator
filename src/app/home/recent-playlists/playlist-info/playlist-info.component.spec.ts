import { MockModule } from 'ng-mocks';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { PlaylistInfoComponent } from './playlist-info.component';

describe('PlaylistInfoComponent', () => {
    let component: PlaylistInfoComponent;
    let fixture: ComponentFixture<PlaylistInfoComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                imports: [
                    MockModule(MatDialogModule),
                    MockModule(MatFormFieldModule),
                ],
                declarations: [PlaylistInfoComponent],
                providers: [{ provide: MAT_DIALOG_DATA, useValue: {} }],
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
