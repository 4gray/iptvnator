import {
    Component,
    DestroyRef,
    ElementRef,
    HostListener,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild,
} from '@angular/core';
import { extractDominantColor } from './extract-color';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelActions } from '@iptvnator/m3u-state';

@Component({
    selector: 'app-audio-player',
    template: `
        <div class="radio-hero">
            @if (displayIcon() && !logoError()) {
                <div
                    class="backdrop"
                    [style.backgroundImage]="'url(' + displayIcon() + ')'"
                ></div>
            }
            <div class="vignette"></div>

            <div class="stage">
                <div
                    class="artwork"
                    [class.is-playing]="playState() === 'play'"
                >
                    @if (displayIcon() && !logoError()) {
                        <img
                            [src]="displayIcon()"
                            alt=""
                            (error)="logoError.set(true)"
                        />
                    } @else {
                        <div class="artwork-fallback">
                            <mat-icon>radio</mat-icon>
                        </div>
                    }
                </div>

                <h2 class="station-name">
                    {{ channelName() || 'Radio' }}
                </h2>
                <span
                    class="station-badge"
                    [class.live]="playState() === 'play'"
                >
                    @if (playState() === 'play') {
                        <span class="pulse"></span> LIVE
                    } @else {
                        PAUSED
                    }
                </span>

                <div class="transport">
                    <button
                        mat-icon-button
                        class="skip-btn"
                        [matTooltip]="
                            'AUDIO_PLAYER.PREVIOUS_STATION' | translate
                        "
                        [attr.aria-label]="
                            'AUDIO_PLAYER.PREVIOUS_STATION' | translate
                        "
                        (click)="switchChannel('previous')"
                    >
                        <mat-icon>skip_previous</mat-icon>
                    </button>

                    <button
                        class="play-btn"
                        mat-fab
                        [matTooltip]="
                            (playState() === 'play'
                                ? 'AUDIO_PLAYER.PAUSE'
                                : 'AUDIO_PLAYER.PLAY'
                            ) | translate
                        "
                        [attr.aria-label]="
                            (playState() === 'play'
                                ? 'AUDIO_PLAYER.PAUSE'
                                : 'AUDIO_PLAYER.PLAY'
                            ) | translate
                        "
                        (click)="playState() === 'play' ? stop() : play()"
                    >
                        <mat-icon>{{
                            playState() === 'play' ? 'pause' : 'play_arrow'
                        }}</mat-icon>
                    </button>

                    <button
                        mat-icon-button
                        class="skip-btn"
                        [matTooltip]="'AUDIO_PLAYER.NEXT_STATION' | translate"
                        [attr.aria-label]="
                            'AUDIO_PLAYER.NEXT_STATION' | translate
                        "
                        (click)="switchChannel('next')"
                    >
                        <mat-icon>skip_next</mat-icon>
                    </button>
                </div>

                <div class="volume-row">
                    <button
                        mat-icon-button
                        class="vol-icon"
                        [matTooltip]="
                            (isMuted() || volume() === 0
                                ? 'AUDIO_PLAYER.UNMUTE'
                                : 'AUDIO_PLAYER.MUTE'
                            ) | translate
                        "
                        [attr.aria-label]="
                            (isMuted() || volume() === 0
                                ? 'AUDIO_PLAYER.UNMUTE'
                                : 'AUDIO_PLAYER.MUTE'
                            ) | translate
                        "
                        (click)="mute()"
                    >
                        <mat-icon>{{ volumeIcon() }}</mat-icon>
                    </button>
                    <mat-slider
                        class="vol-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        [matTooltip]="'AUDIO_PLAYER.VOLUME' | translate"
                    >
                        <input
                            matSliderThumb
                            [ngModel]="volume()"
                            [attr.aria-label]="
                                'AUDIO_PLAYER.VOLUME' | translate
                            "
                            (ngModelChange)="setVolume($event)"
                        />
                    </mat-slider>
                </div>
            </div>

            <audio preload="metadata" autoplay #audio></audio>
        </div>
    `,
    styleUrls: ['./audio-player.component.scss'],
    imports: [
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatSliderModule,
        MatTooltip,
        TranslatePipe,
    ],
})
export class AudioPlayerComponent {
    readonly icon = input<string>('');
    readonly url = input.required<string>();
    readonly channelName = input<string>('');
    readonly dispatchAdjacentChannelAction = input(true);
    readonly channelSwitchRequested = output<'next' | 'previous'>();

    readonly playState = signal<'play' | 'paused'>('paused');
    readonly volume = signal(1);
    readonly isMuted = signal(false);
    readonly logoError = signal(false);

    readonly displayIcon = computed(() => this.icon() || null);
    readonly volumeIcon = computed(() => {
        const v = this.volume();
        if (v === 0 || this.isMuted()) return 'volume_off';
        return v < 0.5 ? 'volume_down' : 'volume_up';
    });

    readonly audioRef =
        viewChild.required<ElementRef<HTMLAudioElement>>('audio');

    private store = inject(Store);
    private destroyRef = inject(DestroyRef);
    private hostEl = inject(ElementRef);
    private fallbackVolume = 1;

    constructor() {
        const saved = parseFloat(localStorage.getItem('volume') ?? '1');
        if (!isNaN(saved)) {
            this.volume.set(Math.max(0, Math.min(1, saved)));
        }

        effect(() => {
            const url = this.url();
            const audio = this.audioRef()?.nativeElement;
            if (!audio || !url) return;
            audio.src = url;
            audio.volume = this.volume();
            audio.load();
            this.logoError.set(false);
            this.play();
        });

        effect(() => {
            const iconUrl = this.displayIcon();
            this.hostEl.nativeElement.style.removeProperty('--radio-accent');
            if (!iconUrl) return;
            extractDominantColor(iconUrl).then((color) => {
                if (color) {
                    this.hostEl.nativeElement.style.setProperty(
                        '--radio-accent',
                        color
                    );
                }
            });
        });

        this.destroyRef.onDestroy(() => {
            this.audioRef()?.nativeElement?.pause();
        });
    }

    @HostListener('document:keydown', ['$event'])
    handleKeyboard(event: KeyboardEvent) {
        if (
            event.target instanceof HTMLInputElement ||
            event.target instanceof HTMLTextAreaElement
        )
            return;

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.setVolume(this.volume() + 0.05);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.setVolume(this.volume() - 0.05);
        } else if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            this.mute();
        }
    }

    play() {
        const audio = this.audioRef()?.nativeElement;
        if (!audio) return;
        audio.play().catch((err) => {
            console.warn('[AudioPlayer] Audio playback failed:', err);
        });
        this.playState.set('play');
    }

    stop() {
        this.audioRef()?.nativeElement?.pause();
        this.playState.set('paused');
    }

    setVolume(value: number) {
        const clamped = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
        this.volume.set(clamped);
        const audio = this.audioRef()?.nativeElement;
        if (audio) audio.volume = clamped;
        localStorage.setItem('volume', String(clamped));
    }

    mute() {
        const audio = this.audioRef()?.nativeElement;
        if (!audio) return;
        audio.muted = !audio.muted;
        this.isMuted.set(audio.muted);
        if (audio.muted) {
            this.fallbackVolume = this.volume();
            this.setVolume(0);
        } else {
            this.setVolume(this.fallbackVolume);
        }
    }

    switchChannel(direction: 'next' | 'previous') {
        if (this.dispatchAdjacentChannelAction()) {
            this.store.dispatch(
                ChannelActions.setAdjacentChannelAsActive({ direction })
            );
        } else {
            this.channelSwitchRequested.emit(direction);
        }
    }
}
