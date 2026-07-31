import { BreakpointObserver } from '@angular/cdk/layout';
import {
    ChangeDetectionStrategy,
    Component,
    computed,
    effect,
    ElementRef,
    inject,
    input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import {
    LiveLayoutPanelStateService,
    LIVE_LAYOUT_PANEL,
} from '@iptvnator/portal/shared/data-access';
import { ResizableDirective } from '@iptvnator/ui/components';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
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
        ResizableDirective,
        MatIcon,
        MatIconButton,
        MatTooltip,
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
    private readonly livePanelState = inject(LiveLayoutPanelStateService);
    private readonly hostEl = inject(ElementRef<HTMLElement>);
    private readonly compactViewport = toSignal(
        inject(BreakpointObserver).observe('(max-width: 1023px)'),
        { initialValue: { breakpoints: {}, matches: false } }
    );
    private previousGroupsPanelExpanded: boolean | undefined;

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
    readonly groupsResponsiveSuppressed = computed(
        () => this.compactViewport().matches
    );
    readonly groupsPanelExpanded = computed(() => {
        const applicable = this.isLiveCategoryRoute();
        return (
            !applicable ||
            this.livePanelState.isPanelExpanded(LIVE_LAYOUT_PANEL.GROUPS, {
                applicable,
                responsiveSuppressed: this.groupsResponsiveSuppressed(),
            })
        );
    });
    readonly canRestoreGroupsPanel = computed(
        () =>
            this.isLiveCategoryRoute() &&
            !this.groupsResponsiveSuppressed() &&
            !this.groupsPanelExpanded()
    );

    constructor() {
        effect(() => {
            const expanded = this.groupsPanelExpanded();
            const previous = this.previousGroupsPanelExpanded;
            this.previousGroupsPanelExpanded = expanded;
            if (previous === undefined || previous === expanded) {
                return;
            }

            queueMicrotask(() => {
                const action = expanded ? 'hide' : 'restore';
                this.hostEl.nativeElement
                    .querySelector<HTMLElement>(
                        `[data-testid="live-groups-panel-${action}"]`
                    )
                    ?.focus();
            });
        });
    }

    onGroupsPanelExpandedChange(expanded: boolean): void {
        if (expanded) {
            this.livePanelState.showPanel(LIVE_LAYOUT_PANEL.GROUPS);
        } else {
            this.livePanelState.hidePanel(LIVE_LAYOUT_PANEL.GROUPS);
        }
    }
}
