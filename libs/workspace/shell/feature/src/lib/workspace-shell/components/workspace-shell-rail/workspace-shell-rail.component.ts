import {
    ChangeDetectionStrategy,
    Component,
    DestroyRef,
    inject,
    input,
    model,
    signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    PortalRailLink,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import { WorkspaceShellRailLinksComponent } from '../workspace-shell-rail-links/workspace-shell-rail-links.component';

@Component({
    selector: 'app-workspace-shell-rail',
    host: {
        '[class.rail-expanded]': 'expanded()',
    },
    imports: [
        MatIcon,
        MatTooltip,
        RouterLink,
        TranslatePipe,
        WorkspaceShellRailLinksComponent,
    ],
    templateUrl: './workspace-shell-rail.component.html',
    styleUrl: './workspace-shell-rail.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellRailComponent {
    private readonly document = inject(DOCUMENT);
    private readonly destroyRef = inject(DestroyRef);
    private readonly compactMediaQuery =
        this.document.defaultView?.matchMedia?.('(max-width: 640px)') ?? null;

    readonly isMacOS = input(false);
    readonly expanded = model(false);
    readonly isCompact = signal(this.compactMediaQuery?.matches ?? false);
    readonly workspaceLinks = input<PortalRailLink[]>([]);
    readonly primaryContextLinks = input<PortalRailLink[]>([]);
    readonly secondaryContextLinks = input<PortalRailLink[]>([]);
    readonly selectedSection = input<
        PortalRailSection | string | null | undefined
    >(null);
    readonly railProviderClass = input('rail-context-region');
    readonly isSettingsRoute = input(false);

    constructor() {
        const mediaQuery = this.compactMediaQuery;
        if (!mediaQuery) {
            return;
        }

        const updateCompactState = (matches: boolean): void => {
            this.isCompact.set(matches);
            if (matches) {
                this.expanded.set(false);
            }
        };
        const onMediaChange = (event: MediaQueryListEvent): void =>
            updateCompactState(event.matches);

        mediaQuery.addEventListener?.('change', onMediaChange);
        this.destroyRef.onDestroy(() =>
            mediaQuery.removeEventListener?.('change', onMediaChange)
        );
    }

    toggleExpanded(): void {
        if (this.isCompact()) {
            return;
        }

        this.expanded.update((expanded) => !expanded);
    }
}
