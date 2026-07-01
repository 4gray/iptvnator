import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    formatTime,
    volumeIcon as sharedVolumeIcon,
} from '../embedded-mpv-player/embedded-mpv-format.utils';

/**
 * Presentational on-canvas controls bar for the ferrite player — the control set (play/pause, mute,
 * volume slider, fullscreen) on iptvnator's Material pattern (`mat-icon-button` + `mat-icon` +
 * `mat-slider`, mirroring `audio-player`). It owns NO
 * playback state: every action is an `output()` the container wires to the ferrite facade, and
 * visibility is driven by the container's auto-hide signal. The deinterlace select (Off/Auto/Bwdif)
 * is shown only on the software tier (`deintSupported` — the WC/HW tier deinterlaces in hardware) and
 * emits `deintChange` to the container, which drives the facade's `setDeint()`; a DEINT_FAILED-fed
 * `deintFailed` input lights the "deint n/a" warning. Mirrors the ferrite.js controls module's deint
 * control.
 */
@Component({
    selector: 'app-ferrite-controls',
    template: `
        <div class="ferrite-controls" [class.visible]="visible()">
            <button
                mat-icon-button
                class="ctl-btn"
                [matTooltip]="
                    (paused()
                        ? 'FERRITE_PLAYER.PLAY'
                        : 'FERRITE_PLAYER.PAUSE'
                    ) | translate
                "
                [attr.aria-label]="
                    (paused()
                        ? 'FERRITE_PLAYER.PLAY'
                        : 'FERRITE_PLAYER.PAUSE'
                    ) | translate
                "
                (click)="playToggle.emit()"
            >
                <mat-icon>{{ paused() ? 'play_arrow' : 'pause' }}</mat-icon>
            </button>

            <button
                mat-icon-button
                class="ctl-btn"
                [matTooltip]="
                    (muted()
                        ? 'FERRITE_PLAYER.UNMUTE'
                        : 'FERRITE_PLAYER.MUTE'
                    ) | translate
                "
                [attr.aria-label]="
                    (muted()
                        ? 'FERRITE_PLAYER.UNMUTE'
                        : 'FERRITE_PLAYER.MUTE'
                    ) | translate
                "
                (click)="muteToggle.emit()"
            >
                <mat-icon>{{ volumeIcon() }}</mat-icon>
            </button>

            <mat-slider class="ctl-vol" min="0" max="1" step="0.01">
                <input
                    matSliderThumb
                    [ngModel]="volume()"
                    [attr.aria-label]="'FERRITE_PLAYER.VOLUME' | translate"
                    (ngModelChange)="volumeInput.emit($event)"
                />
            </mat-slider>

            @if (deintSupported()) {
                <select
                    class="ctl-deint"
                    [ngModel]="deintMode()"
                    (ngModelChange)="deintChange.emit($event)"
                    [matTooltip]="'FERRITE_PLAYER.DEINTERLACE' | translate"
                    [attr.aria-label]="
                        'FERRITE_PLAYER.DEINTERLACE_MODE' | translate
                    "
                >
                    <option [ngValue]="0">
                        {{ 'FERRITE_PLAYER.DEINT_OFF' | translate }}
                    </option>
                    <option [ngValue]="1">
                        {{ 'FERRITE_PLAYER.DEINT_AUTO' | translate }}
                    </option>
                    <option [ngValue]="3">
                        {{ 'FERRITE_PLAYER.DEINT_BWDIF' | translate }}
                    </option>
                </select>
                @if (deintFailed()) {
                    <span
                        class="ctl-deint-warn"
                        [matTooltip]="
                            'FERRITE_PLAYER.DEINT_UNAVAILABLE_TOOLTIP'
                                | translate
                        "
                        >{{ 'FERRITE_PLAYER.DEINT_UNAVAILABLE' | translate }}</span
                    >
                }
            }

            <select
                class="ctl-dyna"
                [ngModel]="dynaMode()"
                (ngModelChange)="dynaChange.emit($event)"
                [matTooltip]="'FERRITE_PLAYER.DYNA' | translate"
                [attr.aria-label]="'FERRITE_PLAYER.DYNA_MODE' | translate"
            >
                <option [ngValue]="0">
                    {{ 'FERRITE_PLAYER.DYNA_LINE' | translate }}
                </option>
                <option [ngValue]="1">
                    {{ 'FERRITE_PLAYER.DYNA_RF' | translate }}
                </option>
                <option [ngValue]="2">
                    {{ 'FERRITE_PLAYER.DYNA_NIGHT' | translate }}
                </option>
            </select>

            @if (live()) {
                <span class="ctl-live">
                    <span class="ctl-live-dot"></span>
                    {{ 'FERRITE_PLAYER.LIVE' | translate }}
                </span>
                <span class="ctl-spacer"></span>
            } @else if (duration() > 0) {
                <span class="ctl-time">{{ formatTime(seekDisplay()) }}</span>
                <mat-slider class="ctl-seek" min="0" [max]="duration()" step="1">
                    <input
                        matSliderThumb
                        [ngModel]="seekDisplay()"
                        [attr.aria-label]="'FERRITE_PLAYER.SEEK' | translate"
                        (dragStart)="scrubbing.set(true)"
                        (ngModelChange)="onScrub($event)"
                        (dragEnd)="commitScrub()"
                    />
                </mat-slider>
                <span class="ctl-time">{{ formatTime(duration()) }}</span>
            } @else {
                <span class="ctl-spacer"></span>
            }

            <button
                mat-icon-button
                class="ctl-btn"
                [matTooltip]="
                    (fullscreen()
                        ? 'FERRITE_PLAYER.EXIT_FULLSCREEN'
                        : 'FERRITE_PLAYER.FULLSCREEN'
                    ) | translate
                "
                [attr.aria-label]="
                    (fullscreen()
                        ? 'FERRITE_PLAYER.EXIT_FULLSCREEN'
                        : 'FERRITE_PLAYER.FULLSCREEN'
                    ) | translate
                "
                (click)="fullscreenToggle.emit()"
            >
                <mat-icon>{{
                    fullscreen() ? 'fullscreen_exit' : 'fullscreen'
                }}</mat-icon>
            </button>
        </div>
    `,
    styleUrls: ['./ferrite-controls.component.scss'],
    imports: [
        FormsModule,
        MatButtonModule,
        MatIconModule,
        MatSliderModule,
        MatTooltip,
        TranslatePipe,
    ],
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FerriteControlsComponent {
    readonly paused = input(false);
    readonly muted = input(false);
    readonly volume = input(1);
    readonly fullscreen = input(false);
    readonly live = input(true);
    readonly visible = input(true);
    readonly currentTime = input(0);
    readonly duration = input(0);
    readonly deintSupported = input(false);
    readonly deintMode = input(1);
    readonly deintFailed = input(false);
    readonly dynaMode = input(0);

    readonly playToggle = output<void>();
    readonly muteToggle = output<void>();
    readonly volumeInput = output<number>();
    readonly fullscreenToggle = output<void>();
    readonly deintChange = output<number>();
    readonly dynaChange = output<number>();
    readonly seekTo = output<number>();

    // Shared M:SS / H:MM:SS formatter (single source of truth across the playback lib).
    protected readonly formatTime = formatTime;
    protected readonly volumeIcon = computed(() =>
        sharedVolumeIcon(this.muted() ? 0 : this.volume())
    );

    // Scrub state: while dragging, the thumb + time readout follow the local drag value, NOT the live
    // currentTime() (which keeps arriving at ~4 Hz from TIME_UPDATE and would otherwise fight the drag).
    // The seek is committed once, on release; a plain track-click (no drag) seeks immediately.
    protected readonly scrubbing = signal(false);
    private readonly scrubValue = signal(0);
    protected readonly seekDisplay = computed(() =>
        this.scrubbing() ? this.scrubValue() : this.currentTime()
    );

    protected onScrub(value: number): void {
        this.scrubValue.set(value);
        if (!this.scrubbing()) {
            this.seekTo.emit(value); // track-click without a drag → seek now
        }
    }

    protected commitScrub(): void {
        this.seekTo.emit(this.scrubValue());
        this.scrubbing.set(false);
    }
}
