import { DOCUMENT } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    effect,
    inject,
    input,
    signal,
} from '@angular/core';
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
    readonly isMacOS = input(false);
    readonly workspaceLinks = input<PortalRailLink[]>([]);
    readonly primaryContextLinks = input<PortalRailLink[]>([]);
    readonly secondaryContextLinks = input<PortalRailLink[]>([]);
    readonly selectedSection = input<
        PortalRailSection | string | null | undefined
    >(null);
    readonly railProviderClass = input('rail-context-region');
    readonly isSettingsRoute = input(false);

    /**
     * The page zoom factor. App zoom (`webFrame.setZoomLevel`) scales CSS
     * pixels but not the native traffic lights, so the macOS top inset is
     * kept in window pixels when zoomed out. Chromium reports the window in
     * window pixels and the viewport in CSS pixels, and fires `resize` when
     * the zoom changes.
     */
    protected readonly zoomFactor = signal(1);

    constructor() {
        const view = inject(DOCUMENT).defaultView;
        effect((onCleanup) => {
            if (!this.isMacOS() || !view) return;
            const update = () =>
                this.zoomFactor.set(
                    view.innerWidth > 0 && view.outerWidth > 0
                        ? view.outerWidth / view.innerWidth
                        : 1
                );
            update();
            view.addEventListener('resize', update);
            onCleanup(() => view.removeEventListener('resize', update));
        });
    }
}
