import { ChangeDetectionStrategy } from '@angular/core';
import {
    Component,
    DestroyRef,
    effect,
    ElementRef,
    HostBinding,
    HostListener,
    inject,
    input,
    output,
    untracked,
    viewChild,
} from '@angular/core';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { PlaybackDiagnostic } from '@iptvnator/ui/playback';
import { MultiviewTileEngine } from './multiview-tile-engine';

export interface MultiviewTilePlayback {
    readonly url: string;
    readonly title: string;
    readonly logo?: string;
    readonly userAgent?: string;
    readonly referer?: string;
}

export type MultiviewTileStatus = 'resolving' | 'ready' | 'error';

/**
 * A single multiview tile: renders one muted-by-default live stream through
 * the minimal tile engine. Audio is controlled solely through the
 * `audioFocused` input — the shared `localStorage['volume']` of the full
 * players is intentionally not touched.
 */
@Component({
    selector: 'lib-multiview-tile',
    templateUrl: './multiview-tile.component.html',
    styleUrls: ['./multiview-tile.component.scss'],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        MatButton,
        MatIcon,
        MatIconButton,
        MatProgressSpinner,
        MatTooltip,
        TranslatePipe,
    ],
})
export class MultiviewTileComponent {
    readonly playback = input<MultiviewTilePlayback | null>(null);
    readonly status = input<MultiviewTileStatus>('resolving');
    readonly errorKey = input<string | null>(null);
    readonly audioFocused = input(false);

    readonly focusRequested = output<void>();
    readonly openInPlayerRequested = output<void>();
    readonly removeRequested = output<void>();
    readonly retryRequested = output<void>();
    readonly playbackFailed = output<PlaybackDiagnostic>();

    private readonly videoRef =
        viewChild<ElementRef<HTMLVideoElement>>('tileVideo');
    private readonly destroyRef = inject(DestroyRef);
    private engine: MultiviewTileEngine | null = null;

    @HostBinding('class.audio-focused') get isAudioFocused(): boolean {
        return this.audioFocused();
    }

    constructor() {
        effect(() => {
            const playback = this.playback();
            const video = this.videoRef()?.nativeElement;
            this.destroyEngine();
            if (!playback || !video) {
                return;
            }

            // No-op in the PWA; in Electron this configures request headers
            // for M3U channels with custom user-agent/referrer.
            void window.electron
                ?.setUserAgent(
                    playback.userAgent,
                    playback.referer,
                    playback.url
                )
                .catch(() => undefined);

            const engine = new MultiviewTileEngine({
                video,
                url: playback.url,
                onError: (diagnostic) => this.playbackFailed.emit(diagnostic),
            });
            this.engine = engine;
            engine.start();
            untracked(() => this.applyAudioFocus(video));
        });

        effect(() => {
            const focused = this.audioFocused();
            const video = this.videoRef()?.nativeElement;
            if (!video) {
                return;
            }
            video.muted = !focused;
            video.volume = 1;
        });

        this.destroyRef.onDestroy(() => this.destroyEngine());
    }

    @HostListener('click')
    onHostClick(): void {
        this.focusRequested.emit();
    }

    @HostListener('dblclick')
    onHostDoubleClick(): void {
        this.openInPlayerRequested.emit();
    }

    onRemove(event: MouseEvent): void {
        event.stopPropagation();
        this.removeRequested.emit();
    }

    onRetry(event: MouseEvent): void {
        event.stopPropagation();
        this.retryRequested.emit();
    }

    private applyAudioFocus(video: HTMLVideoElement): void {
        video.muted = !this.audioFocused();
        video.volume = 1;
    }

    private destroyEngine(): void {
        this.engine?.destroy();
        this.engine = null;
    }
}
