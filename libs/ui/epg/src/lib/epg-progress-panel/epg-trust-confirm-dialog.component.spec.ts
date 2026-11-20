import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { EpgTrustConfirmDialogComponent } from './epg-trust-confirm-dialog.component';

describe('EpgTrustConfirmDialogComponent', () => {
    it('heads the warning with a warn icon, the title and the source it trusts', async () => {
        await TestBed.configureTestingModule({
            imports: [
                EpgTrustConfirmDialogComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: MAT_DIALOG_DATA,
                    useValue: {
                        title: 'Trust invalid certificate?',
                        subtitle: 'Certificate for epg.example.test',
                        message: 'Only continue if you trust this host.',
                        confirmLabel: 'Trust host',
                    },
                },
                { provide: MatDialogRef, useValue: { close: jest.fn() } },
            ],
        }).compileComponents();
        const fixture = TestBed.createComponent(EpgTrustConfirmDialogComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const text = (selector: string) =>
            root.querySelector(selector)?.textContent?.trim();

        expect(text('.app-dialog__icon--warn')).toBe('gpp_maybe');
        expect(text('.app-dialog__title')).toBe('Trust invalid certificate?');
        expect(text('.app-dialog__subtitle')).toBe(
            'Certificate for epg.example.test'
        );
        expect(text('.app-dialog__body')).toContain(
            'Only continue if you trust this host.'
        );
        const footer = Array.from(
            root.querySelectorAll('[appDialogFooter] button')
        ).map((button) => button.textContent?.trim());
        expect(footer).toEqual(['CANCEL', 'Trust host']);
    });
});
