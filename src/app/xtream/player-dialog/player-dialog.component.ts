import { NgIf } from '@angular/common';
import { Component, Inject, ViewEncapsulation } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { WebPlayerViewComponent } from '../../portals/web-player-view/web-player-view.component';
import { VideoPlayer } from '../../settings/settings.interface';

interface DialogData {
    streamUrl: string;
    player: VideoPlayer;
    title: string;
}

@Component({
    selector: 'app-player-dialog',
    templateUrl: './player-dialog.component.html',
    standalone: true,
    imports: [MatDialogModule, NgIf, WebPlayerViewComponent],
    styles: `
        .content {
            overflow: hidden; 
                padding: 10px !important;
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

    constructor(@Inject(MAT_DIALOG_DATA) data: DialogData) {
        this.streamUrl = data.streamUrl;
        this.title = data.title;
    }
}
