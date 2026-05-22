import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MockModule } from 'ng-mocks';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { UrlUploadComponent } from './url-upload.component';

describe('UrlUploadComponent', () => {
    let component: UrlUploadComponent;
    let fixture: ComponentFixture<UrlUploadComponent>;
    let runtime: {
        isElectron: boolean;
    };

    beforeEach(waitForAsync(() => {
        runtime = {
            isElectron: true,
        };

        TestBed.configureTestingModule({
            imports: [
                UrlUploadComponent,
                MockModule(FormsModule),
                MockModule(MatFormFieldModule),
                MockModule(ReactiveFormsModule),
                TranslateModule.forRoot(),
                NoopAnimationsModule,
            ],
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: runtime,
                },
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

    it('shows the CORS note only when Electron is unavailable', () => {
        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.cors-note')
        ).toBeNull();

        fixture.destroy();
        runtime.isElectron = false;
        fixture = TestBed.createComponent(UrlUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();

        expect(
            (fixture.nativeElement as HTMLElement).querySelector('.cors-note')
        ).not.toBeNull();
    });

    it('accepts an optional playlist name without affecting url validation', () => {
        const testUrl = 'http://example.org/playlist.m3u';

        component.form.setValue({
            playlistName: '  Custom Playlist  ',
            playlistUrl: 'wrong url here',
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeFalsy();

        component.form.setValue({
            playlistName: '',
            playlistUrl: testUrl,
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeTruthy();

        component.form.setValue({
            playlistName: '   ',
            playlistUrl: testUrl,
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeTruthy();
    });

    it('clears the url playlist form', () => {
        component.form.setValue({
            playlistName: 'News',
            playlistUrl: 'http://example.org/playlist.m3u',
        });
        component.form.markAsDirty();

        component.clearForm();

        expect(component.form.getRawValue()).toEqual({
            playlistName: '',
            playlistUrl: '',
        });
        expect(component.form.pristine).toBeTruthy();
    });
});
