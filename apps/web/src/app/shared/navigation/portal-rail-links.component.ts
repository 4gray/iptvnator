import { Component, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import {
    IsActiveMatchOptions,
    Router,
    RouterLink,
    RouterLinkActive,
} from '@angular/router';
import { PortalRailLink } from './portal-rail-links';

@Component({
    selector: 'app-portal-rail-links',
    imports: [MatIcon, MatListModule, MatTooltip, RouterLink, RouterLinkActive],
    templateUrl: './portal-rail-links.component.html',
    styleUrl: './portal-rail-links.component.scss',
})
export class PortalRailLinksComponent {
    private readonly router = inject(Router);

    readonly links = input<PortalRailLink[]>([]);
    readonly selectedSection = input<string | null | undefined>(null);
    readonly activeClass = input<'active' | 'is-active'>('active');
    readonly variant = input<'list' | 'rail'>('list');

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
