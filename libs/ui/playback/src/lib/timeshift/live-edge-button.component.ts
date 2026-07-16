import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-live-edge-button',
    imports: [TranslatePipe],
    template: `
        <button
            type="button"
            data-test-id="local-timeshift-go-live"
            [attr.aria-label]="'EPG.TIMELINE.RETURN_TO_LIVE' | translate"
            [title]="'EPG.TIMELINE.RETURN_TO_LIVE' | translate"
            (click)="goLive.emit()"
        >
            <span class="live-edge-button__dot" aria-hidden="true"></span>
            <span>LIVE</span>
        </button>
    `,
    styleUrl: './live-edge-button.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveEdgeButtonComponent {
    readonly goLive = output<void>();
}
