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
            userAgent: '',
            playlistName: '  Custom Playlist  ',
            playlistUrl: 'wrong url here',
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeFalsy();

        component.form.setValue({
            userAgent: '',
            playlistName: '',
            playlistUrl: testUrl,
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeTruthy();

        component.form.setValue({
            userAgent: '',
            playlistName: '   ',
            playlistUrl: testUrl,
        });
        fixture.detectChanges();
        expect(component.form.valid).toBeTruthy();
    });

    it('clears the url playlist form', () => {
        component.form.setValue({
            userAgent: 'IPTVnator-Test/1.0',
            playlistName: 'News',
            playlistUrl: 'http://example.org/playlist.m3u',
        });
        component.form.markAsDirty();

        component.clearForm();

        expect(component.form.getRawValue()).toEqual({
            playlistName: '',
            playlistUrl: '',
            userAgent: '',
        });
        expect(component.form.pristine).toBeTruthy();
    });
});

describe('UrlUploadComponent form', () => {
    let component: UrlUploadComponent;
    let fixture: ComponentFixture<UrlUploadComponent>;

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [
                UrlUploadComponent,
                TranslateModule.forRoot(),
                NoopAnimationsModule,
            ],
            providers: [
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
            ],
        });
        fixture = TestBed.createComponent(UrlUploadComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    function fieldText(controlName: string): string {
        return (
            (fixture.nativeElement as HTMLElement)
                .querySelector(`[formcontrolname="${controlName}"]`)
                ?.closest('mat-form-field')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim() ?? ''
        );
    }

    it('labels the name field like the other add-source forms', () => {
        expect(fieldText('playlistName')).toContain(
            'HOME.XTREAM_PLAYLIST.TITLE'
        );
    });

    it('explains an invalid playlist URL once the field was touched', () => {
        const root = fixture.nativeElement as HTMLElement;
        const url = component.form.controls.playlistUrl;

        url.setValue('playlist.m3u');
        fixture.detectChanges();
        expect(root.querySelector('mat-error')).toBeNull();

        url.markAsTouched();
        fixture.detectChanges();
        expect(root.querySelector('mat-error')?.textContent?.trim()).toBe(
            'HOME.URL_UPLOAD.URL_VALIDATION_ERROR'
        );

        url.setValue('https://example.org/playlist.m3u');
        fixture.detectChanges();
        expect(root.querySelector('mat-error')).toBeNull();
    });
});
