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
import { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { CastControlComponent } from '../casting/cast-control.component';

@Component({
    selector: 'app-audio-player',
    templateUrl: './audio-player.component.html',
    styleUrls: ['./audio-player.component.scss'],
    imports: [
        FormsModule,
        CastControlComponent,
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
    readonly playback = input<ResolvedPortalPlayback | null>(null);
    readonly externalVolume = input<number | null>(null, { alias: 'volume' });
    readonly dispatchAdjacentChannelAction = input(true);
    readonly channelSwitchRequested = output<'next' | 'previous'>();
    readonly volumeChange = output<number>();

    readonly playState = signal<'play' | 'paused'>('paused');
    readonly volume = signal(1);
    readonly isMuted = signal(false);
    readonly logoError = signal(false);

    readonly displayIcon = computed(() => this.icon() || null);
    readonly castPlayback = computed<ResolvedPortalPlayback>(() => {
        const playback = this.playback();
        return {
            ...playback,
            streamUrl: this.url(),
            title: this.channelName() || playback?.title || 'Radio',
            thumbnail: this.displayIcon() ?? playback?.thumbnail,
            isLive: true,
        };
    });
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
            const volume = this.externalVolume();
            if (volume === null) return;

            this.setVolume(volume, { emitChange: false });
        });

        effect(() => {
            const url = this.url();
            const audio = this.audioRef()?.nativeElement;
            if (!audio || !url) return;
            audio.src = url;
            audio.volume = untracked(() => this.volume());
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

    setVolume(
        value: number,
        options: { emitChange?: boolean } = {}
    ) {
        const clamped = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
        this.volume.set(clamped);
        const audio = this.audioRef()?.nativeElement;
        if (audio) audio.volume = clamped;
        localStorage.setItem('volume', String(clamped));
        if (options.emitChange !== false) {
            this.volumeChange.emit(clamped);
        }
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
