import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { VjsPlayerComponent } from '../../player/components/vjs-player/vjs-player.component';

@Component({
    selector: 'app-player-dialog',
    templateUrl: './player-dialog.component.html',
    standalone: true,
    imports: [VjsPlayerComponent, MatDialogModule],
})
export class PlayerDialogComponent {
    streamUrl: string;

    constructor(@Inject(MAT_DIALOG_DATA) streamUrl: any) {
        this.streamUrl = streamUrl;
    }
}
