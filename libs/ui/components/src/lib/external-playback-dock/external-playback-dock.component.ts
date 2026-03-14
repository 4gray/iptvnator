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
import { ExternalPlayerSession } from 'shared-interfaces';

@Component({
    selector: 'app-external-playback-dock',
    imports: [MatButtonModule, MatIcon, MatProgressSpinnerModule],
    templateUrl: './external-playback-dock.component.html',
    styleUrl: './external-playback-dock.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalPlaybackDockComponent {
    readonly session = input.required<ExternalPlayerSession>();
    readonly compact = input(false);

    readonly closeClicked = output<void>();
    private readonly artworkFailed = signal(false);

    readonly playerLabel = computed(() => this.session().player.toUpperCase());
    readonly artworkUrl = computed(() => this.session().thumbnail?.trim() ?? '');
    readonly statusLabel = computed(() => {
        const session = this.session();
        const player = this.playerLabel();

        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
                return `Opened in ${player}`;
            case 'playing':
                return `Playing in ${player}`;
            case 'error':
                return session.error || `${player} failed to launch`;
            default:
                return `${player} closed`;
        }
    });

    readonly showSpinner = computed(
        () => this.session().status === 'launching'
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
}
