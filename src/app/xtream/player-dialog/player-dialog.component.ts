import { NgIf } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { getExtensionFromUrl } from '../../../../shared/playlist.utils';
import { HtmlVideoPlayerComponent } from '../../player/components/html-video-player/html-video-player.component';
import { VjsPlayerComponent } from '../../player/components/vjs-player/vjs-player.component';
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
    imports: [
        HtmlVideoPlayerComponent,
        MatDialogModule,
        NgIf,
        VjsPlayerComponent,
    ],
})
export class PlayerDialogComponent {
    channel = {};
    vjsOptions = {};
    player: VideoPlayer;
    title: string;

    constructor(@Inject(MAT_DIALOG_DATA) data: DialogData) {
        this.player = data.player;
        this.title = data.title;

        const extension = getExtensionFromUrl(data.streamUrl);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8' || extension === 'ts'
                ? 'application/x-mpegURL'
                : 'video/mp4';

        this.vjsOptions = {
            sources: [{ src: data.streamUrl, type: mimeType }],
        };
        this.channel = {
            url: data.streamUrl,
        };
    }
}
