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
    styles: `
        :host {
            display: inline-flex;
            flex: 0 1 auto;
            min-width: 0;
            max-width: 220px;
        }

        /* Same pill geometry as the EPG toolbar's own icon buttons. */
        .open-in-playlist-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 34px;
            min-width: 0;
            max-width: 100%;
            padding: 0 12px 0 10px;
            border-radius: 999px;
            background: var(--app-widget-header-bg);
            border: 1px solid var(--app-separator);
            color: color-mix(in srgb, var(--app-on-surface) 82%, transparent);
            font: inherit;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;

            mat-icon {
                flex: 0 0 auto;
                font-size: 16px;
                width: 16px;
                height: 16px;
            }

            &:hover {
                background: var(--app-card-hover-bg);
                color: var(--app-on-surface);
            }

            &:focus-visible {
                outline: 2px solid var(--app-selection-color);
                outline-offset: 2px;
            }
        }

        .open-in-playlist-chip__name {
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }
    `,
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
