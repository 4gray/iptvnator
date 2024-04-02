import { ClipboardModule } from '@angular/cdk/clipboard';
import { NgIf } from '@angular/common';
import { Component, Inject, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WebPlayerViewComponent } from '../../portals/web-player-view/web-player-view.component';

export interface PlayerDialogData {
    streamUrl: string;
    title: string;
}

@Component({
    templateUrl: './player-dialog.component.html',
    standalone: true,
    imports: [
        ClipboardModule,
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        NgIf,
        TranslateModule,
        WebPlayerViewComponent,
    ],
    styles: `
        .content {
            overflow: hidden; 
                padding: 10px !important;
        }

        .link-input {
            padding: 10px;
            margin-right: 5px;
            border-radius: 4px;
            border: 0;
            width: 200px;
        }

        .align-actions {
            justify-content: space-between;
        }

        mat-dialog-content {
            .video-js {
                height: 500px !important;
            }
        }
    `,
    encapsulation: ViewEncapsulation.None,
})
export class PlayerDialogComponent {
    title: string;
    streamUrl: string;

    constructor(
        @Inject(MAT_DIALOG_DATA) data: PlayerDialogData,
        private snackBar: MatSnackBar,
        private translateService: TranslateService
    ) {
        this.streamUrl = data.streamUrl;
        this.title = data.title;
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
