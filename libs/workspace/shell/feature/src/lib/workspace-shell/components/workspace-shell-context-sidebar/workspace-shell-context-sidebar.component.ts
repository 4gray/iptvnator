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
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
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
    private readonly xtreamStore = inject(XtreamStore);
    private readonly stalkerStore = inject(StalkerStore);
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
    /**
     * A live category is selected, so the layout renders a channels rail
     * whose header carries the way back to the folded categories rail (the
     * category dropdown + show chevron). On the live root there is no such
     * rail, and folding the categories there would leave no way back.
     */
    readonly hasLiveCategorySelection = computed(() => {
        const provider = this.context()?.provider;
        if (provider === 'xtreams') {
            return this.xtreamStore.selectedCategoryId() !== null;
        }
        if (provider === 'stalker') {
            return !!this.stalkerStore.selectedCategoryId();
        }
        return false;
    });
    // The categories rail is the outermost panel, so it folds on the first
    // collapse level already (`categories-hidden`, gated on a channels rail
    // existing to host the way back), and always on `collapsed`.
    readonly isContextPanelCollapsed = computed(
        () =>
            this.isLiveCategoryRoute() &&
            (this.liveSidebarStateService.isCollapsed() ||
                (this.liveSidebarStateService.areCategoriesHidden() &&
                    this.hasLiveCategorySelection()))
    );
    /**
     * A folded rail is only 0px wide; its search, sort and category buttons
     * would still take Tab stops and screen-reader focus. `inert` removes
     * them from both. Not while the panel renders as the open phone drawer,
     * whose stylesheet ignores the folded state.
     */
    readonly isContextPanelInert = computed(
        () =>
            this.isContextPanelCollapsed() && !this.contextDrawer?.isOpen()
    );

    closeDrawer(): void {
        this.contextDrawer?.close();
    }
}
