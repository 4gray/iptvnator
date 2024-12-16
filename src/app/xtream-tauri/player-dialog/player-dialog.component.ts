import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, Inject, ViewEncapsulation } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
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
