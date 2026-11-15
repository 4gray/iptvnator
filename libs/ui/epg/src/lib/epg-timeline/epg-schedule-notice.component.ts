import {
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    ConnectedPosition,
} from '@angular/cdk/overlay';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    signal,
    viewChild,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

let nextId = 0;

/**
 * The timeline's "schedule only" notice (the provider has programme history
 * but no catch-up) as a toolbar info button: the text is its accessible name
 * and hover/focus tooltip, and a click or tap (touch has no hover) opens it in
 * a small popover.
 */
@Component({
    selector: 'app-epg-schedule-notice',
    templateUrl: './epg-schedule-notice.component.html',
    styleUrl: './epg-schedule-notice.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        CdkConnectedOverlay,
        CdkOverlayOrigin,
        MatIcon,
        MatIconButton,
        MatTooltip,
        TranslatePipe,
    ],
})
export class EpgScheduleNoticeComponent {
    readonly popoverId = `epg-schedule-notice-${nextId++}`;
    readonly open = signal(false);
    readonly positions: ConnectedPosition[] = [
        {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 6,
        },
        {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -6,
        },
    ];

    private readonly button = viewChild.required('button', {
        read: ElementRef<HTMLButtonElement>,
    });

    toggle(): void {
        this.open.update((open) => !open);
    }

    close(restoreFocus = false): void {
        if (!this.open()) return;
        this.open.set(false);
        if (restoreFocus) this.button().nativeElement.focus();
    }

    onOverlayKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.close(true);
    }
}

/** The timeline toolbar's controls: this notice and the kit icon buttons. */
export const EPG_TIMELINE_TOOLBAR_IMPORTS = [
    EpgScheduleNoticeComponent,
    MatIconButton,
] as const;
