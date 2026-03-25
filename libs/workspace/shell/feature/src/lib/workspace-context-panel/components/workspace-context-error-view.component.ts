import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-workspace-context-error-view',
    imports: [MatIcon],
    templateUrl: './workspace-context-error-view.component.html',
    styleUrl: './workspace-context-error-view.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceContextErrorViewComponent {
    readonly description = input<string | undefined>(undefined);
    readonly showIllustration = input(true);
    readonly showActionButtons = input(false);
    readonly title = input<string | undefined>(undefined);
    readonly viewType = input<'ERROR' | 'EMPTY_CATEGORY' | 'NO_SEARCH_RESULTS'>(
        'ERROR'
    );
}
