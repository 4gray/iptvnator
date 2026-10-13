import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import { AddPlaylistDialogComponent } from './add-playlist-dialog.component';

/**
 * The dialog is OnPush and its Add button reads `form.valid` of the real URL
 * import child. The fixture renders on its own (`autoDetectChanges`): a
 * forced `detectChanges()` would hide a button that does not follow the
 * child form.
 */
describe('AddPlaylistDialogComponent with the real URL form', () => {
    let fixture: ComponentFixture<AddPlaylistDialogComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                AddPlaylistDialogComponent,
                TranslateModule.forRoot(),
                NoopAnimationsModule,
            ],
            providers: [
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
                { provide: Store, useValue: { dispatch: jest.fn() } },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: MAT_DIALOG_DATA, useValue: null },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AddPlaylistDialogComponent);
        fixture.autoDetectChanges();
        await settle();
    });

    async function settle(): Promise<void> {
        await fixture.whenStable();
        // The render a form change schedules runs in the next macrotask.
        await new Promise((resolve) => setTimeout(resolve));
    }

    const addButton = () =>
        Array.from(
            (
                fixture.nativeElement as HTMLElement
            ).querySelectorAll<HTMLButtonElement>('button[mat-flat-button]')
        ).find((button) =>
            button.textContent?.includes('HOME.URL_UPLOAD.ADD_PLAYLIST')
        );
    const urlInput = () =>
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
            'input[formcontrolname="playlistUrl"]'
        );

    it('enables Add once the user types a playlist URL', async () => {
        expect(addButton()?.disabled).toBe(true);

        const input = urlInput();
        if (!input) throw new Error('Expected the URL input');
        input.value = 'https://example.com/list.m3u';
        input.dispatchEvent(new Event('input'));
        await settle();

        expect(addButton()?.disabled).toBe(false);
    });

    it('enables Add when the child form is filled without a template event', async () => {
        expect(addButton()?.disabled).toBe(true);

        // As an auto-detect prefill does: a patch from outside the child.
        fixture.componentInstance
            .urlUpload()
            ?.form.patchValue({ playlistUrl: 'https://example.com/list.m3u' });
        await settle();

        expect(addButton()?.disabled).toBe(false);
    });
});
