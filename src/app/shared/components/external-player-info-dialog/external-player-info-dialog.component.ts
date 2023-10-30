import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { PlayerViewComponent } from '../../../xtream/player-view/player-view.component';

@Component({
    standalone: true,
    template: `
        <h2 mat-dialog-title>Information</h2>
        <mat-dialog-content class="mat-typography">
            <app-player-view />
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close cdkFocusInitial color="accent">
                {{ 'CLOSE' | translate }}
            </button>
        </mat-dialog-actions>
    `,
    imports: [
        MatButtonModule,
        MatDialogModule,
        PlayerViewComponent,
        TranslateModule,
    ],
})
export class ExternalPlayerInfoDialogComponent {}
