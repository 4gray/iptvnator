import { NgClass, NgIf, NgOptimizedImage } from '@angular/common';
import {
    Component,
    ElementRef,
    Input,
    OnChanges,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { Store } from '@ngrx/store';
import { setAdjacentChannelAsActive } from '../../../state/actions';

@Component({
    selector: 'app-audio-player',
    standalone: true,
    template: `
        <div id="audio-player">
            <div class="radio-logo">
                <img [src]="icon" alt="radio icon" />
            </div>
            <audio preload="metadata" autoplay #audio>
                <source [src]="url" />
            </audio>
            <div class="controls">
                <button mat-icon-button (click)="switchChannel('previous')">
                    <mat-icon>skip_previous</mat-icon>
                </button>

                <button
                    class="icon-button-large"
                    mat-icon-button
                    (click)="play()"
                    *ngIf="playState === 'paused'"
                >
                    <mat-icon>play_arrow</mat-icon>
                </button>
                <button
                    class="icon-button-large"
                    mat-icon-button
                    (click)="stop()"
                    *ngIf="playState === 'play'"
                >
                    <mat-icon>pause</mat-icon>
                </button>
                <button mat-icon-button (click)="switchChannel('next')">
                    <mat-icon>skip_next</mat-icon>
                </button>
            </div>
            <div class="volume-panel">
                <div class="playing" *ngIf="playState === 'play'">
                    <span class="playing-bar playing-bar1"></span>
                    <span class="playing-bar playing-bar2"></span>
                    <span class="playing-bar playing-bar3"></span>
                </div>
                <div class="playing" *ngIf="playState === 'paused'">
                    <span class="playing-bar-stopped playing-bar1"></span>
                    <span class="playing-bar-stopped playing-bar2"></span>
                    <span class="playing-bar-stopped playing-bar3"></span>
                </div>
                <mat-slider min="0" max="1" step="0.1" color="accent">
                    <input matSliderThumb [(ngModel)]="audio.volume" />
                </mat-slider>
                <button mat-icon-button (click)="mute()">
                    <mat-icon *ngIf="audio.volume > 0 && !audio.muted"
                        >volume_up</mat-icon
                    >
                    <mat-icon *ngIf="audio.volume === 0 || audio.muted"
                        >volume_off</mat-icon
                    >
                </button>
            </div>
        </div>
    `,
    styleUrls: ['./audio-player.component.scss'],
    imports: [
        MatSliderModule,
        MatIconModule,
        MatButtonModule,
        NgIf,
        NgClass,
        FormsModule,
        NgOptimizedImage,
    ],
})
export class AudioPlayerComponent implements OnChanges {
    @Input() icon: string;
    @Input({ required: true }) url: string;

    playState: 'play' | 'paused' = 'paused';

    fallbackVolume: number;

    @ViewChild('audio', { static: true }) audio!: ElementRef<HTMLAudioElement>;

    constructor(private store: Store) {}

    ngOnChanges(changes: SimpleChanges): void {
        this.audio.nativeElement.src = changes.url.currentValue;
        this.audio.nativeElement.load();
        this.play();
    }

    play() {
        const playPromise = this.audio.nativeElement.play();
        if (playPromise !== undefined) {
            playPromise.catch((error) => {
                console.log(error);
            });
        }
        this.playState = 'play';
    }

    stop() {
        this.audio.nativeElement.pause();
        this.playState = 'paused';
    }

    mute() {
        this.audio.nativeElement.muted = !this.audio.nativeElement.muted;
        if (this.audio.nativeElement.muted) {
            this.fallbackVolume = this.audio.nativeElement.volume;
            this.audio.nativeElement.volume = 0;
        } else this.audio.nativeElement.volume = this.fallbackVolume;
    }

    switchChannel(direction: 'next' | 'previous') {
        console.log(direction);
        this.store.dispatch(setAdjacentChannelAsActive({ direction }));
    }
}
