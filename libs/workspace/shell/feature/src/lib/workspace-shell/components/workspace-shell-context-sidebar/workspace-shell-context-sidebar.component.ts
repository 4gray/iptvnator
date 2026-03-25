import {
    ChangeDetectionStrategy,
    Component,
    input,
} from '@angular/core';
import { ResizableDirective } from 'components';
import { PortalRailSection } from '@iptvnator/portal/shared/util';
import {
    WorkspacePortalContext,
    WorkspaceShellContextPanel,
} from '@iptvnator/workspace/shell/util';
import { WorkspaceCollectionContextPanelComponent } from '../../../workspace-context-panel/workspace-collection-context-panel.component';
import { WorkspaceContextPanelComponent } from '../../../workspace-context-panel/workspace-context-panel.component';
import { WorkspaceSettingsContextPanelComponent } from '../../../workspace-context-panel/workspace-settings-context-panel.component';
import { WorkspaceSourcesFiltersPanelComponent } from '../../../workspace-sources-filters-panel/workspace-sources-filters-panel.component';

@Component({
    selector: 'app-workspace-shell-context-sidebar',
    imports: [
        ResizableDirective,
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
    readonly variant = input.required<WorkspaceShellContextPanel>();
    readonly context = input<WorkspacePortalContext | null>(null);
    readonly section = input<PortalRailSection | null>(null);
}
