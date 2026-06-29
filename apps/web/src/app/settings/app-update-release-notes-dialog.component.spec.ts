import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { AppUpdateReleaseNotesDialogComponent } from './app-update-release-notes-dialog.component';

const releaseNotes = {
    bodyMarkdown: '## v0.23.0\n\n- Added **desktop updater**',
    hasNext: false,
    hasPrevious: true,
    htmlUrl: 'https://github.com/4gray/iptvnator/releases/tag/v0.23.0',
    publishedAt: '2026-06-28T00:00:00.000Z',
    releaseName: 'v0.23.0',
    tagName: 'v0.23.0',
    version: '0.23.0',
};

describe('AppUpdateReleaseNotesDialogComponent', () => {
    let fixture: ComponentFixture<AppUpdateReleaseNotesDialogComponent>;
    const originalElectron = window.electron;

    beforeEach(async () => {
        window.electron = {
            getAppUpdateReleaseNotes: jest.fn().mockResolvedValue(releaseNotes),
        } as unknown as typeof window.electron;

        await TestBed.configureTestingModule({
            imports: [
                AppUpdateReleaseNotesDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        fallbackToLatest: true,
                        initialVersion: '0.23.0',
                    },
                },
                {
                    provide: MatDialogRef,
                    useValue: { close: jest.fn() },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AppUpdateReleaseNotesDialogComponent);
    });

    afterEach(() => {
        window.electron = originalElectron;
    });

    it('loads and renders markdown release notes for the initial version', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(window.electron.getAppUpdateReleaseNotes).toHaveBeenCalledWith({
            fallbackToLatest: true,
            version: '0.23.0',
        });
        expect(
            fixture.nativeElement.querySelector('[data-test-id="release-notes-body"] h2')
                ?.textContent
        ).toContain('v0.23.0');
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="release-notes-body"] strong'
            )?.textContent
        ).toContain('desktop updater');
    });

    it('constrains rendered markdown images to the dialog width', async () => {
        (
            window.electron.getAppUpdateReleaseNotes as jest.Mock
        ).mockResolvedValueOnce({
            ...releaseNotes,
            bodyMarkdown:
                '![Application screenshot](https://example.com/screenshot.png)',
        });

        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const image = fixture.nativeElement.querySelector(
            '[data-test-id="release-notes-body"] img'
        ) as HTMLImageElement;

        expect(image).toBeTruthy();
        expect(image.classList).toContain('release-notes-dialog__image');
    });

    it('loads previous notes lazily without closing the dialog', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        (
            window.electron.getAppUpdateReleaseNotes as jest.Mock
        ).mockResolvedValueOnce({
            ...releaseNotes,
            bodyMarkdown: '## v0.22.0\n\nOlder release',
            hasNext: true,
            hasPrevious: false,
            tagName: 'v0.22.0',
            version: '0.22.0',
        });

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="release-notes-previous"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(window.electron.getAppUpdateReleaseNotes).toHaveBeenLastCalledWith({
            direction: 'previous',
            version: 'v0.23.0',
        });
    });
});
