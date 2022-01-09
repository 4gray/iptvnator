import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { By } from '@angular/platform-browser';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslatePipe } from '@ngx-translate/core';
import { MockModule, MockPipe } from 'ng-mocks';
import { DataService } from '../../services/data.service';
import { ElectronServiceStub } from '../../services/electron.service.stub';
import { UrlUploadComponent } from './url-upload.component';

describe('UrlUploadComponent', () => {
    let component: UrlUploadComponent;
    let fixture: ComponentFixture<UrlUploadComponent>;

    beforeEach(
        waitForAsync(() => {
            TestBed.configureTestingModule({
                declarations: [UrlUploadComponent, MockPipe(TranslatePipe)],
                imports: [
                    MockModule(MatInputModule),
                    MockModule(MatCardModule),
                    FormsModule,
                    ReactiveFormsModule,
                    NoopAnimationsModule,
                ],
                providers: [
                    {
                        provide: DataService,
                        useClass: ElectronServiceStub,
                    },
                ],
            }).compileComponents();
        })
    );

    beforeEach(() => {
        fixture = TestBed.createComponent(UrlUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it(
        'submit form with playlist url',
        waitForAsync(() => {
            jest.spyOn(component.urlAdded, 'emit');
            const TEST_URL = 'http://example.org/playlist.m3u';
            const submitButton =
                fixture.debugElement.nativeElement.querySelector('button');

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
        })
    );
});
