import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SettingsStore } from '@iptvnator/services';
import { EpgItemDialogData } from './epg-item-description/epg-item-description.component';
import {
    EPG_PROGRAMME_DIALOG_CONFIG,
    EpgProgrammeDialogService,
} from './epg-programme-dialog.service';

@Component({ template: '' })
class HostComponent {}

const programme: EpgItemDialogData = {
    start: '2026-04-05T11:30:00.000Z',
    stop: '2026-04-05T12:30:00.000Z',
    channel: 'channel-1',
    title: 'Evening Show',
    desc: 'An evening programme',
    category: null,
};

describe('EpgProgrammeDialogService', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [NoopAnimationsModule, TranslateModule.forRoot()],
            providers: [
                {
                    provide: SettingsStore,
                    useValue: { resolvedEpgOffsetMinutes: signal(0) },
                },
            ],
        });
    });

    afterEach(() => {
        TestBed.inject(MatDialog).closeAll();
    });

    async function openDialog(
        data: EpgItemDialogData = programme
    ): Promise<HTMLElement> {
        const fixture = TestBed.createComponent(HostComponent);
        TestBed.inject(EpgProgrammeDialogService).open(data);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();

        const container = document.querySelector<HTMLElement>(
            'mat-dialog-container'
        );
        if (!container) {
            throw new Error('The programme dialog did not open');
        }
        return container;
    }

    it('opens at 540px inside the panel class that scopes its surface', async () => {
        const container = await openDialog();
        const pane = container.closest<HTMLElement>('.cdk-overlay-pane');

        expect(pane?.style.width).toBe('540px');
        expect(pane?.classList).toContain(
            EPG_PROGRAMME_DIALOG_CONFIG.panelClass
        );
    });

    it('names the dialog after the programme title', async () => {
        const container = await openDialog();
        const labelId = container.getAttribute('aria-labelledby');

        expect(labelId).toBeTruthy();
        expect(
            document.getElementById(labelId ?? '')?.textContent?.trim()
        ).toBe('Evening Show');
    });

    it('offers one dismiss first and the primary action last', async () => {
        const container = await openDialog({
            ...programme,
            primaryAction: 'timeshift',
            archiveUrlAvailable: true,
            archiveDownloadAvailable: true,
        });

        // Only the Close button closes without a result; the hero carries
        // no second close affordance.
        const dismissButtons = container.querySelectorAll(
            'button[mat-dialog-close]'
        );
        expect(dismissButtons).toHaveLength(1);

        const footer = Array.from(
            container.querySelectorAll('.epg-dialog__actions button')
        );
        expect(footer).toHaveLength(2);
        expect(footer[0]).toBe(dismissButtons[0]);
        expect(footer[1].classList).toContain('epg-dialog__btn--primary');

        // The archive tools stay with their notice, outside the footer row.
        const tools = container.querySelector('.epg-dialog__tools');
        expect(
            tools?.querySelector('[data-testid="copy-catchup-url"]')
        ).toBeTruthy();
        expect(
            tools?.querySelector('[data-testid="download-catchup"]')
        ).toBeTruthy();
    });

    it('keeps the lone dismiss when the programme has no action', async () => {
        const container = await openDialog();
        const footer = Array.from(
            container.querySelectorAll('.epg-dialog__actions button')
        );

        expect(footer).toHaveLength(1);
        expect(footer[0].classList).toContain('epg-dialog__close');
        expect(container.querySelector('.epg-dialog__tools')).toBeNull();
    });
});
