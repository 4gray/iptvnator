import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
    input,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { ResizableDirective } from '@iptvnator/ui/components';
import {
    LiveLayoutSidebarStateService,
    PortalRailSection,
} from '@iptvnator/portal/shared/util';
import {
    WorkspaceShellContextDrawerService,
    WorkspacePortalContext,
    WorkspaceShellContextPanel,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceCollectionContextPanelComponent } from '../../../workspace-context-panel/workspace-collection-context-panel.component';
import { WorkspaceContextPanelComponent } from '../../../workspace-context-panel/workspace-context-panel.component';
import { WorkspaceSettingsContextPanelComponent } from '../../../workspace-context-panel/workspace-settings-context-panel.component';
import { WorkspaceSourcesFiltersPanelComponent } from '../../../workspace-sources-filters-panel/workspace-sources-filters-panel.component';

const LIVE_SECTIONS: ReadonlySet<PortalRailSection> = new Set([
    'live',
    'itv',
    'radio',
]);

@Component({
    selector: 'app-workspace-shell-context-sidebar',
    imports: [
        MatIcon,
        ResizableDirective,
        TranslatePipe,
        WorkspaceCollectionContextPanelComponent,
        WorkspaceContextPanelComponent,
        WorkspaceSettingsContextPanelComponent,
        WorkspaceSourcesFiltersPanelComponent,
    ],
    templateUrl: './workspace-shell-context-sidebar.component.html',
    styleUrl: './workspace-shell-context-sidebar.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceShellContextSidebarComponent {
    private readonly liveSidebarStateService = inject(
        LiveLayoutSidebarStateService
    );
    // Root-provided; optional keeps standalone unit tests light. Only relevant
    // when the sidebar renders as the phone drawer — the close button that
    // calls this is CSS-hidden above the phone breakpoint.
    private readonly contextDrawer = inject(WorkspaceShellContextDrawerService, {
        optional: true,
    });

    readonly variant = input.required<WorkspaceShellContextPanel>();
    readonly context = input<WorkspacePortalContext | null>(null);
    readonly section = input<PortalRailSection | null>(null);
    readonly hasPlaylists = input(true);

    readonly isLiveCategoryRoute = computed(() => {
        const section = this.section();
        return (
            this.variant() === 'category' &&
            section !== null &&
            LIVE_SECTIONS.has(section)
        );
    });
    readonly isContextPanelCollapsed = computed(
        () =>
            this.isLiveCategoryRoute() &&
            this.liveSidebarStateService.isCollapsedFor('portal')()
    );

    closeDrawer(): void {
        this.contextDrawer?.close();
    }
}
