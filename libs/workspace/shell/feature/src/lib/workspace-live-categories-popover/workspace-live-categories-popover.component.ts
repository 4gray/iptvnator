import {
    ChangeDetectionStrategy,
    Component,
    inject,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { LiveLayoutSidebarStateService } from '@iptvnator/portal/shared/util';
import { WorkspaceContextPanelComponent } from '../workspace-context-panel/workspace-context-panel.component';
import { WorkspaceShellRouteStateService } from '../workspace-shell/services/workspace-shell-route-state.service';

/**
 * The live categories rail stamped into a popover while that rail is folded
 * (`LiveSidebarState` `categories-hidden`). It renders the very same
 * `WorkspaceContextPanelComponent` the shell sidebar uses, so search, sort,
 * counts, selection and the category click handlers stay one implementation;
 * only the presentation differs (no hide chevron, a footer that restores the
 * rail). Opened by `WorkspaceLiveCategoriesPopoverService`.
 */
@Component({
    selector: 'app-workspace-live-categories-popover',
    imports: [MatIcon, TranslatePipe, WorkspaceContextPanelComponent],
    templateUrl: './workspace-live-categories-popover.component.html',
    styleUrl: './workspace-live-categories-popover.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceLiveCategoriesPopoverComponent {
    private readonly routeState = inject(WorkspaceShellRouteStateService);
    private readonly liveSidebarState = inject(LiveLayoutSidebarStateService);

    readonly context = this.routeState.currentContext;
    readonly section = this.routeState.currentSection;
    /** Fired when the popover wants to be closed by its host. */
    readonly closed = output<void>();

    onCategorySelected(): void {
        this.closed.emit();
    }

    showCategoriesPanel(): void {
        this.liveSidebarState.showCategories();
        this.closed.emit();
    }
}
