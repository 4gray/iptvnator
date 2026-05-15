import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    input,
    output,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

@Component({
    selector: 'app-external-playback-dock',
    imports: [
        MatButtonModule,
        MatIcon,
        MatProgressSpinnerModule,
        TranslatePipe,
    ],
    templateUrl: './external-playback-dock.component.html',
    styleUrl: './external-playback-dock.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalPlaybackDockComponent {
    readonly session = input.required<ExternalPlayerSession>();
    readonly compact = input(false);

    readonly closeClicked = output<void>();
    readonly artworkClicked = output<void>();
    private readonly artworkFailed = signal(false);

    readonly playerLabel = computed(() => this.session().player.toUpperCase());
    readonly artworkUrl = computed(
        () => this.session().thumbnail?.trim() ?? ''
    );
    readonly statusLabel = computed(() => {
        const session = this.session();

        switch (session.status) {
            case 'launching':
                return 'Launching…';
            case 'opened':
            case 'playing':
                return 'Opened';
            case 'error':
                return session.error || 'Playback failed';
            default:
                return 'Closed';
        }
    });

    readonly statusIcon = computed(() => {
        const status = this.session().status;
        if (status === 'error') return 'error_outline';
        return 'open_in_new';
    });

    readonly showSpinner = computed(
        () => this.session().status === 'launching'
    );
    readonly showStatusIcon = computed(
        () => this.session().status !== 'launching'
    );
    readonly showArtwork = computed(
        () => !!this.artworkUrl() && !this.artworkFailed()
    );
    readonly artworkPlaceholderIcon = computed(() => {
        const contentType = this.session().contentInfo?.contentType;

        switch (contentType) {
            case 'vod':
                return 'movie';
            case 'episode':
                return 'video_library';
            default:
                return 'live_tv';
        }
    });
    readonly artworkInteractive = computed(
        () => !!this.session().contentInfo?.playlistId
    );
    readonly showCloseButton = computed(
        () => this.session().canClose && this.session().status !== 'error'
    );

    constructor() {
        effect(() => {
            this.artworkUrl();
            this.artworkFailed.set(false);
        });
    }

    onArtworkError(): void {
        this.artworkFailed.set(true);
    }

    onArtworkClick(): void {
        if (!this.artworkInteractive()) return;
        this.artworkClicked.emit();
    }
}
