import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import type { SeriesPlaybackNavigation } from './series-playback-navigation';

@Component({
    selector: 'app-series-playback-navigation-controls',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
    template: `
        @if (navigation()) {
            <nav
                class="series-playback-navigation-controls"
                data-test-id="series-playback-navigation-controls"
                [attr.aria-label]="'PORTALS.EPISODE_NAVIGATION' | translate"
            >
                <button
                    mat-icon-button
                    type="button"
                    class="series-playback-navigation-controls__button"
                    data-test-id="series-playback-previous-episode"
                    [disabled]="!canPrevious()"
                    (click)="requestPreviousEpisode()"
                    [attr.aria-label]="
                        'EMBEDDED_MPV.PLAYER.PREVIOUS_EPISODE' | translate
                    "
                    [matTooltip]="
                        'EMBEDDED_MPV.PLAYER.PREVIOUS_EPISODE' | translate
                    "
                    matTooltipPosition="above"
                >
                    <mat-icon>skip_previous</mat-icon>
                </button>

                <button
                    mat-icon-button
                    type="button"
                    class="series-playback-navigation-controls__button"
                    data-test-id="series-playback-next-episode"
                    [disabled]="!canNext()"
                    (click)="requestNextEpisode()"
                    [attr.aria-label]="
                        'EMBEDDED_MPV.PLAYER.NEXT_EPISODE' | translate
                    "
                    [matTooltip]="
                        'EMBEDDED_MPV.PLAYER.NEXT_EPISODE' | translate
                    "
                    matTooltipPosition="above"
                >
                    <mat-icon>skip_next</mat-icon>
                </button>
            </nav>
        }
    `,
    styleUrl: './series-playback-navigation-controls.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeriesPlaybackNavigationControlsComponent {
    readonly navigation = input<SeriesPlaybackNavigation | null>(null);
    readonly previousEpisodeRequested = output<void>();
    readonly nextEpisodeRequested = output<void>();

    readonly canPrevious = computed(
        () => this.navigation()?.canPrevious === true
    );
    readonly canNext = computed(() => this.navigation()?.canNext === true);

    requestPreviousEpisode(): void {
        if (!this.canPrevious()) {
            return;
        }

        this.previousEpisodeRequested.emit();
    }

    requestNextEpisode(): void {
        if (!this.canNext()) {
            return;
        }

        this.nextEpisodeRequested.emit();
    }
}
