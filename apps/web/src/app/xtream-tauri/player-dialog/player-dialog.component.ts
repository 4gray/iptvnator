import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, inject, ViewEncapsulation } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { WebPlayerViewComponent } from 'shared-portals';

export interface PlayerDialogData {
    streamUrl: string;
    title: string;
}

@Component({
    templateUrl: './player-dialog.component.html',
    imports: [
        ClipboardModule,
        MatButton,
        MatDialogModule,
        MatIcon,
        MatTooltip,
        TranslatePipe,
        WebPlayerViewComponent,
    ],
    styleUrl: './player-dialog.component.scss',
    encapsulation: ViewEncapsulation.None,
})
export class PlayerDialogComponent {
    readonly data = inject<PlayerDialogData>(MAT_DIALOG_DATA);
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
