import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-portal-empty-state',
    templateUrl: './portal-empty-state.component.html',
    styleUrl: './portal-empty-state.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [MatIcon],
})
export class PortalEmptyStateComponent {
    readonly icon = input<string>('live_tv');
    readonly message = input.required<string>();
}
