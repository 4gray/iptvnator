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
    /** See `VodSourcesMenuComponent.autoFailoverSupported`. */
    readonly autoFailoverSupported = input(true);
    /** See `VodSourceRowComponent.playbackLive`. */
    readonly playbackLive = input(false);
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
     * Above the chip, right edges aligned — the action row sits low in the
     * hero, so up is where the space is. Flexible dimensions cap the panel to
     * the space on that side (`viewportMargin` keeps it off the edges), the
     * list inside is the only part that scrolls, and when less than
     * `MIN_PANEL_HEIGHT` remains above, the position is skipped and the panel
     * flips below the chip instead. The strategy re-applies itself on window
     * resize, so the fit holds at any proportion.
     *
     * Each position stamps its `panelClass` on the pane so the pointer tail
     * can mirror when the panel flips.
     */
    readonly overlayPositions: ConnectedPosition[] = [
        {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -12,
            panelClass: 'vod-sources-pop--above',
        },
        {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 12,
            panelClass: 'vod-sources-pop--below',
        },
        {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -12,
            panelClass: 'vod-sources-pop--above',
        },
        {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 12,
            panelClass: 'vod-sources-pop--below',
        },
    ];

    /**
     * Below this, a position is not worth squeezing into: header, search,
     * chips and footer alone need ~220px, and a list holding fewer than two
     * rows helps nobody. The overlay tries the other side instead.
     */
    readonly minPanelHeight = 280;

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
