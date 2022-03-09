import { MockPipe } from 'ng-mocks';
import { MomentDatePipe } from './../../../shared/pipes/moment-date.pipe';
/* tslint:disable:no-unused-variable */
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';

import { InfoOverlayComponent } from './info-overlay.component';

describe('InfoOverlayComponent', () => {
    let component: InfoOverlayComponent;
    let fixture: ComponentFixture<InfoOverlayComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [InfoOverlayComponent, MockPipe(MomentDatePipe)],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(InfoOverlayComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });
});
