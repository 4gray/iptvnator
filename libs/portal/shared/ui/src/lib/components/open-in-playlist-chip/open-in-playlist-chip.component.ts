import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Pill naming the playlist a collection's live channel belongs to; clicking
 * it hands the channel off to that playlist. Projected into the EPG panel
 * toolbar (`[epgToolbarAction]`) beside the channel name so the "where is
 * this from" answer sits on the now-playing surface, in the collapsed state
 * too. The host decides whether the target resolves and renders the chip
 * only then — an unresolvable jump is hidden, never disabled.
 */
@Component({
    selector: 'app-open-in-playlist-chip',
    imports: [MatIconModule, MatTooltipModule, TranslateModule],
    template: `
        @let tooltip =
            'PORTALS.VIEW_IN_PORTAL_TOOLTIP' | translate: tooltipParams();
        <button
            type="button"
            class="open-in-playlist-chip"
            data-testid="live-open-in-playlist"
            [matTooltip]="tooltip"
            [attr.aria-label]="tooltip"
            (click)="activated.emit()"
        >
            <mat-icon aria-hidden="true">open_in_new</mat-icon>
            <span class="open-in-playlist-chip__name">{{
                playlistName()
            }}</span>
        </button>
    `,
    styleUrl: './open-in-playlist-chip.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenInPlaylistChipComponent {
    /** Display label of the owning playlist (already credential-safe). */
    readonly playlistName = input.required<string>();
    readonly activated = output<void>();

    protected readonly tooltipParams = computed(() => ({
        name: this.playlistName(),
    }));
}
