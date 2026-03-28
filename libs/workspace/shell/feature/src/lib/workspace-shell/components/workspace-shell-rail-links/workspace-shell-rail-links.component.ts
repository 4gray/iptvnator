import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import {
    IsActiveMatchOptions,
    Router,
    RouterLink,
    RouterLinkActive,
} from '@angular/router';
import {
    PortalRailLink,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';

@Component({
    selector: 'app-workspace-shell-rail-links',
    imports: [MatIcon, MatTooltip, RouterLink, RouterLinkActive],
    templateUrl: './workspace-shell-rail-links.component.html',
    styleUrl: './workspace-shell-rail-links.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellRailLinksComponent {
    private readonly router = inject(Router);

    readonly links = input<PortalRailLink[]>([]);
    readonly selectedSection = input<
        PortalRailSection | string | null | undefined
    >(null);
    readonly activeClass = input<'active' | 'is-active'>('is-active');

    resolveIcon(link: PortalRailLink): string {
        const normalizedPath = link.path.map((segment) => String(segment)).join('/');
        if (normalizedPath.includes('/workspace/sources')) {
            return 'playlist_play';
        }

        return link.icon;
    }

    isActive(link: PortalRailLink): boolean {
        const selectedSection = this.selectedSection();
        if (selectedSection && link.section) {
            return selectedSection === link.section;
        }

        const commands = link.path.map((segment) => String(segment));
        const tree = this.router.createUrlTree(commands);
        const matchOptions: IsActiveMatchOptions = {
            paths: link.exact ? 'exact' : 'subset',
            queryParams: 'ignored',
            fragment: 'ignored',
            matrixParams: 'ignored',
        };
        return this.router.isActive(tree, matchOptions);
    }
}
