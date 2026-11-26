import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import {
    DialogFooterDirective,
    DialogShellComponent,
} from '@iptvnator/ui/dialog';

/**
 * Asks before the EPG import trusts a private-network source or an invalid
 * certificate. Opened from the import panel's error row.
 */
export interface EpgTrustConfirmDialogData {
    confirmLabel: string;
    message: string;
    /** The EPG source or host the trust applies to. */
    subtitle: string;
    title: string;
}

@Component({
    selector: 'app-epg-trust-confirm-dialog',
    imports: [
        DialogFooterDirective,
        DialogShellComponent,
        MatButtonModule,
        MatDialogModule,
        TranslatePipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <app-dialog-shell
            icon="gpp_maybe"
            iconTone="warn"
            [heading]="data.title"
            [subtitle]="data.subtitle"
        >
            {{ data.message }}
            <div appDialogFooter>
                <button mat-button mat-dialog-close cdkFocusInitial>
                    {{ 'CANCEL' | translate }}
                </button>
                <button mat-flat-button [mat-dialog-close]="true">
                    {{ data.confirmLabel }}
                </button>
            </div>
        </app-dialog-shell>
    `,
})
export class EpgTrustConfirmDialogComponent {
    readonly data = inject<EpgTrustConfirmDialogData>(MAT_DIALOG_DATA);
}
