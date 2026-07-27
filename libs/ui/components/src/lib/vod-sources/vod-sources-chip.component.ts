import {
    ChangeDetectionStrategy,
    Component,
    computed,
    input,
    output,
    signal,
} from '@angular/core';
import {
    CdkOverlayOrigin,
    CdkConnectedOverlay,
    type ConnectedPosition,
} from '@angular/cdk/overlay';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    VodSourceDescriptor,
    VodSourceMatchKind,
} from '@iptvnator/shared/interfaces';
import { VodSourcesMenuComponent } from './vod-sources-menu.component';

/**
 * The "Sources N" chip on the VOD details action row, together with its
 * anchored popover. Hosts render it only when at least one alternative source
 * was found.
 */
@Component({
    selector: 'app-vod-sources-chip',
    templateUrl: './vod-sources-chip.component.html',
    styleUrls: ['./vod-sources-chip.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CdkConnectedOverlay,
        CdkOverlayOrigin,
        MatIcon,
        TranslatePipe,
        VodSourcesMenuComponent,
    ],
})
export class VodSourcesChipComponent {
    readonly sources = input.required<VodSourceDescriptor[]>();
    readonly title = input('');
    readonly matchKind = input<VodSourceMatchKind>('title-year');
    readonly autoFailoverEnabled = input(false);
    readonly resumeLabel = input<string | null>(null);
    readonly showPin = input(true);
    /** Falls back to the number of sources when the host does not override it. */
    readonly count = input<number | null>(null);

    readonly playRequested = output<string>();
    readonly pinRequested = output<string>();
    readonly checkRequested = output<string>();
    readonly autoFailoverToggled = output<boolean>();

    readonly isOpen = signal(false);
    readonly displayCount = computed(
        () => this.count() ?? this.sources().length
    );

    /**
     * Below the chip by default, flipping above when the action row sits near
     * the bottom of the window. `viewportMargin` keeps it off the edges.
     */
    readonly overlayPositions: ConnectedPosition[] = [
        {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 8,
        },
        {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -8,
        },
        {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 8,
        },
        {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -8,
        },
    ];

    toggle(): void {
        this.isOpen.update((open) => !open);
    }

    close(): void {
        this.isOpen.set(false);
    }

    onOverlayKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this.close();
        }
    }

    /** Playing from a row hands the screen back to the player. */
    onPlay(sourceId: string): void {
        this.close();
        this.playRequested.emit(sourceId);
    }

    /** Pinning is a decision, not a browse step — the popover steps aside. */
    onPin(sourceId: string): void {
        this.close();
        this.pinRequested.emit(sourceId);
    }

    /** Checking stays open: the spinner and its outcome belong on the row. */
    onCheck(sourceId: string): void {
        this.checkRequested.emit(sourceId);
    }
}
