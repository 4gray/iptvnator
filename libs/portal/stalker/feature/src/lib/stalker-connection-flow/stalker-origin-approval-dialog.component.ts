import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
    MAT_DIALOG_DATA,
    MatDialogModule,
    MatDialogRef,
} from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';

export interface StalkerOriginApprovalDialogData {
    readonly sourceOrigin: string;
    readonly finalOrigin: string;
}

@Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatButtonModule, MatDialogModule, TranslatePipe],
    selector: 'app-stalker-origin-approval-dialog',
    styles: `
        .origin-context {
            display: grid;
            gap: 1rem;
            margin: 1rem 0 0;
        }

        .origin-context div {
            min-width: 0;
        }

        dt {
            color: var(--mat-sys-on-surface-variant);
            font: var(--mat-sys-label-medium);
        }

        dd {
            margin: 0.25rem 0 0;
            overflow-wrap: anywhere;
        }
    `,
    template: `
        <h2 mat-dialog-title>
            {{ 'HOME.STALKER_PORTAL.ORIGIN_APPROVAL_TITLE' | translate }}
        </h2>
        <mat-dialog-content>
            <p>
                {{
                    'HOME.STALKER_PORTAL.ORIGIN_APPROVAL_DESCRIPTION'
                        | translate
                }}
            </p>
            <dl class="origin-context">
                <div>
                    <dt>
                        {{ 'HOME.STALKER_PORTAL.ORIGIN_SOURCE' | translate }}
                    </dt>
                    <dd>{{ data.sourceOrigin }}</dd>
                </div>
                <div>
                    <dt>
                        {{ 'HOME.STALKER_PORTAL.ORIGIN_TARGET' | translate }}
                    </dt>
                    <dd>{{ data.finalOrigin }}</dd>
                </div>
            </dl>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button type="button" (click)="reject()">
                {{ 'CANCEL' | translate }}
            </button>
            <button mat-flat-button type="button" (click)="approve()">
                {{ 'HOME.STALKER_PORTAL.APPROVE_ORIGIN' | translate }}
            </button>
        </mat-dialog-actions>
    `,
})
export class StalkerOriginApprovalDialogComponent {
    private readonly dialogRef =
        inject<
            MatDialogRef<StalkerOriginApprovalDialogComponent, boolean>
        >(MatDialogRef);
    readonly data = inject<StalkerOriginApprovalDialogData>(MAT_DIALOG_DATA);

    approve(): void {
        this.dialogRef.close(true);
    }

    reject(): void {
        this.dialogRef.close(false);
    }
}
