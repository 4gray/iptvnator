import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { formatTime } from '@iptvnator/ui/playback';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * A VOD tile the session holds paused without audio (R4, prototype step
 * 4): a play button that gives the tile the audio, and the position it
 * will continue from.
 */
@Component({
    selector: 'app-multiview-paused-overlay',
    template: `
        <button
            type="button"
            class="paused__play"
            data-test-id="multiview-tile-resume"
            [attr.aria-label]="'PLAYER.MULTIVIEW.RESUME' | translate"
            (click)="resumeRequested.emit()"
        >
            <mat-icon>play_arrow</mat-icon>
        </button>
        <span class="paused__position">{{
            'PLAYER.MULTIVIEW.PAUSED_AT' | translate: { position: position() }
        }}</span>
    `,
    styleUrl: './multiview-paused-overlay.component.scss',
    imports: [MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiviewPausedOverlayComponent {
    readonly seconds = input(0);
    readonly resumeRequested = output<void>();
    readonly position = computed(() => formatTime(this.seconds()));
}
