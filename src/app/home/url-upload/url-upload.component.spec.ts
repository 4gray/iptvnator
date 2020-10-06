import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { UrlUploadComponent } from './url-upload.component';
import { MockModule } from 'ng-mocks';
import { MatInputModule } from '@angular/material/input';

describe('UrlUploadComponent', () => {
    let component: UrlUploadComponent;
    let fixture: ComponentFixture<UrlUploadComponent>;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [UrlUploadComponent],
            imports: [MockModule(MatInputModule)],
        }).compileComponents();
    }));

    beforeEach(() => {
        fixture = TestBed.createComponent(UrlUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('submit form with playlist url', async(() => {
        spyOn(component.urlAdded, 'emit');
        const TEST_URL = 'http://example.org/playlist.m3u';
        const input = fixture.debugElement.query(By.css('input'));
        const el = input.nativeElement;

        const submitButton = fixture.debugElement.nativeElement.querySelector(
            'button'
        );
        expect(submitButton.disabled).toBeTruthy();
        el.value = TEST_URL;
        fixture.detectChanges();
        expect(submitButton.disabled).toBeFalsy();

        const form = fixture.debugElement.query(By.css('form'));
        form.triggerEventHandler('ngSubmit', null);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(component.urlAdded.emit).toHaveBeenCalledWith(TEST_URL);
    }));
});
