import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { UrlUploadComponent } from './url-upload.component';
import { MockModule } from 'ng-mocks';
import { MatInputModule } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

describe('UrlUploadComponent', () => {
    let component: UrlUploadComponent;
    let fixture: ComponentFixture<UrlUploadComponent>;

    beforeEach(async(() => {
        TestBed.configureTestingModule({
            declarations: [UrlUploadComponent],
            imports: [
                MockModule(MatInputModule),
                FormsModule,
                ReactiveFormsModule,
            ],
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
        const submitButton = fixture.debugElement.nativeElement.querySelector(
            'button'
        );

        // test input field validation
        expect(submitButton.disabled).toBeTruthy();
        component.form.setValue({ playlistUrl: 'wrong url here' });
        fixture.detectChanges();
        expect(submitButton.disabled).toBeTruthy();
        component.form.setValue({ playlistUrl: TEST_URL + '8' });
        fixture.detectChanges();
        expect(submitButton.disabled).toBeFalsy();
        component.form.setValue({ playlistUrl: TEST_URL });
        fixture.detectChanges();
        expect(submitButton.disabled).toBeFalsy();

        const form = fixture.debugElement.query(By.css('form'));
        form.triggerEventHandler('ngSubmit', null);

        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(component.urlAdded.emit).toHaveBeenCalledWith(TEST_URL);
    }));
});
