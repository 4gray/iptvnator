import {
    ChangeDetectionStrategy,
    Component,
    input,
    output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
    selector: 'app-live-edge-button',
    imports: [TranslatePipe],
    template: `
        <button
            type="button"
            data-test-id="local-timeshift-go-live"
            [class.live-edge-button--behind]="!atLiveEdge()"
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
    /** True while playback is at the live edge; drives the red pulsing dot. */
    readonly atLiveEdge = input(true);
    readonly goLive = output<void>();
}
