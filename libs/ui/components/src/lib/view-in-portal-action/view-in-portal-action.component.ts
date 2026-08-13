import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { VIEW_IN_PORTAL_HANDOFF } from './view-in-portal-handoff.token';

/**
 * Separate-row hero action that jumps from an inline collection detail to the
 * same item inside its owning portal. Renders nothing (and removes itself from
 * the flex flow) unless a host provides `VIEW_IN_PORTAL_HANDOFF` and reports
 * the target as resolvable.
 */
@Component({
    selector: 'app-view-in-portal-action',
    imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslateModule],
    template: `
        @if (visible()) {
            <button
                mat-stroked-button
                type="button"
                data-testid="collection-view-in-portal"
                [matTooltip]="
                    playlistName()
                        ? ('PORTALS.VIEW_IN_PORTAL_TOOLTIP'
                          | translate: tooltipParams())
                        : ''
                "
                (click)="handoff?.openInPortal()"
            >
                <mat-icon aria-hidden="true">open_in_new</mat-icon>
                {{ 'PORTALS.VIEW_IN_PORTAL' | translate }}
            </button>
        }
    `,
    styles: `
        /* Own row inside the hero's flex-wrap action container. */
        :host {
            display: block;
            flex: 0 0 100%;
            margin-top: 4px;
        }

        /* Without this the empty host would still claim a full flex row. */
        :host(.view-in-portal-action--hidden) {
            display: none;
        }
    `,
    host: {
        '[class.view-in-portal-action--hidden]': '!visible()',
    },
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewInPortalActionComponent {
    protected readonly handoff = inject(VIEW_IN_PORTAL_HANDOFF, {
        optional: true,
    });

    protected readonly visible = computed(
        () => this.handoff?.viewInPortalAvailable() ?? false
    );

    protected readonly playlistName = computed(
        () => this.handoff?.viewInPortalPlaylistName() ?? null
    );

    protected readonly tooltipParams = computed(() => ({
        name: this.playlistName() ?? '',
    }));
}
