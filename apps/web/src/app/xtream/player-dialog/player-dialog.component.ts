import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, inject, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WebPlayerViewComponent } from 'shared-portals';

export interface PlayerDialogData {
    streamUrl: string;
    title: string;
}

@Component({
    templateUrl: './player-dialog.component.html',
    imports: [
        ClipboardModule,
        MatButtonModule,
        MatDialogModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        TranslateModule,
        WebPlayerViewComponent,
    ],
    styleUrl: './player-dialog.component.scss',
    encapsulation: ViewEncapsulation.None,
})
export class PlayerDialogComponent {
    readonly data = inject(MAT_DIALOG_DATA) as PlayerDialogData;
    private snackBar = inject(MatSnackBar);
    private translateService = inject(TranslateService);

    readonly title: string;
    readonly streamUrl: string;

    constructor() {
        this.streamUrl = this.data.streamUrl;
        this.title = this.data.title;
    }

    showCopyNotification() {
        this.snackBar.open(
            this.translateService.instant('PORTALS.STREAM_URL_COPIED'),
            null,
            {
                duration: 2000,
            }
        );
    }
}
