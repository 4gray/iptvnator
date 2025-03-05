import { NgIf } from '@angular/common';
import {
    Component,
    Signal,
    ViewEncapsulation,
    effect,
    inject,
    input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { StorageMap } from '@ngx-pwa/local-storage';
import { getExtensionFromUrl } from '../../../../shared/playlist.utils';
import { ArtPlayerComponent } from '../../player/components/art-player/art-player.component';
import { DPlayerComponent } from '../../player/components/d-player/d-player.component';
import { HtmlVideoPlayerComponent } from '../../player/components/html-video-player/html-video-player.component';
import { VjsPlayerComponent } from '../../player/components/vjs-player/vjs-player.component';
import { Settings, VideoPlayer } from '../../settings/settings.interface';
import { STORE_KEY } from '../../shared/enums/store-keys.enum';

@Component({
    standalone: true,
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
    imports: [
        HtmlVideoPlayerComponent,
        NgIf,
        VjsPlayerComponent,
        DPlayerComponent,
        ArtPlayerComponent,
    ],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent {
    storage = inject(StorageMap);

    streamUrl = input.required<string>();

    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;

    channel: { url: string };
    player: VideoPlayer;
    vjsOptions: { sources: { src: string; type: string }[] };

    constructor() {
        effect(
            () => {
                this.player = this.settings()?.player ?? VideoPlayer.VideoJs;

                this.setChannel(this.streamUrl());
                this.setVjsOptions(this.streamUrl());
            },
            { allowSignalWrites: true }
        );
    }

    setVjsOptions(streamUrl: string) {
        const extension = getExtensionFromUrl(streamUrl);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8' || extension === 'ts'
                ? 'application/x-mpegURL'
                : 'video/mp4';

        this.vjsOptions = {
            sources: [{ src: streamUrl, type: mimeType }],
        };
    }

    setChannel(streamUrl: string) {
        this.channel = {
            url: streamUrl,
        };
    }
}
