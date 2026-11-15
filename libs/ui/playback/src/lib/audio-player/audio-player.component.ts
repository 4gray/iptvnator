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
    untracked,
    viewChild,
    ChangeDetectionStrategy,
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
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { PlaybackHistoryConfirmation } from '../playback-history/playback-history-confirmation';
import { LegacyMuteMemory } from '../player-controls/legacy-player-shortcuts';

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
                    {{ channelName() || ('AUDIO_PLAYER.RADIO' | translate) }}
                </h2>
                <span
                    class="station-badge"
                    [class.live]="playState() === 'play'"
                >
                    @if (playState() === 'play') {
                        <span class="pulse"></span>
                        {{ 'EMBEDDED_MPV.PLAYER.LIVE_BADGE' | translate }}
                    } @else {
                        {{ 'AUDIO_PLAYER.PAUSED_BADGE' | translate }}
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
                        mat-icon-button
                        class="play-btn"
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
                            (isMuted()
                                ? 'AUDIO_PLAYER.UNMUTE'
                                : 'AUDIO_PLAYER.MUTE'
                            ) | translate
                        "
                        [attr.aria-label]="
                            (isMuted()
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

            <audio
                preload="metadata"
                autoplay
                #audio
                (timeupdate)="onTimeUpdate()"
                (play)="playState.set('play')"
                (pause)="playState.set('paused')"
                (ended)="playState.set('paused')"
                (error)="playState.set('paused')"
            ></audio>
        </div>
    `,
    styleUrls: ['./audio-player.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
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
    readonly externalVolume = input<number | null>(null, { alias: 'volume' });
    readonly dispatchAdjacentChannelAction = input(true);
    /** The host's playback session key, for the history confirmation. */
    readonly playbackSessionKey = input<string | null>(null);
    readonly channelSwitchRequested = output<'next' | 'previous'>();
    readonly volumeChange = output<number>();

    readonly playState = signal<'play' | 'paused'>('paused');
    readonly volume = signal(1);
    /**
     * Muting sets the volume to zero, as in the shared player controls: the
     * slider then shows it, and raising the volume is also an unmute.
     */
    readonly isMuted = computed(() => this.volume() === 0);
    readonly logoError = signal(false);

    readonly displayIcon = computed(() => this.icon() || null);
    readonly volumeIcon = computed(() => {
        const v = this.volume();
        if (v === 0) return 'volume_off';
        return v < 0.5 ? 'volume_down' : 'volume_up';
    });

    readonly audioRef =
        viewChild.required<ElementRef<HTMLAudioElement>>('audio');

    private store = inject(Store);
    private destroyRef = inject(DestroyRef);
    private hostEl = inject(ElementRef);
    private readonly muteMemory = new LegacyMuteMemory();
    private playAttempt = 0;
    /** Commits the deferred "recently viewed" write once the station plays. */
    private readonly historyConfirmation = new PlaybackHistoryConfirmation({
        gate: inject(PlaybackHistoryGate),
        target: () => ({
            sessionKey: this.playbackSessionKey(),
            streamUrls: [this.url()],
        }),
    });

    constructor() {
        const saved = parseFloat(localStorage.getItem('volume') ?? '1');
        if (!isNaN(saved)) {
            this.volume.set(Math.max(0, Math.min(1, saved)));
        }
        this.muteMemory.rememberIfAudible(this.volume());

        effect(() => {
            const volume = this.externalVolume();
            if (volume === null) return;

            this.setVolume(volume, { emitChange: false });
        });

        effect(() => {
            const url = this.url();
            const audio = this.audioRef()?.nativeElement;
            if (!audio || !url) return;
            audio.src = url;
            this.applyVolume(
                audio,
                untracked(() => this.volume())
            );
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
            event.target instanceof HTMLTextAreaElement ||
            (event.target instanceof Element &&
                event.target.closest('[role="dialog"], [role="alertdialog"]'))
        )
            return;

        // Inside an inert region (e.g. behind the workspace's phone context
        // drawer) the player is out of the interaction model: inert strips
        // pointer and Tab access, but this document-level listener still
        // fires, so it must opt out itself.
        if (this.hostEl.nativeElement.closest('[inert]')) return;
        // Cmd/Ctrl/Alt chords belong to the app and the system (Cmd+M
        // minimizes on macOS), not to the radio's M and arrow keys.
        if (event.ctrlKey || event.metaKey || event.altKey) return;

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

    onTimeUpdate(): void {
        const audio = this.audioRef()?.nativeElement;
        if (audio) {
            this.historyConfirmation.record(
                audio.currentTime,
                !audio.paused && !audio.seeking
            );
        }
    }

    play() {
        const audio = this.audioRef()?.nativeElement;
        if (!audio) return;
        const attempt = ++this.playAttempt;
        // A media error remains latched until the browser reloads the source.
        if (audio.error) audio.load();
        audio.play().catch((err) => {
            if (attempt !== this.playAttempt) return;
            this.playState.set('paused');
            console.warn('[AudioPlayer] Audio playback failed:', err);
        });
        this.playState.set('play');
    }

    stop() {
        ++this.playAttempt;
        this.audioRef()?.nativeElement?.pause();
        this.playState.set('paused');
    }

    setVolume(value: number, options: { emitChange?: boolean } = {}) {
        const clamped = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
        this.volume.set(clamped);
        this.muteMemory.rememberIfAudible(clamped);
        const audio = this.audioRef()?.nativeElement;
        if (audio) this.applyVolume(audio, clamped);
        localStorage.setItem('volume', String(clamped));
        if (options.emitChange !== false) {
            this.volumeChange.emit(clamped);
        }
    }

    private applyVolume(audio: HTMLAudioElement, volume: number): void {
        audio.volume = volume;
        // iPhone Safari can ignore programmatic changes to the volume.
        audio.muted = volume === 0;
    }

    /**
     * Toggles between silence and the last audible volume (0.5 when none
     * is known, e.g. a stored volume of zero), so unmute always sounds.
     */
    mute() {
        // The shared volume key can contain a value below radio's precision.
        this.setVolume(
            this.isMuted() ? Math.max(0.01, this.muteMemory.unmuteVolume(0)) : 0
        );
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
