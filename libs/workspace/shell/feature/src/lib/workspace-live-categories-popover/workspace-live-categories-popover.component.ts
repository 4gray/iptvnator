import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
    ChangeDetectionStrategy,
    Component,
    inject,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
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
 *
 * The trigger advertises `aria-haspopup="dialog"`, so the host is that
 * dialog: it carries the role and label, and `CdkTrapFocus` (a host
 * directive) moves focus into the panel on open and keeps Tab inside it
 * while the backdrop hides the page underneath. The service returns focus
 * to the trigger on close.
 */
@Component({
    selector: 'app-workspace-live-categories-popover',
    imports: [MatIcon, TranslatePipe, WorkspaceContextPanelComponent],
    templateUrl: './workspace-live-categories-popover.component.html',
    styleUrl: './workspace-live-categories-popover.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    hostDirectives: [CdkTrapFocus],
    host: {
        role: 'dialog',
        'aria-modal': 'true',
        '[attr.aria-label]': 'dialogLabel',
    },
})
export class WorkspaceLiveCategoriesPopoverComponent {
    private readonly routeState = inject(WorkspaceShellRouteStateService);
    private readonly liveSidebarState = inject(LiveLayoutSidebarStateService);
    readonly dialogLabel = inject(TranslateService).instant(
        'LAYOUT.CHOOSE_CATEGORY'
    );

    constructor() {
        // Host directive inputs cannot be bound from a portal-created
        // component, so the trap is configured here; the directive's own
        // AfterContentInit runs after this constructor and captures focus.
        const focusTrap = inject(CdkTrapFocus, { self: true });
        focusTrap.enabled = true;
        focusTrap.autoCapture = true;
    }

    readonly context = this.routeState.currentContext;
    readonly section = this.routeState.currentSection;
    /** Fired when the popover wants to be closed by its host. */
    readonly closed = output<void>();

    onCategorySelected(): void {
        this.closed.emit();
    }

    showCategoriesPanel(): void {
        this.liveSidebarState.showCategories('portal');
        this.closed.emit();
    }
}
