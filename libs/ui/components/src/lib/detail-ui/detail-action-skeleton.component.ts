import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Placeholder for the hero's primary action while the host cannot build it
 * yet (a Stalker series before its seasons load): keeps the action row's
 * width, so the favourite and "…" buttons do not jump right when the Play
 * button arrives.
 */
@Component({
    selector: 'app-detail-action-skeleton',
    template: '',
    styleUrl: './detail-action-skeleton.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        'aria-hidden': 'true',
        'data-test-id': 'detail-action-skeleton',
    },
})
export class DetailActionSkeletonComponent {}
