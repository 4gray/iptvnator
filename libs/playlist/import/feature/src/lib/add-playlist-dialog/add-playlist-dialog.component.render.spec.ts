import { EMPTY } from 'rxjs';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DataService, RuntimeCapabilitiesService } from '@iptvnator/services';
import { StalkerPortalDiscoveryService } from '@iptvnator/portal/stalker/data-access';
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
                {
                    provide: StalkerPortalDiscoveryService,
                    useValue: { discover: jest.fn() },
                },
                { provide: DataService, useValue: { sendIpcEvent: jest.fn() } },
                {
                    provide: MatDialogRef,
                    useValue: { close: jest.fn(), beforeClosed: () => EMPTY },
                },
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

    it('keeps provider and URL drafts in the dialog and resets only the cleared method', async () => {
        const component = fixture.componentInstance;
        component.selectMethod('xtream');
        await settle();
        component.xtreamImport()!.form.patchValue({
            title: 'Draft',
            serverUrl: 'https://fixture.example',
            username: 'draft-user',
            password: 'draft-password',
        });
        component.selectMethod('url');
        await settle();
        component.urlUpload()!.form.patchValue({
            playlistUrl: 'https://fixture.example/list.m3u',
            playlistName: 'M3U draft',
        });
        component.selectMethod('xtream');
        await settle();
        expect(component.xtreamImport()!.form.getRawValue()).toMatchObject({
            title: 'Draft',
            username: 'draft-user',
            password: 'draft-password',
        });
        expect(
            (
                fixture.nativeElement as HTMLElement
            ).querySelector<HTMLInputElement>('#password')?.type
        ).toBe('password');
        component.clearCurrentForm();
        component.selectMethod('url');
        await settle();
        expect(component.urlUpload()!.form.controls.playlistName.value).toBe(
            'M3U draft'
        );
        component.selectMethod('xtream');
        await settle();
        expect(component.xtreamImport()!.form.controls.username.value).toBe('');
    });

    it('lets a newly detected candidate replace an older method draft', async () => {
        const component = fixture.componentInstance;
        component.selectMethod('xtream');
        await settle();
        component
            .xtreamImport()!
            .form.patchValue({ username: 'old', password: 'old' });
        component.selectMethod('auto');
        await settle();
        component.onCandidateSelected({
            kind: 'xtream',
            confidence: 'high',
            serverUrl: 'https://new.example',
            username: 'new',
            password: 'new',
        });
        await settle();
        expect(component.xtreamImport()!.form.controls.username.value).toBe(
            'new'
        );
    });

    it('keeps an existing draft when an intermediate method has not mounted yet', async () => {
        const component = fixture.componentInstance;
        component.urlUpload()!.form.patchValue({ playlistName: 'Keep me' });
        component.selectMethod('xtream');
        await settle();
        component.selectMethod('url');
        component.selectMethod('text');
        await settle();
        component.selectMethod('url');
        await settle();
        expect(component.urlUpload()!.form.controls.playlistName.value).toBe(
            'Keep me'
        );
    });

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

    it('offers an optional Xtream handoff and preserves the URL draft on return', async () => {
        const draft = {
            playlistUrl:
                'https://panel.example:8443/base/get.php?username=alice&password=p%26ss&type=m3u_plus',
            playlistName: 'My provider',
            userAgent: 'VLC/3.0.21',
        };
        const root = fixture.nativeElement as HTMLElement;
        fixture.componentInstance.urlUpload()?.form.setValue(draft);
        await settle();
        const suggestion = root.querySelector<HTMLElement>(
            '[data-test-id="xtream-url-suggestion"]'
        );
        expect(suggestion).not.toBeNull();
        expect(addButton()?.disabled).toBe(false);
        suggestion?.querySelector('button')?.click();
        await settle();

        expect(fixture.componentInstance.method()).toBe('xtream');
        expect(
            fixture.componentInstance.xtreamImport()?.form.getRawValue()
        ).toMatchObject({
            title: 'My provider',
            serverUrl: 'https://panel.example:8443/base',
            username: 'alice',
            password: 'p&ss',
            userAgent: 'VLC/3.0.21',
        });
        expect(
            root.querySelector<HTMLDetailsElement>(
                '[data-test-id="xtream-advanced-settings"]'
            )?.open
        ).toBe(true);
        expect(root.querySelector('app-url-upload')).toBeNull();
        fixture.componentInstance.backToM3u();
        await settle();
        expect(
            fixture.componentInstance.urlUpload()?.form.getRawValue()
        ).toEqual(draft);
        expect(
            root.querySelector<HTMLDetailsElement>(
                '[data-test-id="url-advanced-settings"]'
            )?.open
        ).toBe(true);
        expect(root.querySelector('app-url-upload')).not.toBeNull();

        fixture.componentInstance.urlUpload()?.clearForm();
        await settle();
        expect(
            root.querySelector('[data-test-id="xtream-url-suggestion"]')
        ).toBeNull();
        expect(addButton()?.disabled).toBe(true);
    });

    it('leaves regular M3U links available without a suggestion', async () => {
        fixture.componentInstance
            .urlUpload()
            ?.form.patchValue({ playlistUrl: 'https://example.com/list.m3u' });
        await settle();
        expect(
            (fixture.nativeElement as HTMLElement).querySelector(
                '[data-test-id="xtream-url-suggestion"]'
            )
        ).toBeNull();
        expect(addButton()?.disabled).toBe(false);
    });
});
